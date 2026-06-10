package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Client is one device seen on the LAN (from DHCP leases), with a live flag
// derived from the neighbour table.
type Client struct {
	Mac       string `json:"mac"`
	IP        string `json:"ip"`
	Hostname  string `json:"hostname"`
	Connected bool   `json:"connected"`
}

// Telemetry is the periodic network/system snapshot the agent reports.
type Telemetry struct {
	DeviceID     string        `json:"device_id"`
	CollectedAt  string        `json:"collected_at"`
	AgentVersion string        `json:"agent_version"`
	Model        string        `json:"model"`
	Firmware     string        `json:"firmware"`
	UptimeSec    int64         `json:"uptime_sec"`
	Load         string        `json:"load"`
	WanUp        bool          `json:"wan_up"`
	ClientCount  int           `json:"client_count"`
	Clients      []Client      `json:"clients"`
	Usage        []usageBucket       `json:"usage,omitempty"`
	PolicyStatus []PolicyDecision    `json:"policy_status,omitempty"`
	CreditSpend  []CreditSpendReport `json:"credit_spend,omitempty"`
}

func readFile(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func collectTelemetry(deviceID string) Telemetry {
	t := Telemetry{
		DeviceID:     deviceID,
		CollectedAt:  time.Now().UTC().Format(time.RFC3339),
		AgentVersion: agentVersion,
		Model:        readFile("/tmp/sysinfo/model"),
		Firmware:     openwrtDescription(),
		UptimeSec:    uptimeSec(),
		Load:         loadAvg(),
		WanUp:        wanUp(),
		Clients:      clients(),
	}
	t.ClientCount = len(t.Clients)
	return t
}

func openwrtDescription() string {
	for _, line := range strings.Split(readFile("/etc/openwrt_release"), "\n") {
		if strings.HasPrefix(line, "DISTRIB_DESCRIPTION=") {
			return strings.Trim(strings.TrimPrefix(line, "DISTRIB_DESCRIPTION="), "'\"")
		}
	}
	return ""
}

func uptimeSec() int64 {
	f := strings.Fields(readFile("/proc/uptime"))
	if len(f) == 0 {
		return 0
	}
	v, _ := strconv.ParseFloat(f[0], 64)
	return int64(v)
}

func loadAvg() string {
	f := strings.Fields(readFile("/proc/loadavg"))
	if len(f) >= 3 {
		return strings.Join(f[:3], " ")
	}
	return ""
}

func wanUp() bool {
	out, err := run("ubus", "call", "network.interface.wan", "status")
	if err != nil {
		// fall back: a default route implies upstream connectivity
		r, _ := run("ip", "route", "show", "default")
		return strings.Contains(r, "default")
	}
	return strings.Contains(out, "\"up\": true")
}

// clients merges DHCP leases (named devices) with the neighbour table (liveness).
func clients() []Client {
	active := map[string]bool{} // mac -> currently reachable
	if out, err := run("ip", "neigh", "show"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			var mac, state string
			for i, f := range fields {
				if f == "lladdr" && i+1 < len(fields) {
					mac = strings.ToLower(fields[i+1])
				}
			}
			if len(fields) > 0 {
				state = fields[len(fields)-1]
			}
			if mac != "" && (state == "REACHABLE" || state == "STALE" || state == "DELAY" || state == "PROBE") {
				active[mac] = true
			}
		}
	}

	var list []Client
	seen := map[string]bool{}
	for _, line := range strings.Split(readFile("/tmp/dhcp.leases"), "\n") {
		f := strings.Fields(line) // expiry mac ip hostname clientid
		if len(f) < 4 {
			continue
		}
		mac := strings.ToLower(f[1])
		host := f[3]
		if host == "*" {
			host = ""
		}
		seen[mac] = true
		list = append(list, Client{Mac: mac, IP: f[2], Hostname: host, Connected: active[mac]})
	}
	// include currently-active devices that aren't in the lease file
	if out, err := run("ip", "neigh", "show"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) < 5 || !active[macOf(fields)] || macOf(fields) == "" || seen[macOf(fields)] {
				continue
			}
			list = append(list, Client{Mac: macOf(fields), IP: fields[0], Connected: true})
			seen[macOf(fields)] = true
		}
	}
	return list
}

func macOf(fields []string) string {
	for i, f := range fields {
		if f == "lladdr" && i+1 < len(fields) {
			return strings.ToLower(fields[i+1])
		}
	}
	return ""
}
