package main

import (
	"bufio"
	"context"
	"log"
	"os"
	"strings"
	"sync"
	"time"
)

// usageBucket is one minute-aligned aggregation for (mac, category).
// Multiple buckets per minute (one per category) are valid. The dashboard
// counts DISTINCT minute-buckets in (social|video|games) for "brainrot".
type usageBucket struct {
	Mac        string `json:"mac"`
	MinuteUTC  string `json:"minute_utc"` // RFC3339, minute-truncated
	Category   string `json:"category"`
	QueryCount int    `json:"query_count"`
}

// usageStore is an in-memory aggregator. The DNS log tailer increments
// buckets; the telemetry loop drains them every 60s.
type usageStore struct {
	mu      sync.Mutex
	buckets map[string]*usageBucket // key: mac|minute|category
}

func newUsageStore() *usageStore {
	return &usageStore{buckets: make(map[string]*usageBucket)}
}

func (s *usageStore) record(mac, category string, ts time.Time) {
	if mac == "" || category == "" {
		return
	}
	minute := ts.UTC().Truncate(time.Minute).Format(time.RFC3339)
	key := mac + "|" + minute + "|" + category
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.buckets[key]
	if !ok {
		b = &usageBucket{Mac: mac, MinuteUTC: minute, Category: category}
		s.buckets[key] = b
	}
	b.QueryCount++
}

// drain returns all buckets and resets the store.
func (s *usageStore) drain() []usageBucket {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]usageBucket, 0, len(s.buckets))
	for _, b := range s.buckets {
		out = append(out, *b)
	}
	s.buckets = make(map[string]*usageBucket)
	return out
}

// categoryDomains: domain suffixes we treat as the named category. A query
// matches a category if the queried name equals one of the patterns OR ends
// with `.<pattern>`. The server stores whatever we send; this table is the
// source of truth for now.
var categoryDomains = map[string][]string{
	"social": {
		"tiktokv.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktok.com",
		"musical.ly", "byteoversea.com", "ttwstatic.com",
		"instagram.com", "cdninstagram.com",
		"snapchat.com", "sc-cdn.net", "snap.com",
		"twitter.com", "x.com", "twimg.com", "t.co",
		"facebook.com", "fbcdn.net", "fbsbx.com",
		"reddit.com", "redd.it", "redditstatic.com",
	},
	"video": {
		"youtube.com", "ytimg.com", "googlevideo.com", "ggpht.com", "youtu.be",
		"netflix.com", "nflxvideo.net", "nflximg.com",
		"twitch.tv", "ttvnw.net",
		"hulu.com", "hbomax.com", "max.com",
		"disneyplus.com", "primevideo.com",
		"vimeo.com",
	},
	"games": {
		"roblox.com", "rbxcdn.com",
		"epicgames.com", "fortnitecdn.com",
		"minecraft.net", "mojang.com",
		"discord.com", "discordapp.com",
		"steamcontent.com", "steampowered.com",
		"battle.net", "blizzard.com",
	},
	"learning": {
		"khanacademy.org", "kastatic.org", "kasandbox.org",
		"ted.com", "tedcdn.com",
		"duolingo.com",
		"wikipedia.org", "wikimedia.org",
		"scratch.mit.edu",
		"code.org",
		"brainpop.com",
		"nationalgeographic.com", "natgeokids.com",
	},
}

func classifyDomain(domain string) string {
	d := strings.ToLower(strings.TrimSuffix(domain, "."))
	for cat, patterns := range categoryDomains {
		for _, p := range patterns {
			if d == p || strings.HasSuffix(d, "."+p) {
				return cat
			}
		}
	}
	return "" // unknown — don't bucket
}

// parseDNSLine extracts MAC + category from one dnsmasq query log line.
// Expected format:
//
//	dnsmasq[1234]: query[A] tiktokv.com from 192.168.1.221
//
// Returns "" for either if the line doesn't match a categorised query.
func parseDNSLine(line string, leaseCache map[string]string) (mac, category string) {
	qi := strings.Index(line, " query[")
	if qi == -1 {
		return "", ""
	}
	rest := line[qi+len(" query["):]
	closeBracket := strings.Index(rest, "] ")
	if closeBracket == -1 {
		return "", ""
	}
	rest = rest[closeBracket+2:]

	spaceIdx := strings.Index(rest, " ")
	if spaceIdx == -1 {
		return "", ""
	}
	domain := rest[:spaceIdx]
	rest = rest[spaceIdx:]

	fromIdx := strings.Index(rest, " from ")
	if fromIdx == -1 {
		return "", ""
	}
	ip := strings.TrimSpace(rest[fromIdx+len(" from "):])
	// Strip any port suffix the log might have appended.
	if colon := strings.LastIndex(ip, "#"); colon > -1 {
		ip = ip[:colon]
	}

	mac = leaseCache[ip]
	if mac == "" {
		return "", ""
	}
	category = classifyDomain(domain)
	return mac, category
}

// refreshLeaseCache rebuilds an IP→MAC map from the current DHCP leases.
func refreshLeaseCache() map[string]string {
	cache := make(map[string]string)
	b, err := os.ReadFile("/tmp/dhcp.leases")
	if err != nil {
		return cache
	}
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		// expiry mac ip hostname clientid
		if len(fields) >= 3 {
			cache[fields[2]] = strings.ToLower(fields[1])
		}
	}
	return cache
}

// tailDNSLog reads dnsmasq queries in real time, classifies them, and
// records each into the usage store. Handles file rotation (truncation
// or replacement) by reopening when it spots one.
func tailDNSLog(ctx context.Context, store *usageStore, path string) {
	// Block until the file exists.
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

	var leaseCache map[string]string
	var leaseAt time.Time

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
		// Start at the tail; we don't replay history each restart.
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
				// EOF — wait briefly, then check whether the file rotated.
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
					// File was truncated/replaced — reopen.
					f.Close()
					goto reopen
				}
				continue
			}
			if time.Since(leaseAt) > 10*time.Second {
				leaseCache = refreshLeaseCache()
				leaseAt = time.Now()
			}
			mac, cat := parseDNSLine(line, leaseCache)
			if mac != "" && cat != "" {
				store.record(mac, cat, time.Now())
			}
		}
	reopen:
	}
}

// rotateDNSLog keeps /tmp/dnsmasq.log from growing unbounded. Every 30s
// truncate it if it's over maxSize. The tail loop notices the truncation
// and reopens at offset 0.
func rotateDNSLog(ctx context.Context, path string, maxSize int64) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
		fi, err := os.Stat(path)
		if err != nil {
			continue
		}
		if fi.Size() > maxSize {
			if err := os.Truncate(path, 0); err != nil {
				log.Printf("dnsmasq log truncate failed: %v", err)
			}
		}
	}
}
