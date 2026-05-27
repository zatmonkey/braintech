package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Op is one generic operation. The grammar is deliberately small and stable:
// almost all OpenWrt configuration is expressible as UCI operations, so the
// server can compose new firewall/network/DNS behavior without a daemon update.
//
// Supported Type values:
//
//	uci.set      config, section, (option+value | values map)
//	uci.add      config, section_type, [values]        -> creates a section
//	uci.add_list config, section, option, list[]
//	uci.delete   config, section, [option]
//	uci.commit   config (empty = commit all)
//	service      name, action (start|stop|restart|reload|enable|disable)
//	file.write   path, content, [mode]                 (path must be allow-listed)
//	package.install / package.remove   name
//	exec         command[]                             (off unless BT_ALLOW_EXEC=1)
type Op struct {
	Type string `json:"type"`

	// uci.*
	Config      string            `json:"config,omitempty"`
	Section     string            `json:"section,omitempty"`
	SectionType string            `json:"section_type,omitempty"`
	Option      string            `json:"option,omitempty"`
	Value       string            `json:"value,omitempty"`
	Values      map[string]string `json:"values,omitempty"`
	List        []string          `json:"list,omitempty"`

	// service
	Name   string `json:"name,omitempty"`
	Action string `json:"action,omitempty"`

	// file.write
	Path    string `json:"path,omitempty"`
	Content string `json:"content,omitempty"`
	Mode    string `json:"mode,omitempty"`

	// exec
	Command []string `json:"command,omitempty"`
}

// Instruction is the signed desired-state document returned by /api/device/sync.
type Instruction struct {
	Version  int64  `json:"version"`
	DeviceID string `json:"device_id"`
	IssuedAt string `json:"issued_at"`
	Ops      []Op   `json:"ops"`
}

// VerifySignature checks an HMAC-SHA256 over the exact response body using the
// device PSK. The server signs the raw bytes it sends, so there is no JSON
// canonicalization to get wrong. Header form: "sha256=<hex>".
func VerifySignature(body []byte, sigHeader, psk string) bool {
	sigHeader = strings.TrimSpace(strings.TrimPrefix(sigHeader, "sha256="))
	want, err := hex.DecodeString(sigHeader)
	if err != nil || len(want) == 0 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(psk))
	mac.Write(body)
	return hmac.Equal(mac.Sum(nil), want)
}
