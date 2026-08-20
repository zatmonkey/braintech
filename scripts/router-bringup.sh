#!/usr/bin/env bash
# Post-reflash bring-up for the OpenWrt One after moving snapshot → 24.10.x
# stable. Run from the dev box once the router is back at $ROUTER with root
# password auth working. Reinstalls the DPI kernel packages, the braintech
# agent + its device identity, then lets `btnet reset` rebuild all the
# braintech firewall/DNS state from the control plane.
#
# It does NOT touch network/wifi/WAN config — restore those from the backup
# tarball (scratchpad/router-backup/bt-router-backup.tar.gz) or LuCI FIRST,
# and confirm the router has internet, before running this.
#
# Idempotent: safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTER="${BRAINTECH_ROUTER:-192.168.1.1}"
ROUTER_PASS="${BRAINTECH_ROUTER_PASS:-password123}"
ASKPASS="/tmp/btnet-askpass.sh"
# Directory holding the pre-reflash artifacts (agent binary, init, agent.conf).
ART="${BT_ARTIFACTS:-$HERE/../.router-artifacts}"

printf '#!/bin/sh\necho %q\n' "$ROUTER_PASS" > "$ASKPASS"; chmod +x "$ASKPASS"
rssh() { SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force DISPLAY=:0 setsid -w \
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      -o LogLevel=ERROR "root@$ROUTER" "$@"; }
rscp() { SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force DISPLAY=:0 setsid -w \
  scp -O -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      -o LogLevel=ERROR "$1" "root@$ROUTER:$2"; }

for f in braintech-agent bt-init bt-agent.conf; do
  [[ -f "$ART/$f" ]] || { echo "missing artifact: $ART/$f" >&2; exit 1; }
done

echo "== 1. sanity: router reachable + has internet =="
rssh '. /etc/os-release; echo "OpenWrt $VERSION_ID"; ping -c1 -w5 downloads.openwrt.org >/dev/null && echo "internet OK" || { echo "NO INTERNET — restore WAN config first"; exit 1; }'

echo "== 2. install DPI packages =="
rssh 'opkg update && opkg install kmod-nft-queue libndpi netifyd'
echo "   verify nft queue expression now resolves:"
# Multi-line spec — nft rejects the whole chain body on one line.
rssh 'printf "%s\n" "table inet btqp {" "chain c {" "  type filter hook forward priority 0; policy accept;" "  tcp dport 443 queue num 99 bypass" "}" "}" | nft -c -f /dev/stdin && echo "   nft queue: SUPPORTED" || echo "   nft queue: STILL MISSING (check kmod-nft-queue install)"'

echo "== 3. restore braintech identity + agent =="
rssh 'mkdir -p /etc/braintech'
rscp "$ART/bt-agent.conf"   /etc/braintech/agent.conf
rscp "$ART/bt-init"         /etc/init.d/braintech-agent
rscp "$ART/braintech-agent" /usr/bin/braintech-agent
rssh 'chmod 600 /etc/braintech/agent.conf; chmod 755 /etc/init.d/braintech-agent /usr/bin/braintech-agent'

echo "== 4. enable + start agent =="
rssh '/etc/init.d/braintech-agent enable; /etc/init.d/braintech-agent restart; sleep 6; logread | grep braintech-agent | tail -3'

echo "== 5. push desired state from the control plane =="
"$HERE/btnet" reset && "$HERE/btnet" wait-sync 120

echo "== 6. verify DPI infra landed =="
rssh 'echo "--- controlled set ---"; nft list set inet fw4 bt_controlled_macs 2>&1 | grep -c elements;
      echo "--- sni queue chain (needs kmod-nft-queue) ---"; nft list chain inet fw4 bt_sni_q 2>&1 | head -5;
      echo "--- agent log (expect: dns_filter nft infra installed, NO queue-skip line) ---"; logread | grep -E "dns_filter|dpi" | tail -4'

echo
echo "Bring-up complete. Agent is 0.7.0 in OBSERVE mode (dpiEnforce=false)."
echo "Next: watch 'logread | grep dpi(observe)' for correct SNI attribution,"
echo "confirm ct mark 1 appears on allowed flows, THEN flip dpiEnforce and redeploy."
