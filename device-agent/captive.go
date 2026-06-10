package main

import (
	"bufio"
	"context"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"
)

// captiveIP is the alias address we bring up on br-lan for the captive
// HTTP server. Distinct from the router's main LAN IP so we don't fight
// LuCI for port 80.
const (
	captiveIP   = "192.168.1.254"
	captivePort = "80"
)

// brainHosts are the local short hostnames the kid (or parent) can type
// in any browser on the home Wi-Fi to land on the per-device "what's set
// up here" page. dnsmasq resolves all three to captiveIP.
var brainHosts = map[string]bool{
	"brain":       true,
	"brain.lan":   true,
	"brain.local": true,
}

// captiveServer is the on-router HTTP redirector. Two jobs:
//
//  1. When the kid types `http://brain` on the LAN, dnsmasq resolves it
//     to captiveIP, the browser hits us, and we 302 to
//     https://getbraintech.com/mine?mac=<the kid's MAC>. We learn the MAC
//     from the connecting client's source IP via the lease table.
//
//  2. When the kid's port-80 traffic is DNAT'd here (because they tried
//     to reach a blocked non-HSTS site), we 302 to /blocked?host=<the
//     site they were trying to reach>. The original host stays in the
//     HTTP Host header even after DNAT.
//
// We don't try HTTPS — for case (1) the kid will be told to type
// `http://`, and for case (2) HSTS prevents redirect entirely (see the
// /blocked page copy for the honest disclaimer).
func captiveServer(ctx context.Context) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", captiveHandler)
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	for {
		if ctx.Err() != nil {
			return
		}
		// We can only Listen once captiveIP is up on br-lan. The infra
		// goroutine adds it asynchronously; retry until it lands.
		l, err := net.Listen("tcp", captiveIP+":"+captivePort)
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}
		log.Printf("captive: listening on %s:%s", captiveIP, captivePort)
		go func() {
			<-ctx.Done()
			_ = srv.Close()
		}()
		if err := srv.Serve(l); err != nil && err != http.ErrServerClosed {
			log.Printf("captive: serve: %v", err)
		}
		// fall through to retry the Listen if we lost the socket
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func captiveHandler(w http.ResponseWriter, r *http.Request) {
	host := strings.ToLower(strings.SplitN(r.Host, ":", 2)[0])
	clientIP := remoteIPOnly(r.RemoteAddr)

	// Add no-cache headers — we don't want browsers to remember our 302
	// for the next time the kid navigates back to the original URL.
	w.Header().Set("Cache-Control", "no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")

	if brainHosts[host] {
		mac := lookupMacFromIP(clientIP)
		dest := "https://getbraintech.com/mine"
		if mac != "" {
			dest += "?mac=" + url.QueryEscape(mac)
		}
		http.Redirect(w, r, dest, http.StatusFound)
		return
	}

	// Captive case: kid was trying to reach `host` (port 80) and we DNAT'd
	// here. Preserve the original host in the URL so the /blocked page
	// can show "youtube.com was blocked".
	dest := "https://getbraintech.com/blocked"
	if host != "" {
		dest += "?host=" + url.QueryEscape(host)
	}
	http.Redirect(w, r, dest, http.StatusFound)
}

func remoteIPOnly(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

// lookupMacFromIP maps a client IP to its MAC via the two sources we
// already trust: /tmp/dhcp.leases (IPv4) and `ip neigh show` (covers
// IPv6 and any IPv4 missing from the lease file).
func lookupMacFromIP(ip string) string {
	if mac := macFromLeases(ip); mac != "" {
		return mac
	}
	out, err := exec.Command("ip", "neigh", "show", ip).Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		for i, f := range fields {
			if f == "lladdr" && i+1 < len(fields) {
				return strings.ToLower(fields[i+1])
			}
		}
	}
	return ""
}

func macFromLeases(ip string) string {
	f, err := os.Open("/tmp/dhcp.leases")
	if err != nil {
		return ""
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		fields := strings.Fields(s.Text())
		// format: expiry mac ip hostname clientid
		if len(fields) >= 3 && fields[2] == ip {
			return strings.ToLower(fields[1])
		}
	}
	return ""
}

// ensureCaptiveInfra is the one-time, idempotent setup we run at agent
// boot:
//
//  1. Add captiveIP as an alias on br-lan via UCI (so we can bind a
//     listener to it without fighting LuCI for the router's main IP).
//  2. Drop a dnsmasq snippet at /etc/dnsmasq.d/bt-captive.conf that maps
//     `brain` / `brain.lan` / `brain.local` to captiveIP.
//
// Both are safe to re-run forever — they check for the desired state
// first and only commit + reload when something would change.
func ensureCaptiveInfra(ctx context.Context) {
	if err := ensureCaptiveAlias(ctx); err != nil {
		log.Printf("captive infra: alias setup: %v", err)
	}
	if err := ensureCaptiveDNS(ctx); err != nil {
		log.Printf("captive infra: dnsmasq setup: %v", err)
	}
}

func ensureCaptiveAlias(ctx context.Context) error {
	// Already there?
	out, _ := run("uci", "-q", "get", "network.bt_captive")
	if strings.TrimSpace(out) == "alias" {
		// Spot-check the IP — uci might have an old value.
		ipOut, _ := run("uci", "-q", "get", "network.bt_captive.ipaddr")
		if strings.TrimSpace(ipOut) == captiveIP {
			return nil
		}
	}
	for _, args := range [][]string{
		{"set", "network.bt_captive=alias"},
		{"set", "network.bt_captive.interface=lan"},
		{"set", "network.bt_captive.proto=static"},
		{"set", "network.bt_captive.ipaddr=" + captiveIP},
		{"set", "network.bt_captive.netmask=255.255.255.0"},
		{"commit", "network"},
	} {
		if _, err := run("uci", args...); err != nil {
			return err
		}
	}
	// Reload the LAN interface rather than restart the network service —
	// safer + less disruptive.
	if _, err := run("ifup", "lan"); err != nil {
		// Fall back to network reload if ifup isn't available.
		exec.CommandContext(ctx, "/etc/init.d/network", "reload").Run()
	}
	log.Printf("captive: alias %s up on br-lan", captiveIP)
	return nil
}

func ensureCaptiveDNS(_ context.Context) error {
	path := "/etc/dnsmasq.d/bt-captive.conf"
	desired := "# Braintech captive — short LAN hostnames for the brain page\n" +
		"address=/brain/" + captiveIP + "\n" +
		"address=/brain.lan/" + captiveIP + "\n" +
		"address=/brain.local/" + captiveIP + "\n"
	current, err := os.ReadFile(path)
	if err == nil && string(current) == desired {
		return nil
	}
	if err := os.MkdirAll("/etc/dnsmasq.d", 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(desired), 0o644); err != nil {
		return err
	}
	if _, err := run("/etc/init.d/dnsmasq", "reload"); err != nil {
		return err
	}
	log.Printf("captive: dnsmasq brain entries written")
	return nil
}
