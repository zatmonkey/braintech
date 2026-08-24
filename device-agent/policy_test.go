package main

import (
	"testing"
	"time"
)

// Window + quota must AND: blocked outside the window, and inside it only
// up to the quota. (Window-only and quota-only rules are covered by their
// long-standing behavior; this pins the new combined mode.)
func TestEvaluateWindowAndQuota(t *testing.T) {
	mac := "11:22:33:44:55:66"
	mkDoc := func() *policyDoc {
		return &policyDoc{
			Kind:         "block_unless",
			RuleID:       "sched_wk",
			MACs:         []string{mac},
			AllowWindows: []timeWindow{{Days: []string{"sat"}, StartMinOfDay: 0, EndMinOfDay: 1440}},
			AllowQuotas:  []quotaWindow{{Period: "day", MinutesMax: 30}},
		}
	}
	sat := time.Date(2026, 8, 22, 10, 0, 0, 0, time.UTC) // Saturday, in window
	wed := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC) // Wednesday, out of window

	// Out of window → enforce regardless of quota.
	if d, _ := evaluate(mkDoc(), wed); d != decisionEnforce {
		t.Errorf("out-of-window: got %s, want enforce", d)
	}
	// In window, under quota → allow.
	if d, _ := evaluate(mkDoc(), sat); d != decisionAllow {
		t.Errorf("in-window under-quota: got %s, want allow", d)
	}
	// In window, at/over quota → enforce. Seed the day's baseline to 30.
	doc := mkDoc()
	doc.BaselineByDay = map[string]map[string]int{"2026-08-22": {mac: 30}}
	if d, _ := evaluate(doc, sat); d != decisionEnforce {
		t.Errorf("in-window over-quota: got %s, want enforce", d)
	}
}

// The live counter and the server-seeded baseline overlap (the server
// re-seeds from its own usage table on every push), so usedMinutes must
// take the per-day MAX of the two, never the sum — summing is how a kid
// "reached" 70/30 the moment a mid-day credit grant pushed.
func TestUsedMinutesMergesBaselineAsMax(t *testing.T) {
	mac := "aa:bb:cc:dd:ee:ff"
	day := "2026-08-11"
	doc := &policyDoc{
		RuleID: "sched_test",
		MACs:   []string{mac},
		BaselineByDay: map[string]map[string]int{
			day: {mac: 20},
		},
	}
	ts, _ := time.Parse(time.RFC3339, day+"T10:00:00Z")
	// Live counter sees 5 of the same minutes the baseline already covers.
	for i := 0; i < 5; i++ {
		globalQuotaCounter.record("sched_test", mac, ts.Add(time.Duration(i)*time.Minute))
	}
	if got := usedMinutes(doc, []string{day}); got != 20 {
		t.Errorf("usedMinutes = %d, want 20 (max of live 5, baseline 20)", got)
	}
	// Live overtakes baseline → live wins.
	for i := 5; i < 30; i++ {
		globalQuotaCounter.record("sched_test", mac, ts.Add(time.Duration(i)*time.Minute))
	}
	if got := usedMinutes(doc, []string{day}); got != 30 {
		t.Errorf("usedMinutes = %d, want 30 (live 30 > baseline 20)", got)
	}
	// A day the baseline doesn't cover contributes live only.
	if got := usedMinutes(doc, []string{"2026-08-12"}); got != 0 {
		t.Errorf("usedMinutes other day = %d, want 0", got)
	}
}
