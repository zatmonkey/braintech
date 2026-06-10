package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// brainrotState mirrors what the server writes to
// /etc/braintech/brainrot/<rule_id>.json — one file per active brainrot
// rule. The agent uses it to know which nft sets to populate from which
// domains. Schema is small + stable on purpose.
type brainrotState struct {
	RuleID    string   `json:"rule_id"`
	IP4Set    string   `json:"ip4_set"`
	IP6Set    string   `json:"ip6_set"`
	Domains   []string `json:"domains"`
	MACs      []string `json:"macs"`
	UpdatedAt string   `json:"updated_at"`
}

const brainrotDir = "/etc/braintech/brainrot"

// brainrotRefreshLoop is the on-device DNS-to-nft pump for brainrot rules.
// Every refresh tick it scans brainrotDir for state files, resolves each
// rule's configured domains via the system resolver (dnsmasq on the
// router), and bulk-adds the resulting IPs to the rule's nft sets. The
// sets are declared with a 2h timeout in the include file, so anything
// the agent doesn't keep adding ages out automatically.
//
// Runs on the router. Never reaches the server. If DNS is broken or
// nftables is wedged, this just logs and tries again next tick.
func brainrotRefreshLoop(ctx context.Context) {
	// Quick first pass so a freshly-applied rule has IPs in ~5s, not 30.
	for n := 0; n < 3; n++ {
		if ctx.Err() != nil {
			return
		}
		refreshBrainrotOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
	// Steady-state cadence.
	for {
		if ctx.Err() != nil {
			return
		}
		refreshBrainrotOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
	}
}

func refreshBrainrotOnce(ctx context.Context) {
	entries, err := os.ReadDir(brainrotDir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("brainrot: read %s: %v", brainrotDir, err)
		}
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		path := filepath.Join(brainrotDir, e.Name())
		st, err := loadBrainrotState(path)
		if err != nil {
			log.Printf("brainrot: load %s: %v", path, err)
			continue
		}
		if len(st.Domains) == 0 || st.IP4Set == "" || st.IP6Set == "" {
			continue
		}
		ip4, ip6 := resolveDomains(ctx, st.Domains)
		if len(ip4) > 0 {
			if err := nftAddElements(ctx, st.IP4Set, ip4); err != nil {
				log.Printf("brainrot: nft add v4 %s: %v", st.IP4Set, err)
			}
		}
		if len(ip6) > 0 {
			if err := nftAddElements(ctx, st.IP6Set, ip6); err != nil {
				log.Printf("brainrot: nft add v6 %s: %v", st.IP6Set, err)
			}
		}
	}
}

func loadBrainrotState(path string) (*brainrotState, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st := &brainrotState{}
	if err := json.NewDecoder(bufio.NewReader(f)).Decode(st); err != nil {
		return nil, err
	}
	return st, nil
}

// resolveDomains runs `net.LookupIP` for each domain. On OpenWrt this
// resolves through dnsmasq on 127.0.0.1, so a DoH-block on the LAN does
// not prevent the agent from getting the real CDN IPs. Bounded by a
// short per-call deadline so a single hung query can't stall the loop.
func resolveDomains(ctx context.Context, domains []string) (ip4, ip6 []string) {
	v4 := make(map[string]struct{})
	v6 := make(map[string]struct{})
	r := &net.Resolver{PreferGo: false}
	for _, d := range domains {
		d = strings.TrimSpace(d)
		if d == "" {
			continue
		}
		sub, cancel := context.WithTimeout(ctx, 3*time.Second)
		ips, err := r.LookupIPAddr(sub, d)
		cancel()
		if err != nil {
			// NXDOMAIN / timeout — silently skip, try again next tick.
			continue
		}
		for _, ip := range ips {
			s := ip.IP.String()
			if ip.IP.To4() != nil {
				v4[s] = struct{}{}
			} else {
				v6[s] = struct{}{}
			}
		}
	}
	for s := range v4 {
		ip4 = append(ip4, s)
	}
	for s := range v6 {
		ip6 = append(ip6, s)
	}
	return ip4, ip6
}

// nftAddElements runs `nft add element inet fw4 <set> { ip1, ip2, ... }`.
// Elements that already exist refresh their timeout (nft semantics), and
// new elements get the timeout the set was declared with — so we can call
// this every cycle without filtering "already present" cases out.
//
// We chunk to keep individual command lines bounded — a busy YouTube
// session can resolve dozens of CDN IPs in a single pass.
func nftAddElements(ctx context.Context, setName string, ips []string) error {
	const chunk = 32
	for i := 0; i < len(ips); i += chunk {
		end := i + chunk
		if end > len(ips) {
			end = len(ips)
		}
		arg := strings.Join(ips[i:end], ", ")
		expr := "add element inet fw4 " + setName + " { " + arg + " }"
		sub, cancel := context.WithTimeout(ctx, 5*time.Second)
		cmd := exec.CommandContext(sub, "nft", expr)
		out, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			// Sets are recreated empty on fw4 reload, then this'll succeed
			// next pass. Logging the body is useful when the set name has
			// changed (rule renamed/deleted) but the JSON is stale.
			return wrapNftErr(err, string(out))
		}
	}
	return nil
}

type nftError struct {
	err error
	out string
}

func (e *nftError) Error() string {
	if e.out == "" {
		return e.err.Error()
	}
	return e.err.Error() + ": " + strings.TrimSpace(e.out)
}

func wrapNftErr(err error, out string) error {
	return &nftError{err: err, out: out}
}
