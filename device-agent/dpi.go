package main

// Stage 2 DPI: per-flow SNI verdicts.
//
// For controlled MACs with an active app-block (e.g. YouTube quota
// exhausted), the first packets of new TCP:443 flows are queued to
// userspace, the ClientHello SNI is read (sni.go), and the flow is
// verdicted by destination *service* rather than destination IP — so a
// block hits youtube.com while drive.google.com on the same Google
// anycast IP passes.
//
// Rollout safety: dpiEnforce gates whether userspace ever DROPs. Shipped
// false first (observe mode) — the queue rule is present with `bypass`
// (daemon down = packets pass), the handler parses + logs + always
// ACCEPTs, and no QUIC drop / ct-mark drop rules exist. Only once observe
// logs confirm correct SNI attribution on real traffic do we flip the
// const and add the enforcing rules. There is no interim state where a
// half-wired verdict path can break the kids' HTTPS.

import (
	"context"
	"log"
	"net"
	"time"

	nfqueue "github.com/florianl/go-nfqueue/v2"
)

// dpiEnforce = true: SNI verdicts actually drop. The path is fail-open at
// every step (parse miss / unresolved MAC / daemon down all accept), and
// scoped to bt_sni_macs (controlled ∩ app-block-enforce), so the blast
// radius is one kid's blocked app, never adult devices or unrelated sites.
const dpiEnforce = true

const dpiQueueNum = 4

// startDPI opens the NFQUEUE and dispatches ClientHello verdicts. Retries
// the open if the nft infra (which declares the queue rule) hasn't landed
// yet. Returns only on ctx cancel.
func startDPI(ctx context.Context) {
	// No NFQUEUE support (stock snapshot kernel) → nothing to attach to;
	// the queue nft chains weren't emitted either. Don't spin.
	if !nftSupportsQueue() {
		log.Printf("dpi: kernel lacks nft queue — SNI inspection disabled")
		return
	}
	for {
		if ctx.Err() != nil {
			return
		}
		if err := runDPIQueue(ctx); err != nil {
			log.Printf("dpi: queue error: %v (retry in 10s)", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(10 * time.Second):
			}
		}
	}
}

func runDPIQueue(ctx context.Context) error {
	cfg := &nfqueue.Config{
		NfQueue:      dpiQueueNum,
		MaxPacketLen: 0xFFFF,
		MaxQueueLen:  1024,
		Copymode:     nfqueue.NfQnlCopyPacket,
		WriteTimeout: 200 * time.Millisecond,
	}
	nf, err := nfqueue.Open(cfg)
	if err != nil {
		return err
	}
	defer nf.Close()

	fn := func(a nfqueue.Attribute) int {
		if a.PacketID == nil {
			return 0
		}
		id := *a.PacketID
		if a.Payload == nil {
			_ = nf.SetVerdict(id, nfqueue.NfAccept)
			return 0
		}
		srcIP, l4, ok := tcpPayload(*a.Payload)
		if !ok || len(l4) == 0 {
			// Pure ACK / SYN / unparsable — no decision yet. Accept
			// WITHOUT a conntrack mark so the flow stays "undecided" and
			// its next (data) packet is still queued. The connbytes bound
			// in the nft rule caps how long this can go on.
			_ = nf.SetVerdict(id, nfqueue.NfAccept)
			return 0
		}
		host, ok := parseClientHelloSNI(l4)
		if !ok {
			if l4[0] == 0x16 {
				// A TLS handshake record whose ClientHello spans more than
				// this segment. Stay undecided and wait for the next one
				// (bounded by connbytes) rather than guessing.
				_ = nf.SetVerdict(id, nfqueue.NfAccept)
			} else {
				// First data byte isn't a TLS handshake — not something we
				// classify by SNI. Allow and stop re-queueing this flow.
				_ = nf.SetVerdictWithConnMark(id, nfqueue.NfAccept, ctMarkAllow)
			}
			return 0
		}
		mac := lookupMACForFilter(srcIP)
		block := mac != "" && sniBlockedForMAC(mac, host)
		if !dpiEnforce {
			// Observe: record the verdict we WOULD make, but never drop.
			// Mark allow so the conntrack fast-path engages and the flow
			// stops re-queueing (this is also the live test that the
			// connmark mechanism works — re-queue counts should stay tiny).
			log.Printf("dpi(observe): mac=%s sni=%s wouldBlock=%v", mac, host, block)
			_ = nf.SetVerdictWithConnMark(id, nfqueue.NfAccept, ctMarkAllow)
			return 0
		}
		if block {
			// Drop the ClientHello (kills the handshake) AND mark the flow
			// so every later packet hits the `ct mark 2 drop` rule.
			log.Printf("dpi(block): mac=%s sni=%s", mac, host)
			_ = nf.SetVerdictWithConnMark(id, nfqueue.NfDrop, ctMarkBlock)
			return 0
		}
		_ = nf.SetVerdictWithConnMark(id, nfqueue.NfAccept, ctMarkAllow)
		return 0
	}
	errFn := func(e error) int {
		log.Printf("dpi: recv error: %v", e)
		return 0
	}
	if err := nf.RegisterWithErrorFunc(ctx, fn, errFn); err != nil {
		return err
	}
	<-ctx.Done()
	return nil
}

// Conntrack marks set directly on the verdict (SetVerdictWithConnMark), so
// the per-flow decision persists in conntrack without relying on an
// nfmark→ct-mark copy across base chains (that cross-chain resume does not
// work on this kernel — it produced a 273k-packet re-queue storm). The nft
// chain reads these: mark 1 → flow already allowed (skip queue), mark 2 →
// blocked (drop every packet).
const (
	ctMarkAllow = 1
	ctMarkBlock = 2
)

// sniBlockedForMAC reports whether host matches the block-domain list of
// any rule that (a) scopes this MAC, (b) is currently enforcing, and (c)
// is NOT a whole-internet rule (those are stage 1's job — a whole-internet
// block already dropped the flow before it reached here). count_domains
// are intentionally absent from a rule's Domains, so a still-playing
// googlevideo stream is never SNI-blocked.
func sniBlockedForMAC(mac, host string) bool {
	rules := getCachedBrainrotRules()
	if len(rules) == 0 {
		return false
	}
	enforce := buildEnforceModeIndex()
	for _, r := range rules {
		if isWholeInternetRule(r) {
			continue
		}
		if isScheduledRule(r.RuleID) && !enforce[r.RuleID] {
			continue
		}
		if !macInScope(mac, r.MACs) {
			continue
		}
		if matchesAny(host, r.Domains) {
			return true
		}
	}
	return false
}

// tcpPayload returns (srcIP, tcpPayload, ok) for an IPv4- or IPv6-carried
// TCP packet. Dual-stack is mandatory here: Apple devices prefer IPv6, so
// an IPv4-only parser sees none of their TLS (this was observed live — the
// queue processed the packets but every ClientHello was dropped unparsed).
// Unparseable (non-TCP, IPv6 extension headers, truncated) → ok=false,
// caller accepts (fail open), never drops.
func tcpPayload(pkt []byte) (string, []byte, bool) {
	if len(pkt) < 1 {
		return "", nil, false
	}
	var src string
	var l4 []byte
	switch pkt[0] >> 4 {
	case 4:
		if len(pkt) < 20 {
			return "", nil, false
		}
		ihl := int(pkt[0]&0x0f) * 4
		if ihl < 20 || len(pkt) < ihl+20 || pkt[9] != 6 { // proto 6 = TCP
			return "", nil, false
		}
		src = net.IPv4(pkt[12], pkt[13], pkt[14], pkt[15]).String()
		l4 = pkt[ihl:]
	case 6:
		// Fixed 40-byte IPv6 header; next_header at [6]. We don't walk
		// extension headers — a TLS ClientHello sits on a plain TCP flow,
		// so next_header != 6 is treated as "not for us" (fail open).
		if len(pkt) < 40+20 || pkt[6] != 6 {
			return "", nil, false
		}
		src = net.IP(pkt[8:24]).String()
		l4 = pkt[40:]
	default:
		return "", nil, false
	}
	dataOff := int(l4[12]>>4) * 4
	if dataOff < 20 || len(l4) < dataOff {
		return "", nil, false
	}
	return src, l4[dataOff:], true
}
