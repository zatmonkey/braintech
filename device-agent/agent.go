package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// Agent owns the reconcile loop and the HTTP transport to the control plane.
type Agent struct {
	cfg   Config
	http  *http.Client
	state State
	usage *usageStore
}

func NewAgent(cfg Config) *Agent {
	return &Agent{
		cfg: cfg,
		// Timeout must exceed the server's long-poll hold (~25s).
		http:  &http.Client{Timeout: 45 * time.Second},
		state: LoadStateFile(cfg.StatePath),
		usage: newUsageStore(),
	}
}

// Run reconciles forever: long-poll → verify → apply → report, with capped
// exponential backoff on transport errors. It returns when ctx is cancelled.
func (a *Agent) Run(ctx context.Context) {
	go a.telemetryLoop(ctx) // report network/system state every minute
	go tailDNSLog(ctx, a.usage, "/tmp/dnsmasq.log")
	go rotateDNSLog(ctx, "/tmp/dnsmasq.log", 4<<20) // 4 MiB cap
	go brainrotRefreshLoop(ctx)                     // resolve brainrot domains → nft IP sets
	go brainrotDNSWatcher(ctx, "/tmp/dnsmasq.log")  // catch CNAME chains + dynamic CDN subdomains in real time
	go ensureCaptiveInfra(ctx)                      // alias IP + dnsmasq "brain" hostname (one-time idempotent)
	go captiveServer(ctx)                           // http://brain redirector + HTTP captive page
	go policyEvaluatorLoop(ctx)                     // time/quota policy engine — toggles nft MAC sets per /etc/braintech/policy/*.json
	go orphanCleanupLoop(ctx, a.cfg.DesiredPath)    // self-heal: delete managed files the current desired doesn't reference
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		if err := a.tick(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("sync error: %v (retry in %s)", err, backoff)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, 60*time.Second)
			continue
		}
		backoff = time.Second
	}
}

func (a *Agent) tick(ctx context.Context) error {
	inst, raw, sig, status, err := a.sync(ctx)
	if err != nil {
		return err
	}
	switch status {
	case http.StatusNotModified:
		return nil // no change; long-poll returned, loop again immediately
	case http.StatusOK:
		// proceed
	default:
		return fmt.Errorf("sync HTTP %d", status)
	}

	if !VerifySignature(raw, sig, a.cfg.PSK) {
		log.Printf("REJECTED instruction v%d: signature verification failed", inst.Version)
		return a.report(ctx, Report{Version: inst.Version, Status: "rejected", Error: "bad signature"})
	}
	if inst.DeviceID != "" && inst.DeviceID != a.cfg.DeviceID {
		log.Printf("REJECTED instruction v%d: device_id mismatch", inst.Version)
		return a.report(ctx, Report{Version: inst.Version, Status: "rejected", Error: "device_id mismatch"})
	}
	if inst.Version <= a.state.Version {
		return nil // already applied; ignore replays
	}

	log.Printf("applying instruction v%d (%d ops)", inst.Version, len(inst.Ops))
	rep := Apply(inst, a.cfg)
	if rep.Status == "applied" {
		a.state.Version = inst.Version
		a.state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if err := SaveState(a.cfg, a.state, raw); err != nil {
			log.Printf("warning: could not persist state: %v", err)
		}
		log.Printf("applied v%d ok", inst.Version)
	} else {
		log.Printf("apply v%d %s: %s", inst.Version, rep.Status, rep.Error)
	}
	return a.report(ctx, rep)
}

func (a *Agent) sync(ctx context.Context) (*Instruction, []byte, string, int, error) {
	url := fmt.Sprintf("%s/api/device/sync?since=%d", a.cfg.ServerURL, a.state.Version)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, nil, "", 0, err
	}
	a.auth(req)
	resp, err := a.http.Do(req)
	if err != nil {
		return nil, nil, "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotModified {
		return nil, nil, "", http.StatusNotModified, nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20)) // 2 MiB cap
	if err != nil {
		return nil, nil, "", resp.StatusCode, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, body, "", resp.StatusCode, nil
	}
	var inst Instruction
	if err := json.Unmarshal(body, &inst); err != nil {
		return nil, body, "", resp.StatusCode, fmt.Errorf("decode instruction: %w", err)
	}
	return &inst, body, resp.Header.Get("X-Braintech-Signature"), http.StatusOK, nil
}

func (a *Agent) report(ctx context.Context, rep Report) error {
	rep.DeviceID = a.cfg.DeviceID
	rep.AgentVersion = agentVersion
	if rep.AppliedAt == "" {
		rep.AppliedAt = time.Now().UTC().Format(time.RFC3339)
	}
	payload, _ := json.Marshal(rep)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.ServerURL+"/api/device/report", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	a.auth(req)
	resp, err := a.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("report HTTP %d", resp.StatusCode)
	}
	return nil
}

func (a *Agent) telemetryLoop(ctx context.Context) {
	for {
		a.reportTelemetry(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(60 * time.Second):
		}
	}
}

func (a *Agent) reportTelemetry(ctx context.Context) {
	t := collectTelemetry(a.cfg.DeviceID)
	t.Usage = a.usage.drain()
	t.PolicyStatus = PolicyDecisions()
	payload, err := json.Marshal(t)
	if err != nil {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.ServerURL+"/api/device/telemetry", bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	a.auth(req)
	resp, err := a.http.Do(req)
	if err != nil {
		return
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	resp.Body.Close()
}

func (a *Agent) auth(req *http.Request) {
	req.Header.Set("X-Device-Id", a.cfg.DeviceID)
	req.Header.Set("Authorization", "Bearer "+a.cfg.PSK)
	req.Header.Set("User-Agent", "braintech-agent/"+agentVersion)
}
