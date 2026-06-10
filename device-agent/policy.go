package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// quotaCounter tracks minutes-with-activity per (rule_id, mac, day) on the
// router. brainrotDNSWatcher records into it every time a query from a
// rule-member MAC matches a rule's domain list.
//
// Persistence: snapshot to disk every minute and on shutdown; reload on
// boot. Keeps the kid from rebooting their way out of a quota. Old day
// keys (>14 days) are GC'd on each snapshot.
//
// "Minutes" = distinct minute-of-day buckets where at least one
// matching query was observed. Same semantics as the dashboard meter.
const (
	quotaCounterPath = "/etc/braintech/quota-counter.json"
	quotaDayKeepDays = 14
)

type quotaCounter struct {
	mu     sync.Mutex
	active map[string]map[string]map[string]map[int]bool // [ruleID][mac][YYYY-MM-DD][minOfDay]
}

func newQuotaCounter() *quotaCounter {
	return &quotaCounter{active: make(map[string]map[string]map[string]map[int]bool)}
}

func (c *quotaCounter) record(ruleID, mac string, ts time.Time) {
	if ruleID == "" || mac == "" {
		return
	}
	mac = strings.ToLower(mac)
	day := ts.Format("2006-01-02")
	minute := ts.Hour()*60 + ts.Minute()
	c.mu.Lock()
	defer c.mu.Unlock()
	rd := c.active[ruleID]
	if rd == nil {
		rd = make(map[string]map[string]map[int]bool)
		c.active[ruleID] = rd
	}
	md := rd[mac]
	if md == nil {
		md = make(map[string]map[int]bool)
		rd[mac] = md
	}
	dd := md[day]
	if dd == nil {
		dd = make(map[int]bool)
		md[day] = dd
	}
	dd[minute] = true
}

// countPeriod sums DISTINCT minute-buckets across the given days for
// any of the given MACs. Returns total minutes used by the group during
// the period.
func (c *quotaCounter) countPeriod(ruleID string, macs []string, dayKeys []string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	rd, ok := c.active[ruleID]
	if !ok {
		return 0
	}
	// Use a set to avoid double-counting the same minute if two MACs
	// were both active in it.
	seen := make(map[string]bool, 32)
	for _, mac := range macs {
		md, ok := rd[strings.ToLower(mac)]
		if !ok {
			continue
		}
		for _, day := range dayKeys {
			for min := range md[day] {
				seen[day+":"+fmt.Sprintf("%04d", min)] = true
			}
		}
	}
	return len(seen)
}

// periodDayKeys returns the YYYY-MM-DD strings making up the requested
// period relative to "now". Implementation note: ISO week starts on
// Monday for week/weekday/weekend semantics; that matches what parents
// mean by "this weekend".
func periodDayKeys(period string, now time.Time) []string {
	switch period {
	case "day":
		return []string{now.Format("2006-01-02")}
	case "weekend":
		// Saturday + Sunday of the current ISO week (Mon=1, Sun=7).
		mondayOffset := int(now.Weekday())
		if mondayOffset == 0 {
			mondayOffset = 7 // Sunday → 7 days from previous Monday
		}
		monday := now.AddDate(0, 0, -(mondayOffset - 1))
		sat := monday.AddDate(0, 0, 5)
		sun := monday.AddDate(0, 0, 6)
		return []string{sat.Format("2006-01-02"), sun.Format("2006-01-02")}
	case "weekday":
		mondayOffset := int(now.Weekday())
		if mondayOffset == 0 {
			mondayOffset = 7
		}
		monday := now.AddDate(0, 0, -(mondayOffset - 1))
		out := make([]string, 5)
		for i := 0; i < 5; i++ {
			out[i] = monday.AddDate(0, 0, i).Format("2006-01-02")
		}
		return out
	case "week":
		mondayOffset := int(now.Weekday())
		if mondayOffset == 0 {
			mondayOffset = 7
		}
		monday := now.AddDate(0, 0, -(mondayOffset - 1))
		out := make([]string, 7)
		for i := 0; i < 7; i++ {
			out[i] = monday.AddDate(0, 0, i).Format("2006-01-02")
		}
		return out
	}
	return nil
}

// loadFromDisk replaces the in-memory counter with the snapshot at
// quotaCounterPath. Safe to call on an empty/missing file (no-op).
func (c *quotaCounter) loadFromDisk() {
	b, err := os.ReadFile(quotaCounterPath)
	if err != nil {
		return
	}
	// On-disk format: { ruleID: { mac: { day: [min, min, ...] } } } —
	// arrays instead of bool-maps for JSON compactness.
	var raw map[string]map[string]map[string][]int
	if err := json.Unmarshal(b, &raw); err != nil {
		log.Printf("quota: load %s: %v", quotaCounterPath, err)
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.active = make(map[string]map[string]map[string]map[int]bool, len(raw))
	for ruleID, macMap := range raw {
		rd := make(map[string]map[string]map[int]bool, len(macMap))
		c.active[ruleID] = rd
		for mac, dayMap := range macMap {
			md := make(map[string]map[int]bool, len(dayMap))
			rd[mac] = md
			for day, mins := range dayMap {
				dd := make(map[int]bool, len(mins))
				md[day] = dd
				for _, m := range mins {
					dd[m] = true
				}
			}
		}
	}
}

// snapshotToDisk writes the current counter, GC'ing day-keys older than
// quotaDayKeepDays as we go.
func (c *quotaCounter) snapshotToDisk(now time.Time) {
	cutoff := now.AddDate(0, 0, -quotaDayKeepDays).Format("2006-01-02")
	c.mu.Lock()
	out := make(map[string]map[string]map[string][]int, len(c.active))
	for ruleID, macMap := range c.active {
		rd := make(map[string]map[string][]int, len(macMap))
		for mac, dayMap := range macMap {
			md := make(map[string][]int, len(dayMap))
			for day, mins := range dayMap {
				if day < cutoff {
					delete(dayMap, day)
					continue
				}
				arr := make([]int, 0, len(mins))
				for m := range mins {
					arr = append(arr, m)
				}
				md[day] = arr
			}
			if len(md) > 0 {
				rd[mac] = md
			}
		}
		if len(rd) > 0 {
			out[ruleID] = rd
		}
	}
	c.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(quotaCounterPath), 0o755); err != nil {
		log.Printf("quota: mkdir: %v", err)
		return
	}
	tmp := quotaCounterPath + ".tmp"
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		log.Printf("quota: marshal: %v", err)
		return
	}
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		log.Printf("quota: write: %v", err)
		return
	}
	if err := os.Rename(tmp, quotaCounterPath); err != nil {
		log.Printf("quota: rename: %v", err)
	}
}

// quotaSnapshotLoop persists the counter every minute. The policy
// evaluator also runs every minute but on a separate ticker; these
// two cadences are independent on purpose so the engine's decision
// doesn't depend on the snapshot succeeding.
func quotaSnapshotLoop(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(60 * time.Second):
		}
		globalQuotaCounter.snapshotToDisk(time.Now())
	}
}

// globalQuotaCounter is read by policy.evaluate (via quotaAllows) and
// written by brainrotDNSWatcher. Package-level so the two goroutines
// can share state without threading a struct everywhere.
var globalQuotaCounter = newQuotaCounter()

// PolicyDecision is the engine's per-rule output for one evaluation tick.
// Snapshotted to globalDecisions at every tick and shipped in telemetry
// so the dashboard can show WHICH allow clause is currently letting the
// kid through (or which quota's about to flip them into enforce).
//
// Fields are kept small + JSON-friendly. The TS side mirrors this shape.
type PolicyDecision struct {
	RuleID         string `json:"rule_id"`
	Decision       string `json:"decision"` // "allow" | "enforce"
	EvaluatedAt    string `json:"evaluated_at"`
	MinutesUsedDay int    `json:"minutes_used_day"`
	// If allow because a time window matched, the window. Else nil.
	ActiveWindow *DecisionWindow `json:"active_window,omitempty"`
	// If allow because a quota matched (used < max), the quota + counts.
	// If enforce, the closest-to-overflow quota (so the UI can say
	// "120/120 min used today" — the obvious reason for the block).
	ActiveQuota *DecisionQuota `json:"active_quota,omitempty"`
	// Next time window for this rule (allowing OR not), so the UI can
	// say "Next opens Sat 14:00" when the rule is currently enforcing.
	NextWindowAt string `json:"next_window_at,omitempty"` // RFC3339 local
}

type DecisionWindow struct {
	Days     []string `json:"days"`
	StartMin int      `json:"start_min_of_day"`
	EndMin   int      `json:"end_min_of_day"`
}

type DecisionQuota struct {
	Period       string `json:"period"`
	MinutesUsed  int    `json:"minutes_used"`
	MinutesMax   int    `json:"minutes_max"`
}

type decisionStore struct {
	mu sync.Mutex
	m  map[string]PolicyDecision
}

func (d *decisionStore) set(p PolicyDecision) {
	d.mu.Lock()
	d.m[p.RuleID] = p
	d.mu.Unlock()
}

func (d *decisionStore) snapshot() []PolicyDecision {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]PolicyDecision, 0, len(d.m))
	for _, v := range d.m {
		out = append(out, v)
	}
	return out
}

// PolicyDecisions exposes the latest evaluator output to the telemetry
// goroutine. Called once per telemetry tick (60s, same cadence as
// evaluation), so reads see at most one decision-cycle of staleness.
func PolicyDecisions() []PolicyDecision {
	return globalDecisions.snapshot()
}

var globalDecisions = &decisionStore{m: make(map[string]PolicyDecision)}

/*
policyEvaluator — on-device rule engine.

The cloud writes one JSON file per active policy to /etc/braintech/policy/.
This goroutine reads them every minute, decides whether each policy should
currently ENFORCE (block) or ALLOW (pass-through), and toggles the
corresponding nft MAC set accordingly:

	enforce → MAC set populated with the kid's MACs → chain matches → reject
	allow   → MAC set empty                          → chain doesn't match → packets pass

The nft chain, IP sets, and DNS-tail IP-population are unchanged — they
already exist from the brainrot rule mechanism. The only new pre-existing
plumbing is "what's in the MAC set right this second", which is what we
toggle.

Schema: see app/lib/rules.ts -> BlockUnlessPolicy. Kept tiny + stable.

Today the engine supports one kind: "block_unless". Adding a kind = add a
type tag to the JSON + handle it in evaluate().

Quota tracking is stubbed (allowQuotaMatches always returns false right
now) — the framework around it is in place so the next push wires it to
a local minute counter (or to client_usage_minute if we want server-of-
truth). Comments mark the exact line to swap.
*/

const policyDir = "/etc/braintech/policy"

type policyDoc struct {
	Kind         string        `json:"kind"`
	RuleID       string        `json:"rule_id"`
	AppLabel     string        `json:"app_label"`
	Domains      []string      `json:"domains"`
	MACs         []string      `json:"macs"`
	NftMacSet    string        `json:"nft_mac_set"`
	AllowWindows []timeWindow  `json:"allow_windows"`
	AllowQuotas  []quotaWindow `json:"allow_quotas"`
	UpdatedAt    string        `json:"updated_at"`
	// BaselineByDay seeds the on-device quota counter with per-MAC
	// minutes already used today (from the server's client_usage_minute
	// table at rule-apply time). Lets the engine make decisions against
	// the FULL day's usage, not just what it observed since deploy.
	// Format: { "YYYY-MM-DD": { "mac": minutes_used } }. Only the apply
	// day is populated; subsequent days fall back to the live counter.
	BaselineByDay map[string]map[string]int `json:"baseline_by_day,omitempty"`
}

type timeWindow struct {
	Days          []string `json:"days"`             // {"mon","tue",...}
	StartMinOfDay int      `json:"start_min_of_day"` // 0..1439, local time
	EndMinOfDay   int      `json:"end_min_of_day"`
}

type quotaWindow struct {
	Period     string `json:"period"`      // day | week | weekend | weekday
	MinutesMax int    `json:"minutes_max"` // budget in this period
}

func policyEvaluatorLoop(ctx context.Context) {
	// Load persisted counter before the first evaluation so a reboot
	// during the kid's allotted window doesn't reset their minutes.
	globalQuotaCounter.loadFromDisk()
	go quotaSnapshotLoop(ctx)

	// First tick happens immediately so a freshly-applied rule lands the
	// correct enforcement state without a one-minute wait.
	for {
		if ctx.Err() != nil {
			// Final snapshot so we don't lose the last minute.
			globalQuotaCounter.snapshotToDisk(time.Now())
			return
		}
		evaluateAllPolicies(ctx, time.Now())
		select {
		case <-ctx.Done():
			globalQuotaCounter.snapshotToDisk(time.Now())
			return
		case <-time.After(60 * time.Second):
		}
	}
}

func evaluateAllPolicies(ctx context.Context, now time.Time) {
	entries, err := os.ReadDir(policyDir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("policy: read %s: %v", policyDir, err)
		}
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		path := filepath.Join(policyDir, e.Name())
		doc, err := loadPolicy(path)
		if err != nil {
			log.Printf("policy: load %s: %v", path, err)
			continue
		}
		decision, report := evaluate(doc, now)
		globalDecisions.set(report)
		if err := applyDecision(ctx, doc, decision); err != nil {
			log.Printf("policy: apply %s (%s): %v", doc.RuleID, decision, err)
		}
	}
}

func loadPolicy(path string) (*policyDoc, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	doc := &policyDoc{}
	if err := json.Unmarshal(b, doc); err != nil {
		return nil, err
	}
	return doc, nil
}

type decision string

const (
	decisionEnforce decision = "enforce" // block — populate MAC set
	decisionAllow   decision = "allow"   // pass-through — clear MAC set
)

// evaluate is the policy engine's brain. Today it understands one kind
// (block_unless). Add new kinds here. Returns the decision PLUS the
// reason — which window/quota matched, current minutes used, etc. —
// so the dashboard can show parents what's actually deciding the state.
func evaluate(doc *policyDoc, now time.Time) (decision, PolicyDecision) {
	dayKeys := periodDayKeys("day", now)
	report := PolicyDecision{
		RuleID:      doc.RuleID,
		EvaluatedAt: now.Format(time.RFC3339),
		MinutesUsedDay: globalQuotaCounter.countPeriod(doc.RuleID, doc.MACs, dayKeys) +
			baselineFor(doc, doc.MACs, dayKeys),
	}
	if doc.Kind != "block_unless" {
		report.Decision = string(decisionEnforce)
		return decisionEnforce, report
	}
	if len(doc.AllowWindows) == 0 && len(doc.AllowQuotas) == 0 {
		report.Decision = string(decisionEnforce)
		return decisionEnforce, report
	}
	for _, w := range doc.AllowWindows {
		if windowMatches(w, now) {
			report.Decision = string(decisionAllow)
			report.ActiveWindow = &DecisionWindow{
				Days:     append([]string{}, w.Days...),
				StartMin: w.StartMinOfDay,
				EndMin:   w.EndMinOfDay,
			}
			return decisionAllow, report
		}
	}
	for _, q := range doc.AllowQuotas {
		days := periodDayKeys(q.Period, now)
		used := globalQuotaCounter.countPeriod(doc.RuleID, doc.MACs, days) +
			baselineFor(doc, doc.MACs, days)
		if used < q.MinutesMax {
			report.Decision = string(decisionAllow)
			report.ActiveQuota = &DecisionQuota{
				Period:      q.Period,
				MinutesUsed: used,
				MinutesMax:  q.MinutesMax,
			}
			return decisionAllow, report
		}
	}
	// Enforcing: surface the "closest to overflow" quota so the dashboard
	// can say "120 / 120 min today" — the obvious reason it kicked in.
	// Pick the quota with the highest minutes_used (most-recently-exceeded).
	var closest *DecisionQuota
	for _, q := range doc.AllowQuotas {
		days := periodDayKeys(q.Period, now)
		used := globalQuotaCounter.countPeriod(doc.RuleID, doc.MACs, days) +
			baselineFor(doc, doc.MACs, days)
		if closest == nil || used > closest.MinutesUsed {
			closest = &DecisionQuota{
				Period:      q.Period,
				MinutesUsed: used,
				MinutesMax:  q.MinutesMax,
			}
		}
	}
	report.ActiveQuota = closest
	report.Decision = string(decisionEnforce)
	report.NextWindowAt = nextWindowOpen(doc.AllowWindows, now)
	return decisionEnforce, report
}

// nextWindowOpen returns the RFC3339 local timestamp of the next time
// any of the allow_windows opens, relative to `now`. Empty string if
// the rule has no windows or none open within the next 14 days.
//
// Walks day-by-day rather than per-window-per-day so we naturally pick
// the earliest match across all windows.
func nextWindowOpen(windows []timeWindow, now time.Time) string {
	if len(windows) == 0 {
		return ""
	}
	for d := 0; d < 14; d++ {
		when := now.AddDate(0, 0, d)
		wkday := weekdayCode[when.Weekday()]
		earliest := -1
		for _, w := range windows {
			ok := false
			for _, day := range w.Days {
				if strings.ToLower(day) == wkday {
					ok = true
					break
				}
			}
			if !ok {
				continue
			}
			candidate := w.StartMinOfDay
			if d == 0 && candidate <= now.Hour()*60+now.Minute() {
				continue
			}
			if earliest == -1 || candidate < earliest {
				earliest = candidate
			}
		}
		if earliest >= 0 {
			open := time.Date(when.Year(), when.Month(), when.Day(),
				earliest/60, earliest%60, 0, 0, now.Location())
			return open.Format(time.RFC3339)
		}
	}
	return ""
}

var weekdayCode = map[time.Weekday]string{
	time.Sunday:    "sun",
	time.Monday:    "mon",
	time.Tuesday:   "tue",
	time.Wednesday: "wed",
	time.Thursday:  "thu",
	time.Friday:    "fri",
	time.Saturday:  "sat",
}

func windowMatches(w timeWindow, now time.Time) bool {
	if w.EndMinOfDay <= w.StartMinOfDay {
		return false
	}
	today := weekdayCode[now.Weekday()]
	ok := false
	for _, d := range w.Days {
		if strings.ToLower(d) == today {
			ok = true
			break
		}
	}
	if !ok {
		return false
	}
	min := now.Hour()*60 + now.Minute()
	return min >= w.StartMinOfDay && min < w.EndMinOfDay
}

// quotaAllows reads globalQuotaCounter and returns true while the group
// is still under their budget for the requested period. Server-seeded
// baseline minutes (today's pre-rule usage) are added on top of the
// agent's live counter for any days that intersect the period — no
// double-counting because the agent's counter only sees queries since
// rule deploy, while the baseline captures everything before.
func quotaAllows(doc *policyDoc, q quotaWindow, now time.Time) bool {
	days := periodDayKeys(q.Period, now)
	if len(days) == 0 {
		return false // unknown period → fail closed
	}
	used := globalQuotaCounter.countPeriod(doc.RuleID, doc.MACs, days)
	used += baselineFor(doc, doc.MACs, days)
	return used < q.MinutesMax
}

// baselineFor sums seeded per-MAC minutes across the days that intersect
// the requested period. Lowercase MAC compare matches the rest of the
// counter's plumbing.
func baselineFor(doc *policyDoc, macs []string, days []string) int {
	if doc == nil || len(doc.BaselineByDay) == 0 {
		return 0
	}
	total := 0
	for _, day := range days {
		perMac, ok := doc.BaselineByDay[day]
		if !ok {
			continue
		}
		for _, mac := range macs {
			total += perMac[strings.ToLower(mac)]
		}
	}
	return total
}

// applyDecision flips the nft MAC set to match the engine's decision.
//
//	enforce → flush + add the kid's MACs back
//	allow   → flush (chain still installed, just doesn't match anyone)
//
// We flush-then-add rather than diff-by-element to keep the code dumb —
// the set typically has 1–5 MACs, the churn is negligible.
func applyDecision(ctx context.Context, doc *policyDoc, d decision) error {
	if doc.NftMacSet == "" {
		return fmt.Errorf("policy %s missing nft_mac_set", doc.RuleID)
	}
	sub, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	flush := exec.CommandContext(sub, "nft", "flush", "set", "inet", "fw4", doc.NftMacSet)
	flushOut, flushErr := flush.CombinedOutput()
	if flushErr != nil {
		if strings.Contains(string(flushOut), "No such file") ||
			strings.Contains(string(flushOut), "Could not process rule") {
			return nil
		}
		return fmt.Errorf("flush %s: %v: %s", doc.NftMacSet, flushErr, strings.TrimSpace(string(flushOut)))
	}
	if d == decisionAllow || len(doc.MACs) == 0 {
		return nil
	}
	macList := strings.Join(doc.MACs, ", ")
	addArg := "{ " + macList + " }"
	add := exec.CommandContext(sub, "nft",
		"add", "element", "inet", "fw4", doc.NftMacSet, addArg,
	)
	addOut, addErr := add.CombinedOutput()
	if addErr != nil {
		return fmt.Errorf("add %s: %v: %s", doc.NftMacSet, addErr, strings.TrimSpace(string(addOut)))
	}
	return nil
}
