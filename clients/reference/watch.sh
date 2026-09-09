#!/usr/bin/env bash
# Reference "watch" client — the minimum a dumb device needs to talk to Doca.
# Every subcommand is one or two HTTP calls; read it alongside PROTOCOL.md.
#
#   watch.sh pair <code> [name]        complete pairing → prints token (export DOCA_TOKEN=…)
#   watch.sh caps                       capability discovery (what can I see/do?)
#   watch.sh snapshot [ids] [--spark]   current values for surfaces (default: from profile)
#   watch.sh stream [since]             live push channel → NDJSON on stdout
#   watch.sh poll [since]               same, single JSON request (for battery-saver polling)
#   watch.sh ack <seq>                  acknowledge durable events up to seq
#   watch.sh prompts                    open prompts addressed to me
#   watch.sh select <prompt> <choice> [text]     choose (option / dismiss / text)
#   watch.sh say <prompt> <choice> <audio.ogg>   voice choice: upload a clip
#   watch.sh shoot <prompt> <choice> <photo.jpg> [caption]   image choice
#   watch.sh confirm <prompt> <selectionId>      run the outcome
#   watch.sh back <prompt> <selectionId>         change my mind
#   watch.sh profile [file.json]        read, or replace my profile
#   watch.sh vars '{"k":v,...}'         update my variables
#   watch.sh samples <requestId> '<samples-json>'   report sensor samples
#   watch.sh chart <metricIds> <out.png>        server-rendered chart sized for me
#   watch.sh message <type> '<json>'    free-form message to the agent
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$here/lib.sh"

# What this reference device claims to be. Edit freely — the server adapts.
CAPS='{
  "formFactor": "watch",
  "screen": { "w": 450, "h": 450, "shape": "round", "dpr": 2 },
  "input": { "touch": true, "voice": true, "crown": true },
  "audio": { "mic": true, "haptic": true },
  "render": ["image", "sprite", "text"],
  "motion": ["1"],
  "exec": ["js"],
  "sensors": ["heartRate", { "id": "accelerometer", "maxRateHz": 50, "unit": "m/s²" }, "battery", "heading"],
  "ext": { "os": "reference-shell", "firmware": "0.1" }
}'

cmd="${1:-help}"; shift || true
case "$cmd" in
  pair)
    code="${1:?pairing code}"; name="${2:-reference-watch}"
    out="$(api POST /api/v1/devices/pair/complete "$(jq -nc --arg c "$code" --arg n "$name" --argjson caps "$CAPS" '{code:$c,name:$n,caps:$caps}')")"
    printf '%s\n' "$out"; jq -r '"\nexport DOCA_TOKEN=" + .token' <<<"$out" >&2 ;;
  caps)      api GET /api/v1/capabilities | jq . ;;
  snapshot)
    ids=""; spark=""
    for a in "$@"; do [[ "$a" == "--spark" ]] && spark="&spark=1" || ids="$a"; done
    if [[ -z "$ids" ]]; then ids="$(api GET /api/v1/devices/me/profile | jq -r '[.profile.pages[].surfaces[].id] | unique | join(",")')"; fi
    api GET "/api/v1/snapshot?surfaces=$ids$spark" | jq . ;;
  stream)    stream "${1:-0}" ;;
  poll)      api GET "/api/v1/events?since=${1:-0}" | jq . ;;
  ack)       api POST /api/v1/events/ack "{\"seq\":${1:?seq}}" | jq . ;;
  prompts)   api GET /api/v1/prompts | jq . ;;
  select)
    p="${1:?prompt}"; c="${2:?choice}"; sid="$(uuid)"
    if [[ -n "${3:-}" ]]; then body="$(jq -nc --arg s "$sid" --arg c "$c" --arg t "$3" '{selectionId:$s,choiceId:$c,payload:{kind:"text",text:$t}}')"
    else body="$(jq -nc --arg s "$sid" --arg c "$c" '{selectionId:$s,choiceId:$c}')"; fi
    api POST "/api/v1/prompts/$p/select" "$body" | jq . ; echo "selectionId=$sid" >&2 ;;
  say)
    p="${1:?prompt}"; c="${2:?choice}"; f="${3:?audio file}"; sid="$(uuid)"
    api_upload "/api/v1/prompts/$p/select" audio "$f" "audio/ogg" -F "selectionId=$sid" -F "choiceId=$c" -F 'payload={"kind":"voice"}' | jq . ; echo "selectionId=$sid" >&2 ;;
  shoot)
    p="${1:?prompt}"; c="${2:?choice}"; f="${3:?image file}"; cap="${4:-}"; sid="$(uuid)"
    api_upload "/api/v1/prompts/$p/select" image "$f" "image/jpeg" -F "selectionId=$sid" -F "choiceId=$c" -F "payload=$(jq -nc --arg cap "$cap" '{kind:"image",caption:$cap}')" | jq . ; echo "selectionId=$sid" >&2 ;;
  confirm)   api POST "/api/v1/prompts/${1:?prompt}/confirm" "{\"selectionId\":\"${2:?selectionId}\",\"decision\":\"confirm\"}" | jq . ;;
  back)      api POST "/api/v1/prompts/${1:?prompt}/confirm" "{\"selectionId\":\"${2:?selectionId}\",\"decision\":\"back\"}" | jq . ;;
  profile)
    if [[ -n "${1:-}" ]]; then api PUT /api/v1/devices/me/profile "$(cat "$1")" | jq .; else api GET /api/v1/devices/me/profile | jq .; fi ;;
  vars)      api PATCH /api/v1/devices/me/vars "${1:?json}" | jq . ;;
  samples)   api POST /api/v1/sensors/samples "$(jq -nc --arg r "${1:?requestId}" --argjson s "${2:?samples json}" '{requestId:$r,samples:$s}')" | jq . ;;
  chart)     api_bin "/api/v1/render/chart?metrics=${1:?metric ids}&title=$(printf %s "${1%%,*}" | jq -sRr @uri)" "${2:?out.png}" ;;
  message)   api POST /api/v1/messages "$(jq -nc --arg t "${1:?type}" --argjson p "${2:-null}" '{type:$t,payload:$p}')" | jq . ;;
  *) sed -n '2,24p' "$0"; exit 1 ;;
esac
