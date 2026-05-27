package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// State is the tiny persisted cursor: which instruction version we've applied.
type State struct {
	Version   int64  `json:"version"`
	UpdatedAt string `json:"updated_at"`
}

func LoadStateFile(path string) State {
	var s State
	b, err := os.ReadFile(path)
	if err != nil {
		return State{Version: 0}
	}
	if json.Unmarshal(b, &s) != nil {
		return State{Version: 0}
	}
	return s
}

// SaveState persists the version cursor and caches the raw applied instruction
// (the device's local "memory file") so it can be inspected and re-applied on
// boot without the network.
func SaveState(cfg Config, s State, rawInstruction []byte) error {
	if err := os.MkdirAll(filepath.Dir(cfg.StatePath), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	if err := os.WriteFile(cfg.StatePath, b, 0o600); err != nil {
		return err
	}
	if cfg.DesiredPath != "" && len(rawInstruction) > 0 {
		_ = os.WriteFile(cfg.DesiredPath, rawInstruction, 0o600)
	}
	return nil
}
