package main

// ClientHello SNI extraction for stage-2 DPI.
//
// Nearly all kid traffic is TLS, and the server name still travels in
// cleartext in the TLS ClientHello (SNI extension) at connection start.
// Reading it lets us verdict a flow by *destination service* rather than
// destination IP — the fix for shared-anycast collisions (youtube.com and
// drive.google.com on one Google IP). This file is the pure parser; the
// NFQUEUE plumbing that feeds it lives in dpi.go.
//
// ECH (encrypted ClientHello) is the counter-countermeasure: it hides the
// SNI. Our answer is upstream — the sinkhole resolver strips HTTPS/SVCB
// (type-65) records for controlled MACs so the browser never learns the
// ECH keys and falls back to plaintext SNI. (That DNS change ships with
// stage 2's enforcement flip.)

import (
	"encoding/binary"
	"strings"
)

// parseClientHelloSNI extracts the SNI host from a TCP payload that begins
// with a TLS record carrying a ClientHello. Returns (host, true) on a
// clean parse. Returns ("", false) when the payload isn't a TLS
// ClientHello yet (e.g. a bare ACK, or the ClientHello spans more packets
// than we were handed) — callers treat that as "no decision, look at the
// next packet". Never panics on malformed input: every field is
// bounds-checked, so a hostile client can't crash the resolver by
// feeding a truncated or lying record.
func parseClientHelloSNI(payload []byte) (string, bool) {
	// TLS record header: type(1) version(2) length(2). ContentType 22 =
	// handshake.
	if len(payload) < 5 || payload[0] != 0x16 {
		return "", false
	}
	recLen := int(binary.BigEndian.Uint16(payload[3:5]))
	body := payload[5:]
	if recLen < len(body) {
		body = body[:recLen] // trust the record length if the payload over-runs
	}
	// Handshake header: type(1) length(3). HandshakeType 1 = ClientHello.
	if len(body) < 4 || body[0] != 0x01 {
		return "", false
	}
	hsLen := int(body[1])<<16 | int(body[2])<<8 | int(body[3])
	hs := body[4:]
	if hsLen > len(hs) {
		// ClientHello continues in a later TCP segment we don't have.
		return "", false
	}
	hs = hs[:hsLen]

	p := 0
	// client_version(2) + random(32)
	if len(hs) < 34 {
		return "", false
	}
	p += 34
	// session_id
	if p+1 > len(hs) {
		return "", false
	}
	sidLen := int(hs[p])
	p += 1 + sidLen
	// cipher_suites
	if p+2 > len(hs) {
		return "", false
	}
	csLen := int(binary.BigEndian.Uint16(hs[p : p+2]))
	p += 2 + csLen
	// compression_methods
	if p+1 > len(hs) {
		return "", false
	}
	cmLen := int(hs[p])
	p += 1 + cmLen
	// extensions
	if p+2 > len(hs) {
		return "", false
	}
	extTotal := int(binary.BigEndian.Uint16(hs[p : p+2]))
	p += 2
	end := p + extTotal
	if end > len(hs) {
		end = len(hs)
	}
	for p+4 <= end {
		extType := binary.BigEndian.Uint16(hs[p : p+2])
		extLen := int(binary.BigEndian.Uint16(hs[p+2 : p+4]))
		p += 4
		if p+extLen > end {
			return "", false
		}
		if extType == 0x0000 { // server_name
			return parseSNIExtension(hs[p : p+extLen])
		}
		p += extLen
	}
	return "", false
}

// parseSNIExtension reads the ServerNameList and returns the first
// host_name (type 0). Lowercased, trailing dot stripped, for suffix
// matching against block lists.
func parseSNIExtension(ext []byte) (string, bool) {
	if len(ext) < 2 {
		return "", false
	}
	listLen := int(binary.BigEndian.Uint16(ext[:2]))
	list := ext[2:]
	if listLen < len(list) {
		list = list[:listLen]
	}
	q := 0
	for q+3 <= len(list) {
		nameType := list[q]
		nameLen := int(binary.BigEndian.Uint16(list[q+1 : q+3]))
		q += 3
		if q+nameLen > len(list) {
			return "", false
		}
		if nameType == 0x00 { // host_name
			host := strings.ToLower(strings.TrimSuffix(string(list[q:q+nameLen]), "."))
			if host == "" {
				return "", false
			}
			return host, true
		}
		q += nameLen
	}
	return "", false
}
