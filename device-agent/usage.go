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

// usageBucket is one minute-aligned aggregation for (mac, app). Multiple
// buckets per minute (one per app) are valid. The dashboard sums DISTINCT
// minute-buckets in the BRAINROT_APPS set for the brainrot meter and
// shows the top apps individually as "TikTok 8m / YouTube 5m / ...".
type usageBucket struct {
	Mac        string `json:"mac"`
	MinuteUTC  string `json:"minute_utc"` // RFC3339, minute-truncated
	App        string `json:"app"`
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

func (s *usageStore) record(mac, app string, ts time.Time) {
	if mac == "" || app == "" {
		return
	}
	minute := ts.UTC().Truncate(time.Minute).Format(time.RFC3339)
	key := mac + "|" + minute + "|" + app
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.buckets[key]
	if !ok {
		b = &usageBucket{Mac: mac, MinuteUTC: minute, App: app}
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

// appDomains: domain (suffix) → user-facing app name. A query matches if
// the queried name equals a key OR ends with `.<key>`. Order doesn't
// matter; ambiguous overlaps don't exist in this set.
var appDomains = map[string]string{
	// Short-form video / social
	"tiktokv.com": "TikTok", "tiktokcdn.com": "TikTok", "tiktokcdn-us.com": "TikTok",
	"tiktok.com": "TikTok", "musical.ly": "TikTok", "byteoversea.com": "TikTok",
	"byteglb.com": "TikTok", "bytedance.com": "TikTok", "ttwstatic.com": "TikTok",
	"instagram.com": "Instagram", "cdninstagram.com": "Instagram",
	"snapchat.com": "Snapchat", "sc-cdn.net": "Snapchat", "snap.com": "Snapchat",
	"twitter.com": "X", "x.com": "X", "twimg.com": "X", "t.co": "X",
	"facebook.com": "Facebook", "fbcdn.net": "Facebook", "fbsbx.com": "Facebook",
	"reddit.com": "Reddit", "redd.it": "Reddit", "redditstatic.com": "Reddit",
	"discord.com": "Discord", "discordapp.com": "Discord",
	// Long-form video
	"youtube.com": "YouTube", "youtu.be": "YouTube",
	"ytimg.com": "YouTube", "googlevideo.com": "YouTube", "ggpht.com": "YouTube",
	"netflix.com": "Netflix", "nflxvideo.net": "Netflix", "nflximg.com": "Netflix",
	"twitch.tv": "Twitch", "ttvnw.net": "Twitch",
	"hulu.com": "Hulu",
	"hbomax.com": "HBO Max", "max.com": "HBO Max",
	"disneyplus.com": "Disney+",
	"primevideo.com": "Prime Video",
	"vimeo.com": "Vimeo",
	// Games
	"roblox.com": "Roblox", "rbxcdn.com": "Roblox",
	"epicgames.com": "Fortnite", "fortnitecdn.com": "Fortnite",
	"minecraft.net": "Minecraft", "mojang.com": "Minecraft",
	"steampowered.com": "Steam", "steamcontent.com": "Steam",
	"battle.net": "Battle.net", "blizzard.com": "Battle.net",
	// Learning
	"khanacademy.org": "Khan Academy", "kastatic.org": "Khan Academy", "kasandbox.org": "Khan Academy",
	"ted.com": "TED", "tedcdn.com": "TED",
	"duolingo.com": "Duolingo",
	"wikipedia.org": "Wikipedia", "wikimedia.org": "Wikipedia",
	"scratch.mit.edu": "Scratch",
	"code.org": "Code.org",
	"brainpop.com": "BrainPOP",
	"nationalgeographic.com": "National Geographic", "natgeokids.com": "National Geographic",
}

func classifyApp(domain string) string {
	d := strings.ToLower(strings.TrimSuffix(domain, "."))
	if app, ok := appDomains[d]; ok {
		return app
	}
	for pattern, app := range appDomains {
		if strings.HasSuffix(d, "."+pattern) {
			return app
		}
	}
	return "" // unknown — don't bucket
}

// parseDNSLine extracts MAC + app from one dnsmasq query log line.
// Expected format:
//
//	dnsmasq[1234]: query[A] tiktokv.com from 192.168.1.221
//
// Returns "" for either if the line doesn't match a known app's domain.
func parseDNSLine(line string, leaseCache map[string]string) (mac, app string) {
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
	app = classifyApp(domain)
	return mac, app
}

// refreshLeaseCache rebuilds an IP→MAC map. Two sources, merged:
//
//  1. /tmp/dhcp.leases — every IPv4 lease the dnsmasq DHCP server has
//     handed out, even if the device is currently idle.
//  2. `ip neigh show` — the live neighbour table, which is the ONLY source
//     of IPv6 → MAC mappings (DHCP leases is IPv4-only). Both IPv6 ULA
//     (fd00::/8) and globally-routable IPv6 get covered here.
//
// Without (2), every DNS query whose source IP is an IPv6 address gets
// dropped on the floor — and modern phones / Chrome on desktop strongly
// prefer IPv6, so on a dual-stack LAN that's a large fraction of traffic.
// fe80:: link-local entries are skipped (rarely originate DNS).
func refreshLeaseCache() map[string]string {
	cache := make(map[string]string)
	if b, err := os.ReadFile("/tmp/dhcp.leases"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 3 {
				cache[fields[2]] = strings.ToLower(fields[1])
			}
		}
	}
	if out, err := run("ip", "neigh", "show"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 5 {
				continue
			}
			ip := fields[0]
			if strings.HasPrefix(ip, "fe80") {
				continue
			}
			for i, f := range fields {
				if f == "lladdr" && i+1 < len(fields) {
					if _, present := cache[ip]; !present {
						cache[ip] = strings.ToLower(fields[i+1])
					}
				}
			}
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
			mac, app := parseDNSLine(line, leaseCache)
			if mac != "" && app != "" {
				store.record(mac, app, time.Now())
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
