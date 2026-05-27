package main

import (
	"errors"
	"os"
	"strings"
)

// Config is sourced from environment variables (set by the procd init script
// from /etc/braintech/agent.conf). Nothing here is a build-time constant, so
// the same binary works for every device.
type Config struct {
	ServerURL   string // e.g. https://getbraintech.com
	DeviceID    string // e.g. dev_ab12cd34
	PSK         string // pre-shared key: bearer auth + HMAC verification of instructions
	StatePath   string // local applied-version cache
	DesiredPath string // local cache of the last applied instruction (the device's "memory file")
	AllowExec   bool   // opt-in: allow the raw "exec" op (off by default — dangerous)

	// File writes are restricted to these path prefixes (defense in depth).
	AllowedFilePrefixes []string
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func LoadConfig() (Config, error) {
	c := Config{
		ServerURL:           strings.TrimRight(env("BT_SERVER_URL", "https://getbraintech.com"), "/"),
		DeviceID:            env("BT_DEVICE_ID", ""),
		PSK:                 env("BT_PSK", ""),
		StatePath:           env("BT_STATE_PATH", "/etc/braintech/state.json"),
		DesiredPath:         env("BT_DESIRED_PATH", "/etc/braintech/desired.json"),
		AllowExec:           env("BT_ALLOW_EXEC", "0") == "1",
		AllowedFilePrefixes: []string{"/etc/", "/tmp/", "/var/"},
	}
	if c.DeviceID == "" || c.PSK == "" {
		return c, errors.New("BT_DEVICE_ID and BT_PSK are required")
	}
	return c, nil
}
