package main

import (
	"bufio"
	"context"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// brainrotDNSWatcher tails the dnsmasq query log and adds resolved IPs to
// the brainrot nft sets in real time. This catches CNAME chains and
// dynamic CDN subdomains (e.g. *.googlevideo.com, youtube-ui.l.google.com)
// that the refresh loop's static-domain LookupIP can't enumerate.
//
// How it works:
//
//   1. We maintain a small per-transaction state map (txid → original
//      queried domain). dnsmasq stamps every log line with a numeric tx id.
//   2. On a "query[A]" / "query[AAAA]" line we record the txid+domain.
//   3. On a "reply DOMAIN is IP" line (not <CNAME>) we look up the txid,
//      get the ORIGINAL domain, suffix-match it against active brainrot
//      rules' domains, and `nft add element` the IP into matching sets.
//   4. txid map entries expire after 30s — dnsmasq replies arrive within
//      milliseconds of the query, so anything older is stale.
//
// The brainrot nft chain only rejects traffic from the rule's MAC set, so
// adding IPs that random LAN clients resolved (the parents looking up
// YouTube on their own devices) is harmless — those packets fall through
// the chain unfiltered.
func brainrotDNSWatcher(ctx context.Context, path string) {
	for {
		if _, err := os.Stat(path); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}

	type txEntry struct {
		domain string
		src    string // source IP of the original query
		seen   time.Time
	}
	var (
		txMu sync.Mutex
		tx   = make(map[int]txEntry, 256)
	)
	var (
		leaseCache map[string]string
		leaseAt    time.Time
	)

	gc := func() {
		txMu.Lock()
		defer txMu.Unlock()
		cutoff := time.Now().Add(-30 * time.Second)
		for id, e := range tx {
			if e.seen.Before(cutoff) {
				delete(tx, id)
			}
		}
	}

	var rules []brainrotState
	var rulesAt time.Time

	for {
		if ctx.Err() != nil {
			return
		}
		f, err := os.Open(path)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}
		if _, err := f.Seek(0, 2); err != nil {
			f.Close()
			continue
		}
		r := bufio.NewReader(f)

		for {
			if ctx.Err() != nil {
				f.Close()
				return
			}
			line, err := r.ReadString('\n')
			if err != nil {
				select {
				case <-ctx.Done():
					f.Close()
					return
				case <-time.After(500 * time.Millisecond):
				}
				fi, statErr := f.Stat()
				if statErr != nil {
					break
				}
				cur, _ := f.Seek(0, 1)
				if fi.Size() < cur {
					f.Close()
					goto reopen
				}
				gc() // piggyback the GC on idle ticks
				continue
			}

			// Refresh the rule list periodically.
			if time.Since(rulesAt) > 15*time.Second {
				rules = loadBrainrotRules()
				rulesAt = time.Now()
			}
			if len(rules) == 0 {
				continue
			}

			// Refresh the IP→MAC cache periodically — needed to attribute
			// each query to a member of the rule's MAC list for quota
			// tracking.
			if time.Since(leaseAt) > 10*time.Second {
				leaseCache = refreshLeaseCache()
				leaseAt = time.Now()
			}

			txid, kind, srcIP, dom, payload, ok := parseDnsmasqLine(line)
			if !ok {
				continue
			}
			switch kind {
			case "query":
				txMu.Lock()
				tx[txid] = txEntry{domain: dom, src: srcIP, seen: time.Now()}
				txMu.Unlock()
			case "reply":
				ip := payload
				if ip == "" || strings.HasPrefix(ip, "<") {
					// <CNAME>, <SRV>, etc — not a final IP.
					continue
				}
				if net.ParseIP(ip) == nil {
					continue
				}
				txMu.Lock()
				e, present := tx[txid]
				txMu.Unlock()
				original := dom
				asker := srcIP
				if present {
					if e.domain != "" {
						original = e.domain
					}
					if e.src != "" {
						asker = e.src
					}
				}
				// Map source IP → MAC for quota attribution. If we can't
				// resolve a MAC, we still add the IP to the block set —
				// just don't record to the per-MAC counter.
				askerMAC := leaseCache[asker]

				for _, rule := range rules {
					if !matchesAny(original, rule.Domains) {
						continue
					}
					// Per-MAC quota record. countPeriod() in the policy
					// engine sums distinct minute-buckets across the
					// rule's MAC list, so we record by MAC (not by rule
					// alone) — two devices in the same group accumulate
					// time honestly.
					//
					// IP-set population was removed when the architecture
					// moved to DNS sinkhole (dns_filter.go) — destination
					// IPs no longer drive enforcement; per-MAC DNS answers
					// do. This loop is now quota-counting only.
					if askerMAC != "" {
						globalQuotaCounter.record(rule.RuleID, askerMAC, time.Now())
					}
				}
			}
		}
	reopen:
	}
}

// loadBrainrotRules reads the current set of brainrot state files. Called
// every 15s in steady state. Errors are logged and the previous list (if
// any) keeps being used — a transient mkdir race shouldn't break tailing.
func loadBrainrotRules() []brainrotState {
	entries, err := os.ReadDir(brainrotDir)
	if err != nil {
		return nil
	}
	out := make([]brainrotState, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		st, err := loadBrainrotState(brainrotDir + "/" + e.Name())
		if err != nil {
			log.Printf("brainrot dns: load %s: %v", e.Name(), err)
			continue
		}
		out = append(out, *st)
	}
	return out
}

// matchesAny suffix-matches a queried domain against a list of blocked
// domains. `youtube.com` matches `youtube.com` itself OR anything ending
// in `.youtube.com` (subdomains). Case-fold for safety. Trailing dots
// from FQDN form are stripped.
func matchesAny(domain string, blocked []string) bool {
	d := strings.ToLower(strings.TrimSuffix(domain, "."))
	for _, b := range blocked {
		b = strings.ToLower(strings.TrimSpace(b))
		if b == "" {
			continue
		}
		if d == b || strings.HasSuffix(d, "."+b) {
			return true
		}
	}
	return false
}

// parseDnsmasqLine extracts (txid, kind, srcIP, domain, payload) from one
// line of dnsmasq's query log. srcIP is the client that asked, peeled
// from "<src>/<port>" in field[1]. Used by the brainrot watcher to
// attribute each query to a MAC via the lease cache.
//
// Expected formats:
//
//	... <txid> 192.168.1.159/51428 query[A] www.youtube.com from 192.168.1.159
//	... <txid> 192.168.1.159/51428 reply www.youtube.com is <CNAME>
//	... <txid> 192.168.1.159/51428 reply youtube-ui.l.google.com is 142.251.219.46
//	... <txid> 192.168.1.159/51428 cached youtube.com is 142.251.219.142
//	... <txid> 192.168.1.159/51428 forwarded www.youtube.com to 192.168.4.1
//
// "cached" is treated as a reply (carries the final IP); "forwarded" is
// ignored.
func parseDnsmasqLine(line string) (txid int, kind, srcIP, domain, payload string, ok bool) {
	idx := strings.Index(line, "dnsmasq[")
	if idx == -1 {
		return 0, "", "", "", "", false
	}
	rest := line[idx:]
	close := strings.Index(rest, "]: ")
	if close == -1 {
		return 0, "", "", "", "", false
	}
	rest = rest[close+3:]
	// Now rest starts with: "<txid> <src>/<port> <kind> <domain> ..."
	fields := strings.Fields(rest)
	if len(fields) < 4 {
		return 0, "", "", "", "", false
	}
	id, err := strconv.Atoi(fields[0])
	if err != nil {
		return 0, "", "", "", "", false
	}
	// fields[1] is "<src-ip>/<port>" — split to grab the IP.
	src := fields[1]
	if slash := strings.LastIndex(src, "/"); slash >= 0 {
		src = src[:slash]
	}
	k := fields[2]
	dom := fields[3]
	if strings.HasPrefix(k, "query[") {
		k = "query"
	} else if k == "cached" {
		k = "reply"
	} else if k != "reply" {
		return 0, "", "", "", "", false
	}
	if k == "reply" && len(fields) >= 6 && fields[4] == "is" {
		return id, k, src, dom, fields[5], true
	}
	if k == "query" {
		return id, k, src, dom, "", true
	}
	return 0, "", "", "", "", false
}
