package main

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// OpResult is the per-operation outcome reported back to the server.
type OpResult struct {
	Index  int    `json:"index"`
	Type   string `json:"type"`
	OK     bool   `json:"ok"`
	Output string `json:"output,omitempty"`
	Error  string `json:"error,omitempty"`
}

// Report is posted to /api/device/report after every apply attempt.
type Report struct {
	DeviceID     string     `json:"device_id"`
	Version      int64      `json:"version"`
	Status       string     `json:"status"` // applied | failed | rejected
	Ops          []OpResult `json:"ops,omitempty"`
	Error        string     `json:"error,omitempty"`
	AppliedAt    string     `json:"applied_at"`
	AgentVersion string     `json:"agent_version"`
}

// Apply runs every op in order. UCI configs touched are snapshotted first; on
// the first failing op the whole batch is rolled back (uci revert + file
// restore) so a bad instruction can never leave the network half-configured.
func Apply(inst *Instruction, cfg Config) Report {
	rep := Report{Version: inst.Version, Status: "applied", AppliedAt: time.Now().UTC().Format(time.RFC3339)}

	touched := touchedConfigs(inst.Ops)
	snaps := snapshotConfigs(touched)

	for i, op := range inst.Ops {
		out, err := execOp(op, cfg)
		res := OpResult{Index: i, Type: op.Type, OK: err == nil, Output: truncate(out, 400)}
		if err != nil {
			res.Error = err.Error()
			rep.Ops = append(rep.Ops, res)
			rep.Status = "failed"
			rep.Error = fmt.Sprintf("op %d (%s): %v", i, op.Type, err)
			log.Printf("op %d (%s) failed: %v — rolling back", i, op.Type, err)
			rollback(touched, snaps)
			return rep
		}
		rep.Ops = append(rep.Ops, res)
	}
	return rep
}

func execOp(op Op, cfg Config) (string, error) {
	switch op.Type {
	case "uci.set":
		// Section declaration: `uci set config.section=section_type`
		if op.Option == "" && op.Section != "" && op.Value != "" && len(op.Values) == 0 {
			return run("uci", "set", fmt.Sprintf("%s.%s=%s", op.Config, op.Section, op.Value))
		}
		if len(op.Values) > 0 {
			var out []string
			for k, v := range op.Values {
				o, err := run("uci", "set", fmt.Sprintf("%s.%s.%s=%s", op.Config, op.Section, k, v))
				if err != nil {
					return strings.Join(out, "\n"), err
				}
				out = append(out, o)
			}
			return strings.Join(out, "\n"), nil
		}
		return run("uci", "set", fmt.Sprintf("%s.%s.%s=%s", op.Config, op.Section, op.Option, op.Value))

	case "uci.add":
		sec, err := run("uci", "add", op.Config, op.SectionType)
		if err != nil {
			return sec, err
		}
		for k, v := range op.Values {
			if _, err := run("uci", "set", fmt.Sprintf("%s.%s.%s=%s", op.Config, sec, k, v)); err != nil {
				return sec, err
			}
		}
		return sec, nil // returns the new (anonymous) section name

	case "uci.add_list":
		for _, v := range op.List {
			if _, err := run("uci", "add_list", fmt.Sprintf("%s.%s.%s=%s", op.Config, op.Section, op.Option, v)); err != nil {
				return "", err
			}
		}
		return "", nil

	case "uci.delete":
		key := op.Config + "." + op.Section
		if op.Option != "" {
			key += "." + op.Option
		}
		out, err := run("uci", "delete", key)
		if err != nil && strings.Contains(out, "Entry not found") {
			// idempotent: deleting something that's already gone is fine
			return out, nil
		}
		return out, err

	case "uci.commit":
		if op.Config != "" {
			return run("uci", "commit", op.Config)
		}
		return run("uci", "commit")

	case "service":
		if err := validName(op.Name); err != nil {
			return "", err
		}
		action := op.Action
		if action == "" {
			action = "reload"
		}
		return run("/etc/init.d/"+op.Name, action)

	case "file.write":
		return fileWrite(op, cfg)

	case "file.delete":
		return fileDelete(op, cfg)

	case "package.install":
		if err := validName(op.Name); err != nil {
			return "", err
		}
		return run("opkg", "install", op.Name)

	case "package.remove":
		if err := validName(op.Name); err != nil {
			return "", err
		}
		return run("opkg", "remove", op.Name)

	case "exec":
		if !cfg.AllowExec {
			return "", fmt.Errorf("exec op rejected: BT_ALLOW_EXEC is not enabled")
		}
		if len(op.Command) == 0 {
			return "", fmt.Errorf("exec op: empty command")
		}
		return run(op.Command[0], op.Command[1:]...)

	default:
		return "", fmt.Errorf("unknown op type %q", op.Type)
	}
}

func pathAllowed(path string, cfg Config) bool {
	for _, p := range cfg.AllowedFilePrefixes {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

func fileWrite(op Op, cfg Config) (string, error) {
	if !pathAllowed(op.Path, cfg) {
		return "", fmt.Errorf("file.write path %q not in allow-list %v", op.Path, cfg.AllowedFilePrefixes)
	}
	mode := os.FileMode(0o644)
	if op.Mode != "" {
		if m, err := strconv.ParseUint(op.Mode, 8, 32); err == nil {
			mode = os.FileMode(m)
		}
	}
	// Ensure parent dir exists — drop-in conf dirs like /etc/dnsmasq.d/ aren't
	// guaranteed to be present on every OpenWrt build.
	if dir := filepath.Dir(op.Path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}
	// Atomic write: tmp file in the same dir + rename, so dnsmasq never reads
	// a half-written conf.
	tmp := op.Path + ".bt.tmp"
	if err := os.WriteFile(tmp, []byte(op.Content), mode); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, op.Path); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return fmt.Sprintf("wrote %s (%d bytes)", op.Path, len(op.Content)), nil
}

// fileDelete removes a file if present. Missing files are not an error —
// keeps the cleanup-then-rebuild pattern idempotent.
func fileDelete(op Op, cfg Config) (string, error) {
	if !pathAllowed(op.Path, cfg) {
		return "", fmt.Errorf("file.delete path %q not in allow-list %v", op.Path, cfg.AllowedFilePrefixes)
	}
	err := os.Remove(op.Path)
	if err != nil && os.IsNotExist(err) {
		return "absent", nil
	}
	if err != nil {
		return "", err
	}
	return "deleted " + op.Path, nil
}

// --- rollback helpers ---

func touchedConfigs(ops []Op) []string {
	seen := map[string]bool{}
	var out []string
	for _, op := range ops {
		if strings.HasPrefix(op.Type, "uci.") && op.Config != "" && !seen[op.Config] {
			seen[op.Config] = true
			out = append(out, op.Config)
		}
	}
	return out
}

func snapshotConfigs(configs []string) map[string][]byte {
	snaps := map[string][]byte{}
	for _, c := range configs {
		if b, err := os.ReadFile("/etc/config/" + c); err == nil {
			snaps[c] = b
		}
	}
	return snaps
}

func rollback(configs []string, snaps map[string][]byte) {
	for _, c := range configs {
		run("uci", "revert", c) // discard any staged (uncommitted) changes
		if b, ok := snaps[c]; ok {
			os.WriteFile("/etc/config/"+c, b, 0o644) // undo committed changes
		}
	}
	for _, c := range configs {
		if c == "firewall" {
			run("/etc/init.d/firewall", "reload")
			break
		}
	}
}

// --- low-level ---

func run(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	return strings.TrimSpace(buf.String()), err
}

// validName guards opkg/service names against argument/shell injection. exec.Command
// already avoids a shell, but we keep names to a safe character set anyway.
func validName(s string) error {
	if s == "" {
		return fmt.Errorf("empty name")
	}
	for _, r := range s {
		if !(r == '-' || r == '_' || r == '.' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return fmt.Errorf("invalid name %q", s)
		}
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
