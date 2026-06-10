package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// creditPool — the kid's earn-to-unlock balance, on-device.
//
// Conceptually: each MAC has a credit balance (minutes the kid can spend
// to extend any schedule rule's daily quota). The server pushes the
// CURRENT balance into every schedule rule's policy.json file when it
// materialises (any grant via Bri → push + version bump). The pool here
// is the agent's live view, updated by two paths:
//
//   - resync(macToBalance): called when a policy is loaded, replaces the
//     pool's snapshot for those MACs minus what the agent has spent
//     locally since the last snapshot landed.
//   - spend(mac, ruleID): called by the policy engine when a kid hits a
//     schedule rule's quota AND the rule's policy includes their MAC in
//     credit_balance_by_mac. Decrements the live balance, records the
//     spend in today's per-(mac, rule_id) tally for telemetry.
//
// Persistence (/etc/braintech/credit-pool.json): snapshot every 60s and
// at shutdown so an agent restart doesn't lose mid-day spending state.
// Day key resets at midnight; older days GC'd at 14 days.

const (
	creditPoolPath = "/etc/braintech/credit-pool.json"
)

type creditPool struct {
	mu sync.Mutex
	// Live balance per MAC. Server's authoritative value minus any
	// post-snapshot spending we haven't yet had ack'd through telemetry.
	balance map[string]int
	// Total spend today per (mac, rule_id, day) — reported in telemetry
	// so the server can update its ledger + balance. Days older than
	// today are kept for two ticks so the final spend report gets
	// through after a midnight boundary, then GC'd.
	spendByDay map[string]map[string]map[string]int // [day][mac][rule_id] → minutes
	// "Latest snapshot received from server" per MAC, recorded so
	// resync() can correctly diff "server's view vs my local
	// post-snapshot spend".
	snapshot map[string]int
}

func newCreditPool() *creditPool {
	return &creditPool{
		balance:    make(map[string]int),
		spendByDay: make(map[string]map[string]map[string]int),
		snapshot:   make(map[string]int),
	}
}

// resync replaces the agent's view of a MAC's balance with the server's
// snapshot, accounting for any spend that's happened locally since the
// last snapshot was loaded (i.e. mid-tick grants don't clobber an active
// kid's deductions).
func (p *creditPool) resync(macToBalance map[string]int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	day := time.Now().Format("2006-01-02")
	for mac, serverBalance := range macToBalance {
		mac = strings.ToLower(mac)
		oldSnapshot := p.snapshot[mac]
		grant := serverBalance - oldSnapshot
		// Live balance starts from server's number, plus any new grant
		// (already in serverBalance), minus what we've locally spent
		// since the last snapshot.
		_ = grant
		spentSinceSnapshot := 0
		if dayMap, ok := p.spendByDay[day]; ok {
			if perRule, ok := dayMap[mac]; ok {
				for _, n := range perRule {
					spentSinceSnapshot += n
				}
			}
		}
		live := serverBalance - spentSinceSnapshot
		if live < 0 {
			live = 0
		}
		p.balance[mac] = live
		p.snapshot[mac] = serverBalance
	}
}

// spend tries to consume one minute of credit for (mac, ruleID).
// Returns true on success, false if the MAC has no balance.
func (p *creditPool) spend(mac, ruleID string) bool {
	mac = strings.ToLower(mac)
	if mac == "" || ruleID == "" {
		return false
	}
	day := time.Now().Format("2006-01-02")
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.balance[mac] <= 0 {
		return false
	}
	p.balance[mac]--
	dayMap, ok := p.spendByDay[day]
	if !ok {
		dayMap = make(map[string]map[string]int)
		p.spendByDay[day] = dayMap
	}
	macMap, ok := dayMap[mac]
	if !ok {
		macMap = make(map[string]int)
		dayMap[mac] = macMap
	}
	macMap[ruleID]++
	return true
}

// balanceOf returns the live balance for a MAC (read-only, locked).
func (p *creditPool) balanceOf(mac string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.balance[strings.ToLower(mac)]
}

// CreditSpendReport is the telemetry payload — server-side telemetry
// handler writes one ledger row per (mac, rule_id, day) and updates
// brain_credits.
type CreditSpendReport struct {
	MAC          string `json:"mac"`
	RuleID       string `json:"rule_id"`
	Day          string `json:"day"`     // YYYY-MM-DD
	SpendMinutes int    `json:"spend_minutes"`
}

// CreditSpendReports returns a flat slice of (mac, rule_id, day, spend)
// across all days currently in memory. Telemetry sends this every 60s;
// the server is idempotent — it stores the MAX(spend) per
// (mac, rule_id, day) tuple, so multiple reports of the same day's
// accumulating count are safe.
func (p *creditPool) reports() []CreditSpendReport {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]CreditSpendReport, 0, 8)
	for day, byMac := range p.spendByDay {
		for mac, byRule := range byMac {
			for ruleID, mins := range byRule {
				if mins > 0 {
					out = append(out, CreditSpendReport{
						MAC: mac, RuleID: ruleID, Day: day, SpendMinutes: mins,
					})
				}
			}
		}
	}
	return out
}

// CreditReports exposes the agent's per-(mac, rule_id, day) consumption
// to the telemetry goroutine. Mirrors PolicyDecisions() in shape.
func CreditReports() []CreditSpendReport {
	return globalCreditPool.reports()
}

// Persistence — snapshot every minute and at shutdown so a restart
// keeps mid-day spending accurate.

type creditPoolSnapshot struct {
	Balance    map[string]int                       `json:"balance"`
	Snapshot   map[string]int                       `json:"snapshot"`
	SpendByDay map[string]map[string]map[string]int `json:"spend_by_day"`
}

func (p *creditPool) loadFromDisk() {
	b, err := os.ReadFile(creditPoolPath)
	if err != nil {
		return
	}
	var s creditPoolSnapshot
	if err := json.Unmarshal(b, &s); err != nil {
		log.Printf("credits: load %s: %v", creditPoolPath, err)
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if s.Balance != nil {
		p.balance = s.Balance
	}
	if s.Snapshot != nil {
		p.snapshot = s.Snapshot
	}
	if s.SpendByDay != nil {
		p.spendByDay = s.SpendByDay
	}
}

func (p *creditPool) snapshotToDisk(now time.Time) {
	cutoff := now.AddDate(0, 0, -14).Format("2006-01-02")
	p.mu.Lock()
	for day := range p.spendByDay {
		if day < cutoff {
			delete(p.spendByDay, day)
		}
	}
	out := creditPoolSnapshot{
		Balance:    map[string]int{},
		Snapshot:   map[string]int{},
		SpendByDay: map[string]map[string]map[string]int{},
	}
	for k, v := range p.balance {
		out.Balance[k] = v
	}
	for k, v := range p.snapshot {
		out.Snapshot[k] = v
	}
	for d, m := range p.spendByDay {
		out.SpendByDay[d] = m
	}
	p.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(creditPoolPath), 0o755); err != nil {
		log.Printf("credits: mkdir: %v", err)
		return
	}
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		log.Printf("credits: marshal: %v", err)
		return
	}
	tmp := creditPoolPath + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		log.Printf("credits: write: %v", err)
		return
	}
	if err := os.Rename(tmp, creditPoolPath); err != nil {
		log.Printf("credits: rename: %v", err)
	}
}

var globalCreditPool = newCreditPool()
