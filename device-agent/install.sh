#!/bin/sh
# Install the Braintech agent onto an OpenWrt device over SSH.
#
# Usage:
#   DEVICE_ID=dev_xxx PSK=<hex> ./install.sh
# Optional:
#   ROUTER=192.168.1.1            # device LAN IP (default)
#   SERVER_URL=https://getbraintech.com
#   BINARY=./braintech-agent      # path to the cross-compiled arm64 binary
#   ALLOW_EXEC=0
#
# Builds a staging tree, streams it over a single SSH connection (tar pipe — no
# sftp/scp needed, which dropbear lacks), then enables + starts the service.
# You'll be prompted for the router's root password once (or set up an SSH key
# first to skip it).
set -eu

ROUTER="${ROUTER:-192.168.1.1}"
SERVER_URL="${SERVER_URL:-https://getbraintech.com}"
ALLOW_EXEC="${ALLOW_EXEC:-0}"
HERE="$(CDPATH= cd "$(dirname "$0")" && pwd)"
BINARY="${BINARY:-$HERE/braintech-agent}"
INIT="$HERE/files/braintech-agent.init"

: "${DEVICE_ID:?set DEVICE_ID}"
: "${PSK:?set PSK}"
[ -f "$BINARY" ] || { echo "binary not found: $BINARY (build it first — see README)"; exit 1; }
[ -f "$INIT" ]   || { echo "init script not found: $INIT"; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/usr/bin" "$stage/etc/init.d" "$stage/etc/braintech"
cp "$BINARY" "$stage/usr/bin/braintech-agent"
cp "$INIT"   "$stage/etc/init.d/braintech-agent"
cat > "$stage/etc/braintech/agent.conf" <<CONF
BT_SERVER_URL=$SERVER_URL
BT_DEVICE_ID=$DEVICE_ID
BT_PSK=$PSK
BT_ALLOW_EXEC=$ALLOW_EXEC
CONF

echo "Installing braintech-agent on root@$ROUTER (device=$DEVICE_ID) ..."
tar -C "$stage" -czf - . | ssh -o StrictHostKeyChecking=accept-new "root@$ROUTER" '
  tar -xzf - -C / &&
  chmod +x /usr/bin/braintech-agent /etc/init.d/braintech-agent &&
  chmod 600 /etc/braintech/agent.conf &&
  /etc/init.d/braintech-agent enable &&
  /etc/init.d/braintech-agent restart &&
  sleep 2 &&
  echo "--- recent log ---" &&
  logread -e braintech-agent | tail -6
'
echo "done. Tail logs with: ssh root@$ROUTER 'logread -e braintech-agent -f'"
