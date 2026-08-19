// Command braintech-agent is a generic, long-lived reconciliation daemon for
// OpenWrt devices. It long-polls the Braintech control plane for a signed
// "instruction" document (a small, stable grammar of UCI / service / file /
// package operations), verifies it with the device's pre-shared key, applies
// it, and reports the result. The grammar is intentionally generic — the
// server gets smarter without ever re-flashing this binary.
package main

import (
	"context"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	// The router has no zoneinfo database (/etc/localtime is a dangling
	// symlink), so without this Go silently falls back to UTC and every
	// schedule window shifts by the UTC offset. ~450 KB well spent.
	_ "time/tzdata"
)

const agentVersion = "0.6.0"

// initTimezone points time.Local at the household timezone. Priority: an
// explicit TZ env var (Go honors it via the embedded tzdata), then the
// UCI zonename the server pushes (system.@system[0].zonename, an IANA
// name like "America/Los_Angeles"). Busybox tools read /etc/TZ and show
// local time either way — this fixes the Go side, where the policy
// engine's windows are evaluated. A timezone change pushed later needs a
// service restart to take effect.
func initTimezone() {
	if os.Getenv("TZ") != "" {
		return
	}
	out, err := exec.Command("uci", "-q", "get", "system.@system[0].zonename").Output()
	if err != nil {
		return
	}
	name := strings.TrimSpace(string(out))
	if name == "" {
		return
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		log.Printf("timezone: %q: %v (staying on UTC)", name, err)
		return
	}
	time.Local = loc
	log.Printf("timezone: %s", name)
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	initTimezone()

	cfg, err := LoadConfig()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	log.Printf("braintech-agent %s | device=%s server=%s", agentVersion, cfg.DeviceID, cfg.ServerURL)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	NewAgent(cfg).Run(ctx)
	log.Print("braintech-agent stopped")
}
