package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// orphanCleanupLoop is the agent's belt-and-suspenders self-healer.
//
// Why it exists: the server's apply path emits cleanup ops (file.delete +
// service reload) for rules being deactivated. Most of the time that
// works. But there are real failure modes where a rule disappears from
// the server's "what should be on the device" view WITHOUT the cleanup
// ops landing on the device:
//
//   - direct DB pokes that bypass the apply flow (UPDATE devices SET
//     desired = '[]' is the one I keep doing during dev/test);
//   - past bugs in the cleanup-op generator (we shipped a few — orphan
//     dnsmasq.address entries and orphan brainrot conf files both
//     surfaced as "rule deleted but YouTube still blocked");
//   - partial-apply states where the file.write succeeded for a now-
//     stale rule but the cleanup op for the prior rule didn't.
//
// What it does: every 5 minutes, parses the current desired.json (the
// last applied instruction document) to extract every file path the
// server wants present, globs the managed directories on disk, deletes
// anything not in the expected set, and reloads the affected service.
//
// What it DOESN'T do: touch anything outside the managed prefixes. The
// allow-list is short and explicit, and every file we'd delete is a
// `bt-*` / Braintech-namespaced file we own. No user files at risk.
func orphanCleanupLoop(ctx context.Context, desiredPath string) {
	// First reconcile after 90s so a freshly-booted agent has time to do
	// its first sync before we start judging what's "expected".
	select {
	case <-ctx.Done():
		return
	case <-time.After(90 * time.Second):
	}
	for {
		if ctx.Err() != nil {
			return
		}
		reconcileManagedFiles(ctx, desiredPath)
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Minute):
		}
	}
}

// managedPrefixes lists the directories the cleanup loop is allowed to
// scan + delete from. Every entry is a Braintech-owned namespace; any
// file matching the glob either came from a file.write op or is a
// runaway we want gone.
//
// affectedService is the service to reload after deleting from this
// directory. Empty = no service reload needed.
var managedPrefixes = []struct {
	glob            string
	affectedService string
}{
	{"/etc/nftables.d/bt-*.nft", "firewall"},
	{"/etc/braintech/brainrot/*.json", ""},
	{"/etc/braintech/policy/*.json", ""},
	{"/usr/share/nftables.d/chain-pre/forward/30-bt-*.nft", "firewall"},
}

func reconcileManagedFiles(ctx context.Context, desiredPath string) {
	expected, ok := readExpectedFiles(desiredPath)
	if !ok {
		// Couldn't read the desired state — refuse to delete. Better to
		// leave a real orphan around than to vape live config because
		// the file got truncated mid-write.
		return
	}

	reloadFirewall := false
	reloadDnsmasq := false
	for _, mp := range managedPrefixes {
		matches, err := filepath.Glob(mp.glob)
		if err != nil {
			continue
		}
		for _, f := range matches {
			if expected[f] {
				continue
			}
			log.Printf("orphan cleanup: removing %s (not in current desired)", f)
			if err := os.Remove(f); err != nil {
				log.Printf("orphan cleanup: rm %s: %v", f, err)
				continue
			}
			switch mp.affectedService {
			case "firewall":
				reloadFirewall = true
			case "dnsmasq":
				reloadDnsmasq = true
			}
			// Schedule rules also leave an orphan nft CHAIN in the kernel
			// (the include file was loaded into the running ruleset).
			// fw4 reload below regenerates the whole ruleset from
			// /etc/nftables.d/, so a stale chain whose include file we
			// just deleted is gone after the reload — no extra step.
		}
	}

	if reloadFirewall {
		sub, cancel := context.WithTimeout(ctx, 15*time.Second)
		if out, err := exec.CommandContext(sub, "fw4", "reload").CombinedOutput(); err != nil {
			log.Printf("orphan cleanup: fw4 reload: %v: %s", err, strings.TrimSpace(string(out)))
		}
		cancel()
	}
	if reloadDnsmasq {
		sub, cancel := context.WithTimeout(ctx, 10*time.Second)
		exec.CommandContext(sub, "/etc/init.d/dnsmasq", "reload").Run()
		cancel()
	}
}

// readExpectedFiles parses desired.json and returns the set of every
// `file.write` op's target path. Returns ok=false if the file isn't
// parseable — caller uses that as a "don't touch anything" signal so
// we never delete on bad input.
func readExpectedFiles(desiredPath string) (map[string]bool, bool) {
	if desiredPath == "" {
		return nil, false
	}
	b, err := os.ReadFile(desiredPath)
	if err != nil {
		return nil, false
	}
	var inst Instruction
	if err := json.Unmarshal(b, &inst); err != nil {
		return nil, false
	}
	expected := make(map[string]bool, len(inst.Ops))
	for _, op := range inst.Ops {
		if op.Type == "file.write" && op.Path != "" {
			expected[op.Path] = true
		}
	}
	return expected, true
}
