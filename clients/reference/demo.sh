#!/usr/bin/env bash
# End-to-end walkthrough of the /api/v1 protocol against a running server.
#
#   DOCA_URL=https://localhost:4242 DOCA_ADMIN_TOKEN=doca_… bash clients/reference/demo.sh
#
# Mint the admin token first:  npm run token -- issue --name admin --preset admin
# Everything else (agent, phone, watch) is created by the script. Docker is
# not required: commands whose tool is missing report `command_failed`.
set -euo pipefail
export NODE_NO_WARNINGS=1
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$here/lib.sh"
: "${DOCA_ADMIN_TOKEN:?set DOCA_ADMIN_TOKEN (npm run token -- issue --name admin --preset admin)}"
WORK="$(mktemp -d)"; export API_STATUS_FILE="$WORK/status"; st() { cat "$API_STATUS_FILE"; }; trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK"' EXIT
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
show() { jq -C . 2>/dev/null || cat; }

step "0. Discovery is public; everything else needs a token"
api GET /api/v1/ | show
api GET /api/v1/capabilities | show; echo "(status $(st))"

step "1. Admin mints an agent token and a phone token"
export DOCA_TOKEN="$DOCA_ADMIN_TOKEN"
AGENT="$(api POST /api/v1/devices '{"name":"agent-sim","preset":"agent","kind":"agent"}')"; AGENT_TOKEN="$(jq -r .token <<<"$AGENT")"; AGENT_ID="$(jq -r .device.id <<<"$AGENT")"
PHONE="$(api POST /api/v1/devices '{"name":"phone","preset":"phone","caps":{"formFactor":"phone","screen":{"w":1080,"h":2400},"input":{"touch":true,"text":true,"voice":true,"camera":true},"audio":{"mic":true,"speaker":true},"render":["svg","svg.smil","image"],"motion":["1"],"exec":["js","wasm"]}}')"; PHONE_TOKEN="$(jq -r .token <<<"$PHONE")"; PHONE_ID="$(jq -r .device.id <<<"$PHONE")"
echo "agent=$AGENT_ID phone=$PHONE_ID"

step "2. Phone starts pairing; the watch completes it with its self-declared capabilities"
DOCA_TOKEN="$PHONE_TOKEN"
PAIR="$(api POST /api/v1/devices/pair/start '{"name":"my-watch","preset":"watch"}')"; show <<<"$PAIR"
CODE="$(jq -r .code <<<"$PAIR")"
WATCH_OUT="$(DOCA_TOKEN= bash "$here/watch.sh" pair "$CODE" my-watch 2>/dev/null)"
WATCH_TOKEN="$(jq -r .token <<<"$WATCH_OUT")"; WATCH_ID="$(jq -r .device.id <<<"$WATCH_OUT")"
echo "watch=$WATCH_ID formFactor=$(jq -r .device.caps.formFactor <<<"$WATCH_OUT") scopes=$(jq -c .device.scopes <<<"$WATCH_OUT")"

step "3. Watch discovers capabilities (filtered by its scopes, shaped by its caps)"
DOCA_TOKEN="$WATCH_TOKEN"
api GET /api/v1/capabilities | jq '{protocol: .protocol.version, surfaces: [.surfaces[].id], commands: [.commands[].id], render: .render.defaults, push: .push, sensors: .sensors.declared, prompts}' | show
echo "watch tries an admin call:"; api GET /api/v1/devices | show

step "4. Phone authors the watch profile (what to show, how often, which sensors are allowed)"
DOCA_TOKEN="$PHONE_TOKEN"
api PUT "/api/v1/devices/$WATCH_ID/profile" '{"refreshSec":5,"pages":[{"id":"home","title":"Home","surfaces":[{"id":"system.cpu","metrics":["system.cpu.pct","system.cpu.temp"],"spark":true},{"id":"system.memory","metrics":["system.memory.pct"]}]},{"id":"stack","surfaces":["docker.containers","services.inference"]}],"commands":["services.stop"],"sensors":{"allow":["heartRate","accelerometer"],"autoReport":["battery"]},"prompts":{"receive":true,"haptic":true},"ext":{"theme":"amber"}}' | jq '{version: .profile.version, etag: .profile.etag, warnings: .profile.warnings, pages: [.profile.pages[].id]}' | show

step "5. Watch opens its push channel (SSE) in the background and reads a snapshot"
DOCA_TOKEN="$WATCH_TOKEN"
bash "$here/watch.sh" stream 0 > "$WORK/watch.ndjson" 2>/dev/null &
sleep 1
bash "$here/watch.sh" snapshot "system.cpu,system.memory" --spark | jq '.surfaces[] | {id, observedAt, ttlSec, metrics: [.metrics[] | {id, value, display, unit, thresholds, spark}]}' | show

step "6. Agent listens on its own channel and raises a prompt with five kinds of choice"
DOCA_TOKEN="$AGENT_TOKEN" node "$here/agent-sim.js" > "$WORK/agent.log" 2>&1 &
sleep 1
PROMPT="$(DOCA_TOKEN="$AGENT_TOKEN" node "$here/agent-sim.js" prompt "$WATCH_ID" agent)"; PID="$(jq -r .prompt.id <<<"$PROMPT")"
echo "prompt $PID delivered to: $(jq -c '.prompt.delivered' <<<"$PROMPT")"
sleep 1
echo "— as received by the watch (tailored: no image choice, figure → motion scene):"
jq -c 'select(.type=="prompt.new") | .payload.prompt | {title, choices: [.choices[] | {id, type, label}], figure: (.body[] | select(.type=="figure") | .representation.kind), haptic}' "$WORK/watch.ndjson" | show

step "7. Watch picks a pre-supplied option, then changes its mind (back), then answers in free text"
DOCA_TOKEN="$WATCH_TOKEN"
SID1="$(uuid)"
api POST "/api/v1/prompts/$PID/select" "{\"selectionId\":\"$SID1\",\"choiceId\":\"wait\"}" | jq '{status, outcome: .outcome.summary}' | show
echo "retry with the same selectionId is a no-op replay:"; api POST "/api/v1/prompts/$PID/select" "{\"selectionId\":\"$SID1\",\"choiceId\":\"wait\"}" | jq '{status, replay}' | show
api POST "/api/v1/prompts/$PID/confirm" "{\"selectionId\":\"$SID1\",\"decision\":\"back\"}" | jq '{status}' | show
SID2="$(uuid)"
api POST "/api/v1/prompts/$PID/select" "{\"selectionId\":\"$SID2\",\"choiceId\":\"type\",\"payload\":{\"kind\":\"text\",\"text\":\"just cap the power to 250W\",\"ext\":{\"locale\":\"en-GB\"}}}" | show
echo "… pending; the agent gets prompt.selected, answers, and the watch receives prompt.outcome over its stream:"
for _ in $(seq 1 20); do grep -q '"prompt.outcome"' "$WORK/watch.ndjson" && break; sleep 0.5; done
jq -c 'select(.type=="prompt.outcome") | {type, seq, class, status: .payload.status, summary: .payload.outcome.summary, blocks: .payload.outcome.blocks}' "$WORK/watch.ndjson" | show
api POST "/api/v1/prompts/$PID/confirm" "{\"selectionId\":\"$SID2\",\"decision\":\"confirm\"}" | show
echo "agent side:"; grep -E "prompt\.(selected|confirmed)|outcome for" "$WORK/agent.log" | sed 's/^/  /'

step "8. Agent asks for sensors on demand (only what the profile allows); watch streams samples"
REQ="$(DOCA_TOKEN="$AGENT_TOKEN" node "$here/agent-sim.js" sensors "$WATCH_ID")"; RID="$(jq -r .request.id <<<"$REQ")"
jq '{request: {id: .request.id, sensors: [.request.sensors[] | {id, rateHz, durationSec}], expiresAt: .request.expiresAt}, rejected}' <<<"$REQ" | show
sleep 0.5; echo "watch received:"; jq -c 'select(.type=="sensor.request") | {type, reason: .payload.request.reason, sensors: [.payload.request.sensors[].id]}' "$WORK/watch.ndjson" | show
bash "$here/watch.sh" samples "$RID" '[{"sensor":"heartRate","value":71},{"sensor":"heartRate","value":73},{"sensor":"accelerometer","values":[0.02,-0.01,9.81]},{"sensor":"battery","value":58},{"sensor":"heading","value":12}]' | show
DOCA_TOKEN="$AGENT_TOKEN" api GET "/api/v1/agent/sensors/requests/$RID" | jq '{sampleCount: .request.sampleCount, samples: [.samples[] | {sensor, value, values}]}' | show
DOCA_TOKEN="$AGENT_TOKEN" api DELETE "/api/v1/agent/sensors/requests/$RID" | jq '.request.status' | show

step "9. Agent ships a small JS artifact; delivered only because the watch declared exec:[js]"
DOCA_TOKEN="$AGENT_TOKEN" node "$here/agent-sim.js" artifact "$WATCH_ID" | jq '{artifact: {id: .artifact.id, runtime: .artifact.runtime, bytes: .artifact.bytes, sha256: .artifact.sha256[0:16]}, report}' | show
sleep 0.5; jq -c 'select(.type=="artifact.deliver") | {type, entry: .payload.artifact.entry, inline: .payload.inline[0:60]}' "$WORK/watch.ndjson" | show

step "10. Variables, free-form messages, alerts — the escape hatches for the unforeseen"
DOCA_TOKEN="$WATCH_TOKEN"
bash "$here/watch.sh" vars '{"batteryPct":58,"wristRaised":true,"ext":{"anything":"goes"}}' | show
bash "$here/watch.sh" message gesture '{"name":"double-tap","confidence":0.91}' | show
DOCA_TOKEN="$AGENT_TOKEN" node "$here/agent-sim.js" alert "$WATCH_ID" | show
DOCA_TOKEN="$AGENT_TOKEN" api GET "/api/v1/devices/$WATCH_ID/vars" | show
sleep 0.5; echo "agent saw:"; grep -E "device\.(vars|message)" "$WORK/agent.log" | sed 's/^/  /'

step "11. Server-rendered graphics for a client with no SVG engine"
DOCA_TOKEN="$WATCH_TOKEN"
bash "$here/watch.sh" chart "system.cpu.pct,system.memory.pct" "$WORK/chart.png"
FIG="$(jq -r 'select(.type=="prompt.new") | .payload.prompt.body[] | select(.type=="figure") | .id' "$WORK/watch.ndjson" | head -1)"
api_bin "/api/v1/render/figure/$FIG?w=120&h=120&frames=8" "$WORK/sprite.png"
[[ -n "${DOCA_ARTIFACT_DIR:-}" ]] && cp "$WORK/chart.png" "$WORK/sprite.png" "$DOCA_ARTIFACT_DIR"/ && echo "saved chart.png + sprite.png to $DOCA_ARTIFACT_DIR"

step "12. Chat: the phone asks, and the turn belongs to the user — the watch sees it too"
DOCA_TOKEN="$PHONE_TOKEN" bash "$here/watch.sh" stream 0 > "$WORK/phone.ndjson" 2>/dev/null &
sleep 1
DOCA_TOKEN="$PHONE_TOKEN"
TURN="$(api POST /api/v1/harness/messages '{"message":"In one sentence: how busy is this machine?"}')"; show <<<"$TURN"
TID="$(jq -r .turnId <<<"$TURN")"; SESSION="$(jq -r .sessionId <<<"$TURN")"
echo "in flight: $(api GET /api/v1/harness/turns | jq -c .turns)"
# A turn with no model configured fails in milliseconds; a real one can take a while.
for _ in $(seq 1 120); do jq -e --arg t "$TID" 'select(.type=="agent.turn" and .payload.turnId==$t and .payload.state!="started")' "$WORK/phone.ndjson" >/dev/null 2>&1 && break; sleep 0.5; done
echo "— the phone, which asked, gets the deltas and the tool steps:"
jq -c --arg t "$TID" 'select(.payload.turnId==$t) | {type, state: .payload.state, tool: .payload.name, phase: .payload.phase, delta: .payload.delta, text: .payload.text, error: .payload.error} | with_entries(select(.value != null))' "$WORK/phone.ndjson" | sed 's/^/  /'
echo "— the watch, which did not ask, gets the same turn and zero text deltas:"
jq -c --arg t "$TID" 'select(.payload.turnId==$t and .type=="agent.turn") | {type, state: .payload.state, by: .payload.by, text: .payload.text}' "$WORK/watch.ndjson" | sed 's/^/  /'
echo "  agent.text frames on the watch: $(jq -c --arg t "$TID" 'select(.type=="agent.text" and .payload.turnId==$t)' "$WORK/watch.ndjson" | wc -l) (by design: deltas go only to the device that posted)"
echo "— one conversation, shared: the phone reads the transcript the dashboard also shows:"
api GET "/api/v1/harness/sessions/$SESSION?limit=4" | jq '{title: .session.title, messages: [.messages[] | {role, content: (.content[0:70]), tools}]}' | show
echo "watch tries to manage conversations (it holds harness:chat only):"
DOCA_TOKEN="$WATCH_TOKEN" api GET /api/v1/harness/sessions | show; echo "(status $(st))"

step "13. Reconnect semantics: the watch drops its stream, misses events, resumes with since=<cursor>"
kill %1 2>/dev/null || true; sleep 0.3
LAST="$(jq -r 'select(.seq!=null) | .seq' "$WORK/watch.ndjson" | tail -1)"
DOCA_TOKEN="$AGENT_TOKEN" node "$here/agent-sim.js" alert "$WATCH_ID" >/dev/null
DOCA_TOKEN="$WATCH_TOKEN"
echo "poll since=$LAST while offline:"; bash "$here/watch.sh" poll "$LAST" | jq '{events: [.events[] | {seq, type, class, title: .payload.title}], nextSince, resync}' | show
bash "$here/watch.sh" ack "$(bash "$here/watch.sh" poll "$LAST" | jq .nextSince)" | show

step "14. Phone revokes the watch; its token dies immediately"
DOCA_TOKEN="$PHONE_TOKEN" api DELETE "/api/v1/devices/$WATCH_ID" | show
DOCA_TOKEN="$WATCH_TOKEN" api GET /api/v1/capabilities | show; echo "(status $(st))"

step "Event log the watch received during the session"
jq -c 'select(.seq!=null) | {seq, type, class}' "$WORK/watch.ndjson" | sed 's/^/  /'
echo; echo "done."
