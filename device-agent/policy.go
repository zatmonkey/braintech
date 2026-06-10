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
	"time"
)

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
	// First tick happens immediately so a freshly-applied rule lands the
	// correct enforcement state without a one-minute wait.
	for {
		if ctx.Err() != nil {
			return
		}
		evaluateAllPolicies(ctx, time.Now())
		select {
		case <-ctx.Done():
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
		decision := evaluate(doc, now)
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
// (block_unless). Add new kinds here.
func evaluate(doc *policyDoc, now time.Time) decision {
	if doc.Kind != "block_unless" {
		// Unknown kind — fail closed (enforce). Better to over-block than
		// silently allow when the schema drifts.
		return decisionEnforce
	}
	// Empty allow set → block always (equivalent to block_brainrot_group).
	if len(doc.AllowWindows) == 0 && len(doc.AllowQuotas) == 0 {
		return decisionEnforce
	}
	// ANY allow clause matches → allow.
	for _, w := range doc.AllowWindows {
		if windowMatches(w, now) {
			return decisionAllow
		}
	}
	for _, q := range doc.AllowQuotas {
		if quotaAllows(doc, q, now) {
			return decisionAllow
		}
	}
	return decisionEnforce
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

// quotaAllows: STUB. The framework is here, but the actual minute counter
// isn't wired yet. To finish: maintain a per-(rule_id, period_start)
// counter that brainrotDNSWatcher increments any time it would have
// blocked a query, then read it here and compare against q.MinutesMax.
// Returns false today so quota clauses don't accidentally allow
// everything before the counter exists.
func quotaAllows(_ *policyDoc, _ quotaWindow, _ time.Time) bool {
	// TODO(scaffold): real counter lookup goes here. See top-file comment.
	return false
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
	if out, err := flush.CombinedOutput(); err != nil {
		// "no such set" while the chain is being torn down → quietly skip
		if strings.Contains(string(out), "No such file") ||
			strings.Contains(string(out), "Could not process rule") {
			return nil
		}
		return fmt.Errorf("flush %s: %v: %s", doc.NftMacSet, err, strings.TrimSpace(string(out)))
	}
	if d == decisionAllow || len(doc.MACs) == 0 {
		return nil
	}
	macList := strings.Join(doc.MACs, ", ")
	add := exec.CommandContext(sub, "nft",
		"add", "element", "inet", "fw4", doc.NftMacSet,
		"{ "+macList+" }",
	)
	if out, err := add.CombinedOutput(); err != nil {
		return fmt.Errorf("add %s: %v: %s", doc.NftMacSet, err, strings.TrimSpace(string(out)))
	}
	return nil
}
