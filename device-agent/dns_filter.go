package main

// dns_filter.go — per-MAC DNS sinkhole.
//
// The kid's DNS port-53 traffic is DNAT'd (by /etc/nftables.d/bt-self-dns-filter.nft)
// to dnsFilterListen when their MAC is in the bt_dns_filter_macs set. Here we
// terminate the query, decide whether it's a domain the kid is currently
// blocked from, and either:
//
//   - sinkhole (return captiveIP for A, :: for AAAA) so HTTP traffic can land on
//     the captive page at 192.168.1.254:80; or
//   - transparently forward upstream to the real dnsmasq on 127.0.0.1:53.
//
// "Currently blocked" means: (a) the MAC is in the rule's scope per
// /etc/braintech/brainrot/<rule>.json, AND (b) for scheduled rules, the policy
// engine's latest decision for that rule is "enforce". Always-on brainrot
// rules (no policy.json sibling) block as soon as the MAC is in scope.
//
// Why this exists: Google's anycast IPs are SHARED across YouTube, Drive,
// Docs, Photos, Gmail. The pre-existing nft IP-set block couldn't tell them
// apart, so blocking YouTube also broke Drive/Docs/Photos. DNS-level
// filtering scopes by domain, not destination IP — collision-free by design.

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

const (
	dnsFilterPort     = "5453"
	dnsUpstreamAddr   = "127.0.0.1:53" // real dnsmasq on the router
	dnsFilterMacSet   = "bt_dns_filter_macs"
	dnsFilterInfraPath = "/etc/nftables.d/bt-self-dns-filter.nft"
	// The IPv4 sinkhole DNAT lives OUTSIDE /etc/nftables.d (which fw4
	// auto-includes at table level) — it is injected into fw4's own
	// dstnat_lan chain via a uci `chain-pre` include instead.
	dnsFilterRedirectPath = "/etc/braintech/bt-dns-filter-redirect.nft"
	// Controlled-device scope for DPI enforcement. The server writes
	// controlledMacsPath (union of MACs in `controlled` groups); the agent
	// keeps the bt_controlled_macs nft set in sync with it. Every DPI stage
	// gates on membership so adult devices are never touched.
	controlledMacSet  = "bt_controlled_macs"
	controlledMacsPath = "/etc/braintech/controlled-macs.json"
	// policyDir is declared in policy.go — shared.
)

var dnsFilterListen = captiveIP + ":" + dnsFilterPort

// dnsFilterServer fans out UDP + TCP listeners. Both retry the Listen if the
// captiveIP alias isn't up yet — ensureCaptiveInfra brings it up asynchronously.
func dnsFilterServer(ctx context.Context, store *usageStore) {
	go dnsFilterUDP(ctx, store)
	go dnsFilterTCP(ctx, store)
}

func dnsFilterUDP(ctx context.Context, store *usageStore) {
	for {
		if ctx.Err() != nil {
			return
		}
		conn, err := net.ListenPacket("udp", dnsFilterListen)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}
		log.Printf("dns_filter: UDP listening on %s", dnsFilterListen)
		go func() {
			<-ctx.Done()
			_ = conn.Close()
		}()
		buf := make([]byte, 4096)
		for {
			n, src, err := conn.ReadFrom(buf)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				break
			}
			msg := make([]byte, n)
			copy(msg, buf[:n])
			go handleUDPQuery(ctx, conn, src.(*net.UDPAddr), msg, store)
		}
		// fall through and retry Listen
	}
}

func handleUDPQuery(ctx context.Context, conn net.PacketConn, src *net.UDPAddr, msg []byte, store *usageStore) {
	var p dnsmessage.Parser
	hdr, err := p.Start(msg)
	if err != nil {
		return
	}
	q, err := p.Question()
	if err != nil {
		// Malformed — just forward and let dnsmasq decide.
		forwardUDP(ctx, conn, src, msg)
		return
	}
	name := strings.TrimSuffix(strings.ToLower(q.Name.String()), ".")
	mac := lookupMACForFilter(src.IP.String())

	if mac != "" && blockedForMAC(mac, name) {
		// Sinkholed — the kid never reaches the app, so DON'T record it as
		// usage: a blocked app retrying in the background would otherwise
		// keep inflating the dashboard's minutes long after enforcement
		// kicked in. It still counts against the rule's quota (a blocked
		// attempt is still the kid trying) — brainrotDNSWatcher won't see
		// this query because it never reaches dnsmasq's log.
		recordQuotaForBlockedMAC(mac, name)
		resp := buildSinkholeResponse(hdr, q)
		if len(resp) > 0 {
			_, _ = conn.WriteTo(resp, src)
		}
		return
	}

	// Record usage for the dashboard — same as the dnsmasq-log tail would,
	// if our DNAT weren't in the way. Cheap: 1 map lookup + 1 mutex op.
	if mac != "" && name != "" {
		if app := classifyApp(name); app != "" {
			store.record(mac, app, time.Now())
		}
		// Count-only domains (playback CDNs) tick the quota even though
		// they're forwarded, not sinkholed. The dnsmasq watcher can't
		// attribute these for DNAT'd MACs (the forward arrives from the
		// router's own IP), so this is their only counting point.
		recordQuotaForCountOnly(mac, name)
	}

	forwardUDP(ctx, conn, src, msg)
}

func forwardUDP(ctx context.Context, conn net.PacketConn, src *net.UDPAddr, msg []byte) {
	sub, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var d net.Dialer
	up, err := d.DialContext(sub, "udp", dnsUpstreamAddr)
	if err != nil {
		return
	}
	defer up.Close()
	_ = up.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := up.Write(msg); err != nil {
		return
	}
	buf := make([]byte, 4096)
	n, err := up.Read(buf)
	if err != nil {
		return
	}
	_, _ = conn.WriteTo(buf[:n], src)
}

func dnsFilterTCP(ctx context.Context, store *usageStore) {
	for {
		if ctx.Err() != nil {
			return
		}
		ln, err := net.Listen("tcp", dnsFilterListen)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}
		log.Printf("dns_filter: TCP listening on %s", dnsFilterListen)
		go func() {
			<-ctx.Done()
			_ = ln.Close()
		}()
		for {
			c, err := ln.Accept()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				break
			}
			go handleTCPConn(ctx, c, store)
		}
	}
}

func handleTCPConn(ctx context.Context, c net.Conn, store *usageStore) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(5 * time.Second))

	var lenBuf [2]byte
	if _, err := io.ReadFull(c, lenBuf[:]); err != nil {
		return
	}
	l := binary.BigEndian.Uint16(lenBuf[:])
	if l == 0 || l > 4096 {
		return
	}
	msg := make([]byte, l)
	if _, err := io.ReadFull(c, msg); err != nil {
		return
	}

	var p dnsmessage.Parser
	hdr, err := p.Start(msg)
	if err == nil {
		q, qerr := p.Question()
		if qerr == nil {
			name := strings.TrimSuffix(strings.ToLower(q.Name.String()), ".")
			mac := lookupMACForFilter(remoteIPOnly(c.RemoteAddr().String()))
			if mac != "" && blockedForMAC(mac, name) {
				// Sinkholed — quota yes, dashboard usage no (see UDP path).
				recordQuotaForBlockedMAC(mac, name)
				resp := buildSinkholeResponse(hdr, q)
				if len(resp) > 0 {
					writeTCPDNS(c, resp)
				}
				return
			}
			if mac != "" && name != "" {
				if app := classifyApp(name); app != "" {
					store.record(mac, app, time.Now())
				}
				recordQuotaForCountOnly(mac, name) // see UDP path
			}
		}
	}

	// Forward to upstream over TCP.
	sub, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var d net.Dialer
	up, err := d.DialContext(sub, "tcp", dnsUpstreamAddr)
	if err != nil {
		return
	}
	defer up.Close()
	_ = up.SetDeadline(time.Now().Add(3 * time.Second))
	writeTCPDNS(up, msg)
	if _, err := io.ReadFull(up, lenBuf[:]); err != nil {
		return
	}
	rl := binary.BigEndian.Uint16(lenBuf[:])
	if rl == 0 {
		return
	}
	respBuf := make([]byte, rl)
	if _, err := io.ReadFull(up, respBuf); err != nil {
		return
	}
	writeTCPDNS(c, respBuf)
}

func writeTCPDNS(w io.Writer, msg []byte) {
	var lenBuf [2]byte
	binary.BigEndian.PutUint16(lenBuf[:], uint16(len(msg)))
	_, _ = w.Write(lenBuf[:])
	_, _ = w.Write(msg)
}

// buildSinkholeResponse returns an A=captiveIP / AAAA=:: answer. The captive
// HTTP server at 192.168.1.254:80 will receive HTTP requests and 302 to
// /blocked?host=<original> using the browser's Host header. HTTPS lands on a
// closed port — connection refused, same UX as the previous IP-set reject.
func buildSinkholeResponse(hdr dnsmessage.Header, q dnsmessage.Question) []byte {
	b := dnsmessage.NewBuilder(nil, dnsmessage.Header{
		ID:                 hdr.ID,
		Response:           true,
		OpCode:             hdr.OpCode,
		Authoritative:      true,
		RecursionDesired:   hdr.RecursionDesired,
		RecursionAvailable: true,
		RCode:              dnsmessage.RCodeSuccess,
	})
	b.EnableCompression()
	if err := b.StartQuestions(); err != nil {
		return nil
	}
	if err := b.Question(q); err != nil {
		return nil
	}
	if err := b.StartAnswers(); err != nil {
		return nil
	}
	switch q.Type {
	case dnsmessage.TypeA:
		captive := net.ParseIP(captiveIP).To4()
		if captive == nil {
			return nil
		}
		var ip4 [4]byte
		copy(ip4[:], captive[:4])
		_ = b.AResource(
			dnsmessage.ResourceHeader{
				Name: q.Name, Type: dnsmessage.TypeA,
				Class: dnsmessage.ClassINET, TTL: 60,
			},
			dnsmessage.AResource{A: ip4},
		)
	case dnsmessage.TypeAAAA:
		_ = b.AAAAResource(
			dnsmessage.ResourceHeader{
				Name: q.Name, Type: dnsmessage.TypeAAAA,
				Class: dnsmessage.ClassINET, TTL: 60,
			},
			dnsmessage.AAAAResource{AAAA: [16]byte{}},
		)
	default:
		// Other qtypes (MX/TXT/SOA/SVCB/HTTPS) — return NOERROR with no
		// answers. "Domain exists, no records of this type for you."
	}
	out, err := b.Finish()
	if err != nil {
		return nil
	}
	return out
}

// blockedForMAC walks the active brainrot rules and returns true if any of
// them currently sinkholes queryName for mac. See the file header for the
// always-on vs scheduled semantics.
func blockedForMAC(mac, queryName string) bool {
	if mac == "" || queryName == "" {
		return false
	}
	mac = strings.ToLower(mac)
	rules := getCachedBrainrotRules()
	if len(rules) == 0 {
		return false
	}
	enforceByID := buildEnforceModeIndex()
	for _, r := range rules {
		if !macInScope(mac, r.MACs) {
			continue
		}
		if isScheduledRule(r.RuleID) && !enforceByID[r.RuleID] {
			continue
		}
		if matchesAny(queryName, r.Domains) {
			return true
		}
	}
	return false
}

// recordQuotaForBlockedMAC walks the rules and records a minute-bucket on
// any rule whose (mac, domain) matches. Mirrors what brainrotDNSWatcher
// would have done if the query had reached dnsmasq.
func recordQuotaForBlockedMAC(mac, queryName string) {
	if mac == "" || queryName == "" {
		return
	}
	// A pixel/beacon query isn't the kid trying to use the app — don't
	// burn their quota for a web page's ad stack phoning home.
	if isTrackerDomain(queryName) {
		return
	}
	mac = strings.ToLower(mac)
	rules := getCachedBrainrotRules()
	now := time.Now()
	for _, r := range rules {
		if !macInScope(mac, r.MACs) {
			continue
		}
		if !matchesAny(queryName, r.Domains) {
			continue
		}
		globalQuotaCounter.record(r.RuleID, mac, now)
	}
}

// recordQuotaForCountOnly ticks the quota for count-only domains
// (playback CDNs that are never blocked) queried by a DNAT'd MAC. The
// tracker check mirrors the other two recording paths.
func recordQuotaForCountOnly(mac, queryName string) {
	if mac == "" || queryName == "" || isTrackerDomain(queryName) {
		return
	}
	mac = strings.ToLower(mac)
	rules := getCachedBrainrotRules()
	now := time.Now()
	for _, r := range rules {
		if len(r.CountDomains) == 0 {
			continue
		}
		if !macInScope(mac, r.MACs) {
			continue
		}
		if !matchesAny(queryName, r.CountDomains) {
			continue
		}
		globalQuotaCounter.record(r.RuleID, mac, now)
	}
}

func buildEnforceModeIndex() map[string]bool {
	out := map[string]bool{}
	for _, d := range PolicyDecisions() {
		if d.Decision == "enforce" {
			out[d.RuleID] = true
		}
	}
	return out
}

func isScheduledRule(ruleID string) bool {
	_, err := os.Stat(filepath.Join(policyDir, ruleID+".json"))
	return err == nil
}

// Caches — the DNS filter runs on every query; reloading off disk per call
// would be wasteful. 10s rule TTL is plenty (rules only change on apply, and
// the agent reloads the desired state ~every minute anyway).
type brainrotRulesCache struct {
	mu       sync.RWMutex
	rules    []brainrotState
	loadedAt time.Time
}

var globalBrainrotCache brainrotRulesCache

func getCachedBrainrotRules() []brainrotState {
	globalBrainrotCache.mu.RLock()
	if time.Since(globalBrainrotCache.loadedAt) < 10*time.Second {
		out := globalBrainrotCache.rules
		globalBrainrotCache.mu.RUnlock()
		return out
	}
	globalBrainrotCache.mu.RUnlock()
	globalBrainrotCache.mu.Lock()
	defer globalBrainrotCache.mu.Unlock()
	if time.Since(globalBrainrotCache.loadedAt) < 10*time.Second {
		return globalBrainrotCache.rules
	}
	globalBrainrotCache.rules = loadBrainrotRules()
	globalBrainrotCache.loadedAt = time.Now()
	return globalBrainrotCache.rules
}

type ipMacCache struct {
	mu       sync.RWMutex
	m        map[string]string
	loadedAt time.Time
}

var globalIPMacCache = &ipMacCache{m: map[string]string{}}

func lookupMACForFilter(ip string) string {
	globalIPMacCache.mu.RLock()
	if time.Since(globalIPMacCache.loadedAt) < 5*time.Second {
		out := globalIPMacCache.m[ip]
		globalIPMacCache.mu.RUnlock()
		return out
	}
	globalIPMacCache.mu.RUnlock()
	globalIPMacCache.mu.Lock()
	defer globalIPMacCache.mu.Unlock()
	if time.Since(globalIPMacCache.loadedAt) >= 5*time.Second {
		globalIPMacCache.m = refreshLeaseCache()
		globalIPMacCache.loadedAt = time.Now()
	}
	return globalIPMacCache.m[ip]
}

// ensureDNSFilterInfra installs the agent-owned DNS-filter plumbing.
// Idempotent; only reloads the firewall when something changed. Two pieces:
//
//  1. A table-level nft include (auto-loaded from /etc/nftables.d) with the
//     MAC set and IPv6 port-53 reject chains. The sinkhole resolver is
//     IPv4-only, so v6 DNS from filtered MACs is rejected on the input
//     (router-bound) and forward (external resolver) hooks — dual-stack
//     clients fall back to IPv4 within milliseconds.
//  2. The IPv4 sinkhole DNAT, injected at the TOP of fw4's own dstnat_lan
//     chain via a uci `chain-pre` include. It must live INSIDE fw4's
//     chain: only one DNAT decision applies per flow, and a separate nat
//     chain either loses the race to force_router_dns's no-op redirect
//     (equal priority — that redirect consumed the flow's NAT decision
//     and enforcement silently did nothing) or fails fw4's atomic reload
//     outright (different priority — the kernel rejects the second nat
//     hook inside that transaction even though it loads standalone).
//     chain-pre ordering is deterministic and survives every reload.
//
// Named bt-self-* (not bt-*) on purpose: orphan_cleanup's glob is bt-*.nft.
// Anything matching that glob is considered server-owned and gets deleted on
// the next reconcile if it's not in the cloud's desired list. Both files
// here are agent-owned — keep them out of the cleanup's blast radius.
func ensureDNSFilterInfra(ctx context.Context) {
	tableInclude := strings.Join([]string{
		"# Braintech agent — DNS filter (auto-managed by the agent)",
		"# MAC set consumed by the dstnat_lan chain-pre redirect at",
		"# " + dnsFilterRedirectPath + ", plus IPv6 port-53 rejects",
		"# (the filter resolver on " + dnsFilterListen + " is IPv4-only).",
		"",
		"set " + dnsFilterMacSet + " {",
		"    type ether_addr",
		"}",
		"",
		// Controlled-device scope for DPI enforcement (stages 1-3). Kept in
		// sync with controlled-macs.json by controlledMacSyncLoop.
		"set " + controlledMacSet + " {",
		"    type ether_addr",
		"}",
		"",
		"chain bt_dns_filter_block6_in {",
		"    type filter hook input priority -10; policy accept;",
		"    ether saddr @" + dnsFilterMacSet + " meta nfproto ipv6 udp dport 53 reject",
		"    ether saddr @" + dnsFilterMacSet + " meta nfproto ipv6 tcp dport 53 reject",
		"}",
		"",
		"chain bt_dns_filter_block6_fwd {",
		"    type filter hook forward priority -10; policy accept;",
		"    ether saddr @" + dnsFilterMacSet + " meta nfproto ipv6 udp dport 53 reject",
		"    ether saddr @" + dnsFilterMacSet + " meta nfproto ipv6 tcp dport 53 reject",
		"}",
		"",
	}, "\n")
	// Bare rules, no table/chain wrapper — fw4 splices them verbatim at the
	// top of dstnat_lan. `counter` kept for observability: nonzero packets
	// here is the live proof that interception is happening.
	redirectRules := strings.Join([]string{
		"ether saddr @" + dnsFilterMacSet + " meta nfproto ipv4 udp dport 53 counter dnat ip to " + dnsFilterListen,
		"ether saddr @" + dnsFilterMacSet + " meta nfproto ipv4 tcp dport 53 counter dnat ip to " + dnsFilterListen,
		"",
	}, "\n")

	changed1, err := writeFileIfChanged(dnsFilterInfraPath, tableInclude)
	if err != nil {
		log.Printf("dns_filter: %s: %v", dnsFilterInfraPath, err)
		return
	}
	changed2, err := writeFileIfChanged(dnsFilterRedirectPath, redirectRules)
	if err != nil {
		log.Printf("dns_filter: %s: %v", dnsFilterRedirectPath, err)
		return
	}
	changed3 := ensureUciDNSFilterInclude(ctx)

	if !changed1 && !changed2 && !changed3 {
		return
	}
	sub, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(sub, "/etc/init.d/firewall", "reload").CombinedOutput(); err != nil {
		log.Printf("dns_filter: fw4 reload: %v: %s", err, strings.TrimSpace(string(out)))
		return
	}
	log.Printf("dns_filter: nft infra installed (%s, %s, uci chain-pre include)",
		dnsFilterInfraPath, dnsFilterRedirectPath)
}

func writeFileIfChanged(path, content string) (bool, error) {
	current, err := os.ReadFile(path)
	if err == nil && string(current) == content {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

// ensureUciDNSFilterInclude registers the chain-pre include with fw4.
// Returns true when any uci option had to be (re)written.
func ensureUciDNSFilterInclude(ctx context.Context) bool {
	// Ordered: the section must exist before its options.
	pairs := [][2]string{
		{"firewall.bt_dnsfilter", "include"},
		{"firewall.bt_dnsfilter.type", "nftables"},
		{"firewall.bt_dnsfilter.path", dnsFilterRedirectPath},
		{"firewall.bt_dnsfilter.position", "chain-pre"},
		{"firewall.bt_dnsfilter.chain", "dstnat_lan"},
	}
	changed := false
	for _, kv := range pairs {
		out, _ := exec.CommandContext(ctx, "uci", "-q", "get", kv[0]).Output()
		if strings.TrimSpace(string(out)) == kv[1] {
			continue
		}
		if err := exec.CommandContext(ctx, "uci", "set", kv[0]+"="+kv[1]).Run(); err != nil {
			log.Printf("dns_filter: uci set %s: %v", kv[0], err)
			return changed
		}
		changed = true
	}
	if changed {
		if err := exec.CommandContext(ctx, "uci", "commit", "firewall").Run(); err != nil {
			log.Printf("dns_filter: uci commit firewall: %v", err)
		}
	}
	return changed
}

// syncDNSFilterMacs rebuilds bt_dns_filter_macs to the current union of
// MACs that should be sinkholing right now: every always-on brainrot rule's
// scope + every scheduled rule whose decision is currently "enforce".
//
// Called every 15s by dnsFilterMacSyncLoop, plus once after each policy
// tick so quota flips take effect immediately.
func syncDNSFilterMacs(ctx context.Context) {
	rules := loadBrainrotRules()
	enforce := buildEnforceModeIndex()
	want := map[string]bool{}
	for _, r := range rules {
		if isScheduledRule(r.RuleID) && !enforce[r.RuleID] {
			continue
		}
		for _, m := range r.MACs {
			want[strings.ToLower(m)] = true
		}
	}
	sub, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	flush := exec.CommandContext(sub, "nft", "flush", "set", "inet", "fw4", dnsFilterMacSet)
	if out, err := flush.CombinedOutput(); err != nil {
		// "No such file or directory" = set not declared yet (infra hasn't
		// landed). Silent — next tick will retry once the file's in place.
		if strings.Contains(string(out), "No such file") ||
			strings.Contains(string(out), "Could not process rule") {
			return
		}
		log.Printf("dns_filter: flush %s: %v: %s", dnsFilterMacSet, err, strings.TrimSpace(string(out)))
		return
	}
	if len(want) == 0 {
		return
	}
	macs := make([]string, 0, len(want))
	for m := range want {
		macs = append(macs, m)
	}
	arg := "{ " + strings.Join(macs, ", ") + " }"
	add := exec.CommandContext(sub, "nft", "add", "element", "inet", "fw4", dnsFilterMacSet, arg)
	if out, err := add.CombinedOutput(); err != nil {
		log.Printf("dns_filter: add %s: %v: %s", dnsFilterMacSet, err, strings.TrimSpace(string(out)))
	}
}

// loadControlledMacs reads controlled-macs.json. Missing file → empty
// (no device is controlled; every DPI stage no-ops). A malformed file is
// treated the same — fail open rather than guess a scope.
func loadControlledMacs() []string {
	b, err := os.ReadFile(controlledMacsPath)
	if err != nil {
		return nil
	}
	var doc struct {
		Macs []string `json:"macs"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		log.Printf("controlled: parse %s: %v", controlledMacsPath, err)
		return nil
	}
	out := make([]string, 0, len(doc.Macs))
	for _, m := range doc.Macs {
		m = strings.ToLower(strings.TrimSpace(m))
		if m != "" {
			out = append(out, m)
		}
	}
	return out
}

// isControlledMAC reports whether a MAC is in a controlled group. Cheap
// enough (small set) to call on the per-query DNS path.
func isControlledMAC(mac string) bool {
	if mac == "" {
		return false
	}
	mac = strings.ToLower(mac)
	for _, m := range getControlledMacs() {
		if m == mac {
			return true
		}
	}
	return false
}

type controlledMacsCache struct {
	mu       sync.RWMutex
	macs     []string
	loadedAt time.Time
}

var globalControlledMacs controlledMacsCache

func getControlledMacs() []string {
	globalControlledMacs.mu.RLock()
	if time.Since(globalControlledMacs.loadedAt) < 10*time.Second {
		out := globalControlledMacs.macs
		globalControlledMacs.mu.RUnlock()
		return out
	}
	globalControlledMacs.mu.RUnlock()
	globalControlledMacs.mu.Lock()
	defer globalControlledMacs.mu.Unlock()
	if time.Since(globalControlledMacs.loadedAt) < 10*time.Second {
		return globalControlledMacs.macs
	}
	globalControlledMacs.macs = loadControlledMacs()
	globalControlledMacs.loadedAt = time.Now()
	return globalControlledMacs.macs
}

// syncControlledMacs rebuilds the bt_controlled_macs nft set from the
// pushed file. Same flush-then-add shape as syncDNSFilterMacs.
func syncControlledMacs(ctx context.Context) {
	macs := loadControlledMacs()
	sub, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	flush := exec.CommandContext(sub, "nft", "flush", "set", "inet", "fw4", controlledMacSet)
	if out, err := flush.CombinedOutput(); err != nil {
		if strings.Contains(string(out), "No such file") ||
			strings.Contains(string(out), "Could not process rule") {
			return // set not declared yet — infra hasn't landed
		}
		log.Printf("controlled: flush %s: %v: %s", controlledMacSet, err, strings.TrimSpace(string(out)))
		return
	}
	if len(macs) == 0 {
		return
	}
	arg := "{ " + strings.Join(macs, ", ") + " }"
	add := exec.CommandContext(sub, "nft", "add", "element", "inet", "fw4", controlledMacSet, arg)
	if out, err := add.CombinedOutput(); err != nil {
		log.Printf("controlled: add %s: %v: %s", controlledMacSet, err, strings.TrimSpace(string(out)))
	}
}

func controlledMacSyncLoop(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	syncControlledMacs(ctx) // prime
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			syncControlledMacs(ctx)
		}
	}
}

func dnsFilterMacSyncLoop(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	syncDNSFilterMacs(ctx) // prime
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			syncDNSFilterMacs(ctx)
		}
	}
}
