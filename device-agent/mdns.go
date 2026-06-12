package main

// Minimal mDNS responder so iOS Safari can resolve brain.local without
// us having to install umdns or avahi via opkg (which is broken on
// current OpenWrt snapshot builds). Apple's resolver hardcodes .local
// as mDNS-only — it never asks our dnsmasq — so we have to answer on
// multicast 224.0.0.251:5353 ourselves.
//
// We advertise the captive IP (192.168.1.254) for three names:
//   brain.local.  · the iOS-required form
//   brain.lan.    · the OpenWrt-domain form (still works via dnsmasq
//                   for non-iOS clients; we mirror it here for
//                   completeness)
//   brain.        · single-label form some browsers try
//
// No external deps beyond golang.org/x/net/dns/dnsmessage (Go's
// official DNS wire-format package).

import (
	"context"
	"errors"
	"log"
	"net"
	"strings"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

const (
	mdnsAddr4     = "224.0.0.251:5353"
	mdnsLanIface  = "br-lan"
	mdnsTTL       = 120
	mdnsReadBufSz = 9000
)

var mdnsNames = []string{"brain.local.", "brain.lan.", "brain."}

// mdnsResponder runs forever, restarting the socket loop if it errors.
// advertisedIP is what we hand back as the A record — typically the
// captive listener IP so the browser lands on captiveHandler.
func mdnsResponder(ctx context.Context, advertisedIP net.IP) {
	advertisedIP = advertisedIP.To4()
	if advertisedIP == nil {
		log.Printf("mdns: advertisedIP must be IPv4")
		return
	}
	for {
		if ctx.Err() != nil {
			return
		}
		if err := serveMDNS(ctx, advertisedIP); err != nil {
			log.Printf("mdns: %v (retry in 5s)", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

func serveMDNS(ctx context.Context, ip net.IP) error {
	addr, err := net.ResolveUDPAddr("udp4", mdnsAddr4)
	if err != nil {
		return err
	}
	ifi, err := lanInterface()
	if err != nil {
		return err
	}
	conn, err := net.ListenMulticastUDP("udp4", ifi, addr)
	if err != nil {
		return err
	}
	defer conn.Close()

	log.Printf("mdns: listening on %s (%s) → %s for %v",
		mdnsAddr4, ifi.Name, ip, mdnsNames)

	buf := make([]byte, mdnsReadBufSz)
	for {
		if ctx.Err() != nil {
			return nil
		}
		// Wake periodically so context cancellation is responsive.
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		n, src, err := conn.ReadFromUDP(buf)
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				continue
			}
			return err
		}
		if n < 12 {
			continue
		}
		handleMDNSQuery(conn, addr, src, buf[:n], ip)
	}
}

// handleMDNSQuery parses an incoming mDNS query and, if it asks for one
// of our names, fires off a multicast response carrying the A record.
// Anything else is silently ignored — this isn't a general DNS server.
func handleMDNSQuery(
	conn *net.UDPConn,
	mcast *net.UDPAddr,
	src *net.UDPAddr,
	msg []byte,
	ip net.IP,
) {
	var p dnsmessage.Parser
	hdr, err := p.Start(msg)
	if err != nil {
		return
	}
	// Real DNS responses (Response=true) and updates (OpCode!=0) are
	// not our concern.
	if hdr.Response {
		return
	}

	var answers []dnsmessage.Resource
	for {
		q, err := p.Question()
		if err == dnsmessage.ErrSectionDone {
			break
		}
		if err != nil {
			return
		}
		name := strings.ToLower(q.Name.String())
		if !contains(mdnsNames, name) {
			continue
		}
		// We only advertise A; AAAA queries get no answer (browser falls
		// back to A). ANY query also gets the A record.
		if q.Type != dnsmessage.TypeA && q.Type != dnsmessage.TypeALL {
			continue
		}
		nm, err := dnsmessage.NewName(name)
		if err != nil {
			continue
		}
		answers = append(answers, dnsmessage.Resource{
			Header: dnsmessage.ResourceHeader{
				Name:  nm,
				Type:  dnsmessage.TypeA,
				Class: dnsmessage.ClassINET,
				TTL:   mdnsTTL,
			},
			Body: &dnsmessage.AResource{
				A: [4]byte{ip[0], ip[1], ip[2], ip[3]},
			},
		})
	}
	if len(answers) == 0 {
		return
	}

	resp := dnsmessage.Message{
		Header: dnsmessage.Header{
			// mDNS responses have ID=0 per RFC 6762 §18.1 (though most
			// implementations also accept echoing the query ID; ID=0
			// is the more compatible choice).
			ID:            0,
			Response:      true,
			Authoritative: true,
		},
		Answers: answers,
	}
	out, err := resp.Pack()
	if err != nil {
		return
	}
	// Multicast answer per §6 ("Responding"). Unicast-on-QU (legacy
	// unicast queries) would be a nice-to-have but isn't necessary
	// for Safari / Chrome / curl on the LAN — they all listen for
	// multicast responses.
	_, _ = conn.WriteToUDP(out, mcast)
	_ = src // src is the original querier — kept around for any future debug logging.
}

func lanInterface() (*net.Interface, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	for i := range ifaces {
		if ifaces[i].Name == mdnsLanIface {
			return &ifaces[i], nil
		}
	}
	return nil, errors.New("br-lan interface not found")
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
