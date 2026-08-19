package main

import (
	"encoding/binary"
	"testing"
)

// buildClientHello encodes a minimal-but-valid TLS ClientHello carrying an
// SNI host, wrapped in a handshake message and a TLS record. Independent
// of the parser's code path, so a shared off-by-one can't make a bad test
// pass. sessionID/cipher/compression are token-sized to exercise the skip
// arithmetic.
func buildClientHello(host string) []byte {
	// server_name extension body: list_len(2) name_type(1) name_len(2) name
	sni := []byte{0x00}
	sni = append(sni, u16(uint16(len(host)))...)
	sni = append(sni, []byte(host)...)
	sniList := append(u16(uint16(len(sni))), sni...)
	ext := append([]byte{0x00, 0x00}, u16(uint16(len(sniList)))...)
	ext = append(ext, sniList...)

	body := []byte{0x03, 0x03}          // client_version TLS1.2
	body = append(body, make([]byte, 32)...) // random
	body = append(body, 0x02, 0xAB, 0xCD)    // session_id len 2 + 2 bytes
	body = append(body, 0x00, 0x02, 0x13, 0x01) // cipher_suites len 2 + one suite
	body = append(body, 0x01, 0x00)             // compression_methods len 1 + null
	body = append(body, u16(uint16(len(ext)))...) // extensions length
	body = append(body, ext...)

	hs := []byte{0x01} // ClientHello
	l := len(body)
	hs = append(hs, byte(l>>16), byte(l>>8), byte(l))
	hs = append(hs, body...)

	rec := []byte{0x16, 0x03, 0x01} // handshake, TLS1.0 record version
	rec = append(rec, u16(uint16(len(hs)))...)
	rec = append(rec, hs...)
	return rec
}

func u16(v uint16) []byte {
	b := make([]byte, 2)
	binary.BigEndian.PutUint16(b, v)
	return b
}

func TestParseClientHelloSNI(t *testing.T) {
	cases := []string{"www.youtube.com", "drive.google.com", "tr.snapchat.com", "a"}
	for _, want := range cases {
		got, ok := parseClientHelloSNI(buildClientHello(want))
		if !ok || got != want {
			t.Errorf("parseClientHelloSNI(%q) = %q, %v; want %q, true", want, got, ok, want)
		}
	}

	// Uppercase + trailing dot normalize.
	if got, ok := parseClientHelloSNI(buildClientHello("WWW.YouTube.COM.")); !ok || got != "www.youtube.com" {
		t.Errorf("normalize = %q, %v; want www.youtube.com", got, ok)
	}
}

func TestParseClientHelloSNI_NoDecision(t *testing.T) {
	// Not TLS at all (bare ACK / HTTP) → no decision.
	if _, ok := parseClientHelloSNI([]byte("GET / HTTP/1.1\r\n")); ok {
		t.Error("plain HTTP parsed as ClientHello")
	}
	// Empty / short.
	if _, ok := parseClientHelloSNI(nil); ok {
		t.Error("nil parsed")
	}
	if _, ok := parseClientHelloSNI([]byte{0x16, 0x03}); ok {
		t.Error("2-byte parsed")
	}
	// Valid record framing but truncated mid-ClientHello → no decision,
	// not a panic (the caller waits for the next segment).
	full := buildClientHello("www.youtube.com")
	for cut := 5; cut < len(full); cut++ {
		if _, ok := parseClientHelloSNI(full[:cut]); ok {
			t.Errorf("truncated at %d parsed as complete", cut)
		}
	}
	// A ClientHello with no SNI extension → no decision (not a crash).
	noSNI := []byte{0x16, 0x03, 0x01, 0x00, 0x2d, 0x01, 0x00, 0x00, 0x29, 0x03, 0x03}
	noSNI = append(noSNI, make([]byte, 32)...) // random
	noSNI = append(noSNI, 0x00, 0x00, 0x00, 0x00, 0x00) // sid0, cipher0, comp0, ext_total0
	if _, ok := parseClientHelloSNI(noSNI); ok {
		t.Error("no-SNI ClientHello returned a host")
	}
}
