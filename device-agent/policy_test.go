package main

import (
	"testing"
	"time"
)

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
