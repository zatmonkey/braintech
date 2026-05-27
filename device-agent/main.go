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
	"os/signal"
	"syscall"
)

const agentVersion = "0.1.0"

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)

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
