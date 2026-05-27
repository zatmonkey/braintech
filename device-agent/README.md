# braintech-agent

A tiny, **generic** reconciliation daemon for OpenWrt devices (built for the
**OpenWrt One**, OpenWrt 24.03 / `fw4`). It long-polls the Braintech control
plane for a **signed instruction document**, verifies it with the device's
pre-shared key, applies it, and reports the result.

The whole point: the instruction grammar is small and stable, so the **server
gets smarter without ever re-flashing this binary.** Bri writes desired state
in the cloud; the device reconciles itself against it.

## How it works

```
Bri (cloud) ──▶ desired state (Neon) ──▶ /api/device/sync (long-poll, signed)
                                              │  HTTPS out only (NAT-friendly)
                                              ▼
                                    braintech-agent  ── verify HMAC ──▶ apply (uci/fw4) ──▶ /api/device/report
```

- **Pull, never push.** The router only makes outbound HTTPS calls, so it works
  behind any home NAT. No inbound ports, no public IP.
- **Desired-state reconciliation.** The agent applies the latest version and
  reports back; if it's offline it simply catches up when it returns.
- **Generic grammar.** Operations are expressed against OpenWrt's stable
  interfaces — overwhelmingly **UCI** — which covers firewall, network, dhcp,
  dnsmasq, wireless, etc. New behavior = new instruction payloads, not new code.

## The instruction document (server → device)

`GET /api/device/sync?since=<appliedVersion>` returns either `304 Not Modified`
(long-poll, no change) or `200` with this body, plus header
`X-Braintech-Signature: sha256=<hex>` = HMAC-SHA256 of the **raw body** keyed by
the device PSK:

```json
{
  "version": 42,
  "device_id": "dev_ab12cd34",
  "issued_at": "2026-05-27T18:00:00Z",
  "ops": [
    { "type": "uci.add", "config": "firewall", "section_type": "rule",
      "values": { "name": "earn-tiktok", "src": "lan", "dest": "wan",
                  "proto": "tcp", "dest_port": "443", "target": "REJECT" } },
    { "type": "uci.commit", "config": "firewall" },
    { "type": "service", "name": "firewall", "action": "reload" }
  ]
}
```

### Supported ops

| `type` | Fields | Maps to |
|---|---|---|
| `uci.set` | `config`, `section`, (`option`+`value`) or `values{}` | `uci set` |
| `uci.add` | `config`, `section_type`, `values{}` | `uci add` (+ sets) → returns new section |
| `uci.add_list` | `config`, `section`, `option`, `list[]` | `uci add_list` |
| `uci.delete` | `config`, `section`, [`option`] | `uci delete` |
| `uci.commit` | `config` (empty = all) | `uci commit` |
| `service` | `name`, `action` (start/stop/restart/reload/enable/disable) | `/etc/init.d/<name> <action>` |
| `file.write` | `path` (allow-listed), `content`, [`mode`] | write file |
| `package.install` / `package.remove` | `name` | `opkg` |
| `exec` | `command[]` | raw command — **off unless `BT_ALLOW_EXEC=1`** |

Ops run in order. **Any failure rolls the whole batch back** (`uci revert` +
restore of the original `/etc/config/*` files + firewall reload), so a bad
instruction can't leave the network half-configured.

## The report (device → server)

`POST /api/device/report`:

```json
{ "device_id": "dev_ab12cd34", "version": 42, "status": "applied",
  "ops": [{ "index": 0, "type": "uci.add", "ok": true, "output": "cfg0a1b2c" }],
  "applied_at": "2026-05-27T18:00:03Z", "agent_version": "0.1.0" }
```

`status` ∈ `applied` | `failed` | `rejected` (bad signature / device mismatch).

## Auth & security

- **PSK per device** (`BT_PSK`): used for bearer auth (`Authorization: Bearer
  <psk>`, plus `X-Device-Id`) **and** to verify the HMAC on every instruction.
  The server stores it (encrypted) so it can both authenticate the device and
  sign instructions. The **MAC is only a human-friendly identifier — never
  trusted for auth** (it's spoofable).
- **Signed instructions:** the agent refuses anything whose HMAC doesn't match.
- **Bounded grammar:** no shell by default — only typed UCI/service/file/package
  ops. `file.write` is restricted to `/etc/`, `/tmp/`, `/var/`.
- **Rollback on failure** keeps a bad push from bricking the home network.
- Harden later: challenge-response or mTLS instead of bearer PSK; config signing
  with an asymmetric key so the server never needs the plaintext PSK.

## Build (cross-compile for the OpenWrt One)

The OpenWrt One is MediaTek MT7981 → **aarch64**:

```sh
cd device-agent
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o braintech-agent .
# (other targets: GOARCH=arm GOARM=7 for armv7, GOARCH=mipsle for older MIPS routers)
```

## Install on the device

```sh
scp braintech-agent root@192.168.1.1:/usr/bin/braintech-agent
scp files/braintech-agent.init root@192.168.1.1:/etc/init.d/braintech-agent
ssh root@192.168.1.1 'chmod +x /usr/bin/braintech-agent /etc/init.d/braintech-agent; \
  mkdir -p /etc/braintech'
# create /etc/braintech/agent.conf from files/agent.conf.example (set DEVICE_ID + PSK), chmod 600
ssh root@192.168.1.1 '/etc/init.d/braintech-agent enable && /etc/init.d/braintech-agent start'
logread -e braintech-agent -f   # watch it
```

## Config (env, set by the init script from `/etc/braintech/agent.conf`)

| Var | Default | Notes |
|---|---|---|
| `BT_SERVER_URL` | `https://getbraintech.com` | control plane base URL |
| `BT_DEVICE_ID` | — (required) | e.g. `dev_ab12cd34` |
| `BT_PSK` | — (required) | per-device secret (hex) |
| `BT_STATE_PATH` | `/etc/braintech/state.json` | applied-version cursor |
| `BT_DESIRED_PATH` | `/etc/braintech/desired.json` | cached last instruction |
| `BT_ALLOW_EXEC` | `0` | set `1` to allow the `exec` op |

## Server side (to build on Vercel)

Two stateless functions over Neon:

- `GET /api/device/sync` — auth the device by `X-Device-Id` + bearer PSK; if a
  newer `desired` version exists than `?since=`, return it with the
  `X-Braintech-Signature` HMAC header; otherwise hold up to ~25s (long-poll)
  then `304`.
- `POST /api/device/report` — record applied/failed/rejected + per-op results,
  update `reported_version` and `last_seen`.

Bri never touches the device — it (via cloud-side MCP tools) writes the
`desired` ruleset + bumps the version. The agent does the rest.
