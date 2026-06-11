#!/usr/bin/env bash
# scripts/fetch-earn-videos.sh
#
# Resolves and downloads the curated TED / TED-Ed catalog, uploads each
# video to Vercel Blob, and writes the resolved entries (with blob URLs,
# real durations, and YouTube IDs) into app/lib/video-catalog.generated.json.
#
# Input:  scripts/earn-videos-curation.json
# Output: app/lib/video-catalog.generated.json
#
# Why this design:
#   - The catalog lives in source so it diffs cleanly in PRs and survives
#     git checkout.
#   - I (Claude) write the curation file with titles, not YouTube IDs,
#     because guessing IDs leads to wrong/private/removed videos. yt-dlp's
#     ytsearch1: resolves a title to the top result.
#   - Blob upload happens here (not server-side) so the production runtime
#     never holds large video bytes. Just URLs.
#
# Prerequisites:
#   - yt-dlp (brew install yt-dlp || apt install yt-dlp || pipx install yt-dlp)
#   - ffprobe (brew install ffmpeg / apt install ffmpeg) — for duration probe
#   - jq
#   - BLOB_READ_WRITE_TOKEN env var. Get one via:
#       vercel storage add blob earn-videos   # one-time, ~30s
#       vercel env pull .env.local            # pulls BLOB_READ_WRITE_TOKEN
#       export BLOB_READ_WRITE_TOKEN=$(grep BLOB_READ_WRITE_TOKEN .env.local | cut -d= -f2 | tr -d '"')
#
# Usage:
#   ./scripts/fetch-earn-videos.sh                  # all entries
#   ./scripts/fetch-earn-videos.sh ted-robinson-creativity teded-avena-sugar
#       only specific entries
#
# Idempotent: if an entry's id already exists in the generated JSON with a
# blob URL that still 200s, the script skips it. Use --force to re-fetch.

set -euo pipefail

cd "$(dirname "$0")/.."

CURATION=scripts/earn-videos-curation.json
OUT=app/lib/video-catalog.generated.json
TMP_DIR=${TMPDIR:-/tmp}/braintech-earn-videos
mkdir -p "$TMP_DIR"

FORCE=0
ONLY_IDS=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --help|-h)
      head -n 35 "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) ONLY_IDS+=("$arg") ;;
  esac
done

if ! command -v yt-dlp >/dev/null; then
  echo "yt-dlp not found. Install: brew install yt-dlp / pipx install yt-dlp" >&2
  exit 1
fi
if ! command -v ffprobe >/dev/null; then
  echo "ffprobe not found. Install: brew install ffmpeg / apt install ffmpeg" >&2
  exit 1
fi
if ! command -v jq >/dev/null; then
  echo "jq not found. Install: brew install jq / apt install jq" >&2
  exit 1
fi
if [ -z "${BLOB_READ_WRITE_TOKEN:-}" ]; then
  echo "BLOB_READ_WRITE_TOKEN not set." >&2
  echo "First time: vercel storage add blob earn-videos" >&2
  echo "Then:      vercel env pull .env.local && \\" >&2
  echo "           export BLOB_READ_WRITE_TOKEN=\$(grep BLOB_READ_WRITE_TOKEN .env.local | cut -d= -f2 | tr -d '\"')" >&2
  exit 1
fi

EXISTING="[]"
if [ -f "$OUT" ]; then
  EXISTING=$(cat "$OUT")
fi

# yt-dlp format spec: prefer ≤720p MP4 with audio in one file (no merging
# needed in the kid's browser). Reels-style 480p would suffice for an
# earn-video, but 720p still keeps individual files under ~150 MB even
# for 20-min talks.
YT_FORMAT='bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/b'

upload_to_blob() {
  local local_path=$1
  local blob_key=$2
  local size
  size=$(stat -c %s "$local_path" 2>/dev/null || stat -f %z "$local_path")
  # Vercel Blob client upload API (HTTPS PUT). Returns JSON with {url}.
  curl -sS -X PUT \
    -H "Authorization: Bearer ${BLOB_READ_WRITE_TOKEN}" \
    -H "x-content-type: video/mp4" \
    -H "x-add-random-suffix: 0" \
    -H "x-cache-control-max-age: 31536000" \
    --data-binary "@${local_path}" \
    "https://blob.vercel-storage.com/${blob_key}"
}

RESULTS="[]"
ENTRY_IDS=$(jq -r '.entries[].id' "$CURATION")

for ID in $ENTRY_IDS; do
  if [ ${#ONLY_IDS[@]} -gt 0 ]; then
    keep=0
    for want in "${ONLY_IDS[@]}"; do
      [ "$want" = "$ID" ] && keep=1
    done
    [ "$keep" -eq 0 ] && continue
  fi

  ENTRY=$(jq -c --arg id "$ID" '.entries[] | select(.id == $id)' "$CURATION")
  TITLE=$(echo "$ENTRY" | jq -r '.title')
  SPEAKER=$(echo "$ENTRY" | jq -r '.speaker')
  SOURCE=$(echo "$ENTRY" | jq -r '.source')
  QUERY=$(echo "$ENTRY" | jq -r '.search_query')
  TOPICS=$(echo "$ENTRY" | jq -c '.topics')
  AGE_MIN=$(echo "$ENTRY" | jq -r '.age_min')
  BLURB=$(echo "$ENTRY" | jq -r '.blurb')
  CREDIT_PASS=$(echo "$ENTRY" | jq -r '.credit_pass')
  CREDIT_PARTIAL=$(echo "$ENTRY" | jq -r '.credit_partial')

  # Reuse cached entry if present and the blob URL still 200s.
  CACHED=$(echo "$EXISTING" | jq -c --arg id "$ID" 'map(select(.id == $id)) | .[0] // empty')
  if [ -n "$CACHED" ] && [ "$FORCE" -eq 0 ]; then
    CACHED_URL=$(echo "$CACHED" | jq -r '.asset_url // empty')
    if [ -n "$CACHED_URL" ]; then
      HTTP=$(curl -sS -o /dev/null -w '%{http_code}' -I "$CACHED_URL" || echo "000")
      if [ "$HTTP" = "200" ]; then
        echo "[$ID] cached, asset_url still live → reusing"
        RESULTS=$(echo "$RESULTS" | jq --argjson e "$CACHED" '. + [$e]')
        continue
      fi
    fi
  fi

  echo "[$ID] $TITLE — $SPEAKER"
  echo "  resolving via yt-dlp ytsearch1: …"
  # ytsearch1 returns the top match. Print the youtube_id, then download.
  YT_ID=$(yt-dlp --skip-download --print "%(id)s" "ytsearch1:${QUERY}" 2>/dev/null | head -n 1 | tr -d '\n')
  if [ -z "$YT_ID" ]; then
    echo "  WARN: ytsearch returned nothing for '${QUERY}' — skipping" >&2
    continue
  fi
  echo "  youtube_id=$YT_ID"

  OUT_FILE="${TMP_DIR}/${ID}.mp4"
  if [ ! -f "$OUT_FILE" ] || [ "$FORCE" -eq 1 ]; then
    rm -f "$OUT_FILE"
    echo "  downloading…"
    yt-dlp \
      -q --no-warnings \
      -f "$YT_FORMAT" \
      --merge-output-format mp4 \
      -o "$OUT_FILE" \
      "https://www.youtube.com/watch?v=${YT_ID}" \
      || { echo "  WARN: yt-dlp failed for $YT_ID — skipping" >&2; continue; }
  else
    echo "  reusing ${OUT_FILE}"
  fi

  # Real duration from the file, not the curation estimate.
  DURATION=$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$OUT_FILE" \
    | awk '{printf "%d\n", $1}')
  SIZE=$(stat -c %s "$OUT_FILE" 2>/dev/null || stat -f %z "$OUT_FILE")
  echo "  duration=${DURATION}s size=$((SIZE / 1024 / 1024))MB"

  echo "  uploading to Vercel Blob…"
  BLOB_KEY="earn-videos/${ID}.mp4"
  UPLOAD=$(upload_to_blob "$OUT_FILE" "$BLOB_KEY")
  ASSET_URL=$(echo "$UPLOAD" | jq -r '.url // empty')
  if [ -z "$ASSET_URL" ]; then
    echo "  WARN: upload failed: $UPLOAD" >&2
    continue
  fi
  echo "  asset_url=$ASSET_URL"

  RESULTS=$(echo "$RESULTS" | jq --arg id "$ID" \
    --arg title "$TITLE" \
    --arg speaker "$SPEAKER" \
    --arg source "$SOURCE" \
    --arg yt_id "$YT_ID" \
    --argjson topics "$TOPICS" \
    --argjson age_min "$AGE_MIN" \
    --arg blurb "$BLURB" \
    --argjson duration "$DURATION" \
    --argjson credit_pass "$CREDIT_PASS" \
    --argjson credit_partial "$CREDIT_PARTIAL" \
    --arg asset_url "$ASSET_URL" \
    '. + [{
      id: $id,
      title: $title,
      speaker: $speaker,
      source: $source,
      youtube_id: $yt_id,
      duration_seconds: $duration,
      topics: $topics,
      age_min: $age_min,
      blurb: $blurb,
      credit_pass: $credit_pass,
      credit_partial: $credit_partial,
      asset_url: $asset_url
    }]')
done

echo "$RESULTS" | jq '.' > "$OUT"
COUNT=$(echo "$RESULTS" | jq 'length')
echo "wrote $COUNT entries → $OUT"
