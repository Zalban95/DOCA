# Building an agent integration on the Doca client API

This guide is for the developer wiring **the agent side**: the OpenClaw agent, a
cron job, an alerting rule, a notebook — anything that wants to *ask the user
something on whatever device they are wearing*, tell them something, borrow a
sensor, or hand a device a piece of code to run.

An agent is just a device with the `agent` scope. It uses the same base URL, the
same token format and the same push channel as a watch; the difference is the
`/api/v1/agent/*` endpoints and the event types it receives.

Companion documents: [`PROTOCOL.md`](../../PROTOCOL.md) (wire formats, section
numbers cited below), the [OpenAPI document](openapi.json), and
`clients/reference/agent-sim.js` — a working Node agent that does everything on
this page without an LLM.

## 1. Get an agent token

On the host:

```bash
npm run token -- issue --name openclaw --preset agent --kind agent
```

or from an admin token: `POST /devices { "name": "openclaw", "preset": "agent", "kind": "agent" }`.

The `agent` preset is `agent read:* artifacts:* media:* sensors:* vars:* profile:*`.
It can read everything and drive the interaction protocol, but has **no
`command:` scopes**: actions the agent proposes run under the *confirming
device's* token, never the agent's. That is the safety property of the whole
design — the human's device is the thing that can act, and only within its scopes.

## 2. Know your audience: devices and their profiles

```http
GET /api/v1/agent/devices
```

returns every non-revoked device with `caps`, `scopes`, `online`, `pending`
(unacknowledged events) and its **effective profile**. Use it to decide *who* to
ask and *how*:

- `caps.input.camera` → you can request a photo; `caps.audio.mic` → voice works.
- `caps.render`/`caps.motion` → whether a figure will arrive as SVG, a motion scene,
  a sprite, a PNG or a caption (you author once; the server picks per device).
- `caps.exec` → which artifact runtimes you may ship.
- `caps.sensors` and `profile.sensors.allow` → what you may ask for, and what the
  user consented to.
- `profile.prompts.receive`/`quietHours` → whether a prompt will be delivered now.
- `online` → whether it will be seen immediately or wait in the outbox.

`GET /devices/:id/vars` (and the `device.vars` event) gives you the device's
free-form variables — battery, wrist state, app mode, whatever the device app
decided to publish. This is the "unforeseen data" channel: parse whatever keys you
find.

## 3. Listen before you speak: the agent's push channel *(§11)*

Open `GET /events` with your agent token exactly like a device does (SSE, `since=`
cursor, ack). You receive:

| type | when |
|---|---|
| `prompt.selected` | a device answered one of your free-form choices and you asked to resolve it (`resolver: "agent"`) |
| `prompt.confirmed` | a device confirmed an outcome; includes the original `input`, the `outcome` and the `execution` result |
| `prompt.dismissed` / `prompt.expired` | the cycle ended without a confirmation |
| `device.vars` | a device changed its variables (`changed[]` lists keys) |
| `device.message` | a device sent a free-form `POST /messages` |
| `sensor.samples` | *ephemeral*: a batch of samples for one of your sensor requests |
| `job.done` | a long-running action you triggered via confirmation finished |

Persist your cursor; `prompt.*` and `device.*` are durable and will be replayed
if you were down. `sensor.samples` are not — if you need them reliably, poll
`GET /agent/sensors/requests/:id` which keeps the recent ring.

## 4. Raise a prompt *(§12)*

```http
POST /api/v1/agent/prompts
```

```json
{
  "id": "gpu-temp-2026-09-09T07:30",
  "title": "GPU 0 has been at 97 °C for 10 min",
  "priority": "high",
  "targets": ["dev_9f4bf9ba62b1"],
  "ttlSec": 1800,
  "resolver": "server",
  "allowedCommands": ["services.stop"],
  "body": [
    { "type": "text", "text": "vLLM is the only tenant. What should I do?" },
    { "type": "metric", "metric": "gpu.0.temp" },
    { "type": "figure", "alt": "VRAM drains 22 GB → 0", "svg": "<svg …><animate …/></svg>",
      "motion": { "tracks": [ { "type": "ring", "target": "gpu.0.vram.pct", "from": 0.9, "to": 0, "durationMs": 4000, "easing": "ease-out", "color": "ok" } ], "caption": "VRAM ring empties" },
      "sizeHint": { "w": 120, "h": 120 } }
  ],
  "choices": [
    { "id": "stop", "type": "option", "label": "Stop vLLM",
      "outcome": { "summary": "Stop container doca-vllm", "detail": "Frees 22 GB VRAM.", "action": { "commandId": "services.stop", "params": { "id": "vllm" } }, "confirmLabel": "Stop it" } },
    { "id": "wait", "type": "option", "label": "Wait 10 min", "outcome": { "summary": "Re-check in 10 minutes" } },
    { "id": "say",  "type": "voice", "label": "Tell me", "maxSec": 20 },
    { "id": "type", "type": "text",  "label": "Type instead", "maxChars": 280, "placeholder": "e.g. cap power to 250W" },
    { "id": "shoot","type": "image", "label": "Show me" },
    { "id": "no",   "type": "dismiss", "label": "Ignore" }
  ],
  "ext": { "incident": "gpu-temp-001", "runbook": "gpu/thermal" }
}
```

`201 { prompt: { id, delivered: [{ deviceId, seq }], … }, created: true }`.

Design guidance:

- **Give an `id`** derived from the situation (incident id + time bucket). Posting
  again with the same id returns the existing prompt (`200`, `created: false`)
  instead of nagging the user twice. Retrying after a network error is therefore
  safe.
- **Always offer pre-supplied `option`s** for the likely answers — they resolve
  instantly on the device, with no model round-trip, and work on a watch with no
  keyboard. Add free-form choices (`text`, `voice`, `image`) as escape hatches and
  a `dismiss`.
- **Author every representation you can** for a figure: `svg` (with SMIL if animated),
  a `motion` scene, and a good `alt`. The server collapses it to the one thing each
  device can show. Watches without SVG get a sprite sheet or PNG rendered
  server-side; a glasses HUD gets the caption. Keep SMIL inside the supported
  subset (`animate`, `animateTransform`, `set`) or the sprite will be a still.
- **`targets`** omitted = everyone with `interact`. Prefer targeting: the response
  tells you who got it. A device with `profile.prompts.receive: false`, or in quiet
  hours (unless `priority: "urgent"` and `allowUrgent`), is silently skipped.
- **`allowedCommands`** is your own guard rail: any outcome — including ones your
  resolver produces later — may only reference these commands.
- **Budget**: ≤ 8 choices, title ≤ 120 chars, 32 KB excluding figure SVG (SVG itself ≤ 64 KB).
  Typical prompts are 2–4 KB.
- **Priority** maps to haptics and quiet-hours handling on the device; `urgent`
  is the only level that can pierce quiet hours.

Other calls: `GET /agent/prompts?state=open`, `GET /agent/prompts/:id` (with every
device's selection), `DELETE /agent/prompts/:id` (cancel; devices get
`prompt.closed { reason: "cancelled" }`).

## 5. Resolving free-form answers *(§12.5)*

When the user types, speaks, or sends a photo, someone has to turn that into an
**outcome** the device can display and confirm. You choose per prompt with
`resolver`:

### `resolver: "server"` (default) — the platform decides

The server transcribes audio via the configured STT service, then calls the
OpenClaw gateway's chat-completions endpoint with a system instruction asking for
one JSON outcome, attaching images as vision parts. You write no code. The
outcome's `action` is validated against `allowedCommands`. Configure the gateway
as for the dashboard chat (`OPENCLAW_GATEWAY_URL`, `gateway.http.endpoints.chatCompletions.enabled`).

Use this when the prompt is self-contained and you are happy with the default
reasoning. You still get `prompt.confirmed` at the end.

### `resolver: "agent"` — you decide

You receive `prompt.selected`:

```json
{ "promptId": "prm_…", "selectionId": "…", "deviceId": "dev_…", "choiceId": "type",
  "payload": { "kind": "text", "text": "just cap the power to 250W", "ext": { "locale": "en-GB" } }, "resolver": "agent" }
```

For voice, `payload.transcript` is present when the device did its own STT;
otherwise `payload.mediaUrl` points at the audio clip (fetch it with your token —
`media:*` is in the preset). For images, `payload.mediaUrl` (+ `caption`, `w`, `h`).

Reply within 90 s:

```http
POST /api/v1/agent/prompts/:id/outcome
{ "selectionId": "…",
  "outcome": { "summary": "Cap GPU 0 power to 250 W",
               "blocks": [ { "type": "kv", "items": [ { "k": "Before", "v": "350 W" }, { "k": "After", "v": "250 W" } ] } ],
               "action": { "commandId": "services.stop", "params": { "id": "vllm" } },
               "confirmLabel": "Apply" } }
```

`409 stale_selection` means the user went `back`, dismissed, or the prompt closed
while you were thinking — drop it. If you cannot answer, do nothing: the device
times out to `open` with a `resolver_timeout` error and the user can try again.

Outcome authoring:

- `summary` ≤ 200 chars is the headline the user confirms. Make it a sentence a
  watch can show in two lines.
- `detail` ≤ 1000, `blocks[]` (`text`, `kv`, `list`, `metric`, `figure`, `image`, `artifact`)
  for supporting information.
- `action` is optional. If present, confirmation **runs it on the confirming
  device's token**. `capabilities.commands` of the *target* tells you what it may
  run; a device lacking the scope sees `actionAllowed: false` and cannot confirm.
  The registry of commands and their params is `GET /commands` with an admin
  token, or `Command.id` in the OpenAPI document.
- `confirmLabel`/`backLabel` ≤ 24 chars; say what will happen ("Stop it", "Apply").

### After confirmation

`prompt.confirmed`:

```json
{ "promptId": "prm_…", "deviceId": "dev_…", "selectionId": "…", "choiceId": "type",
  "input": { "kind": "text", "text": "just cap the power to 250W" },
  "outcome": { "summary": "…", "action": { … } },
  "execution": { "status": "done", "result": { "ok": true } } }
```

`execution` is `null` (no action), `{ status: "done" | "failed", result | error }`,
or `{ jobId, status: "running" }` — then wait for `job.done { jobId }`. Every other
targeted device receives `prompt.closed { reason: "confirmed_elsewhere" }`.

## 6. Tell, don't ask: alerts and messages *(§13)*

```http
POST /api/v1/agent/alerts
{ "title": "Backup finished", "priority": "normal", "targets": ["dev_…"], "ttlSec": 21600, "haptic": true,
  "body": [ { "type": "text", "text": "4.2 GB in 3 m 12 s" }, { "type": "metric", "metric": "system.storage.pct" } ] }
```

Alerts are durable, one-way, respect quiet hours and `profile.prompts.receive`.

```http
POST /api/v1/agent/messages
{ "type": "hud.line", "payload": { "text": "Deploy 3/5", "ttlSec": 30 }, "targets": ["dev_glasses"] }
```

Messages are the generic channel for anything not modelled: a HUD line, a gesture
vocabulary handshake, a custom widget's data. The device gets `agent.message`;
devices talk back with `POST /messages` → you get `device.message`. Agree on
`type` strings with the device app; payloads are any JSON within 32 KB.

## 7. Borrow a sensor *(§16)*

Nothing on the device is collected until you ask, and you can only ask for what
the device declared **and** the user allowed in the profile.

```http
POST /api/v1/agent/sensors/requests
{ "deviceId": "dev_…", "reason": "HRV check before a risky restart",
  "sensors": [ { "id": "heartRate", "rateHz": 1, "durationSec": 20 },
               { "id": "accelerometer", "rateHz": 10, "durationSec": 5 },
               "location" ] }
```

`201 { request: { id, sensors: [...], expiresAt, status: "active" }, rejected: [ { id: "location", reason: "not_declared" } ] }`

- `403 sensors_rejected` — nothing you asked for is both declared and allowed;
  `rejected[]` says why per sensor (`not_declared`, `not_allowed_by_profile`).
  The fix is on the phone (profile `sensors.allow`), not in your code.
- `409 sensors_unavailable` — the device declared no sensors at all.
- Rates are clamped to the device's `maxRateHz` and 50 Hz; durations to 600 s.
  Ask for the minimum you need; it is the user's battery.
- Always give a human-readable `reason`; device apps show it.

Samples arrive as ephemeral `sensor.samples { deviceId, requestId, samples[] }`
while you are connected, and are kept in a ring you can read with
`GET /agent/sensors/requests/:id?limit=200`. Stop early with
`DELETE /agent/sensors/requests/:id` (device gets `sensor.stop`).

Sample shape: `{ sensor, ts, value }` for scalars, `{ sensor, ts, values: [x, y, z], accuracy }`
for vectors, `{ sensor, ts, ext }` for anything else. Conventional units per
sensor id are in PROTOCOL §7 (`heartRate` bpm, `accelerometer` m/s², `heading` °,
`location` `[lat, lon, alt?]` …).

## 8. Ship code to the device *(§18)*

When the computation belongs on the device — privacy, latency, or simply because
the raw stream is too big to send — hand it an **artifact**:

```http
POST /api/v1/agent/artifacts
{ "name": "rmssd", "runtime": "js", "mime": "text/javascript", "entry": "rmssd",
  "params": { "windowSec": 60 }, "purpose": "HRV from RR intervals, computed on the device",
  "targets": ["dev_…"], "ttlSec": 3600,
  "content": "export function rmssd(rr){let s=0;for(let i=1;i<rr.length;i++){const d=rr[i]-rr[i-1];s+=d*d}return Math.sqrt(s/Math.max(1,rr.length-1))}" }
```

`201 { artifact: { id, sha256, bytes, url, contentUrl, … } }`, then

```http
POST /api/v1/agent/artifacts/:id/deliver
{ "targets": ["dev_…"], "inline": true, "message": "run on each heartRate batch" }
```

`202 { report: [ { deviceId, delivered: true, seq } | { deviceId, delivered: false, reason: "runtime_unsupported", exec: [] } ] }`

- The server stores, hashes and delivers; it never executes. Devices verify
  `sha256` and run the code in a sandbox, so keep artifacts **pure**: input in,
  result out, no network, no globals. Document the contract in `entry`/`params`/`purpose`.
- Delivery is gated on the device's `caps.exec`. Check `GET /agent/devices` first
  and offer a server-side fallback when the runtime is missing.
- ≤ 256 KB; `contentBase64` for binary (wasm).
- Results come back however you agreed: `device.message` (e.g. `type: "rmssd.result"`)
  or `device.vars`.
- Artifacts can also ride inside a prompt/alert body as an `artifact` block; on
  devices without the runtime the block degrades to its `alt` text.

Together with §7 this is the "collect sensor data, compute on the device with code
the agent just wrote, act on the result" loop: request `heartRate` → deliver
`rmssd.js` → device reports `{ type: "rmssd.result", payload: { ms: 42 } }` → you
raise a prompt with the finding.

## 9. Reading platform state and media

With `read:*` you can use everything a device can: `GET /surfaces`, `GET /snapshot`,
`GET /surfaces/:id?spark=1`, `GET /render/chart?…` (to embed a PNG in a message
for a device that cannot render), `GET /media/:id` for uploads devices sent you.
Snapshots go through the same shared sampler, so poll as often as you like
within reason; the sampler stops itself after 60 s without demand.

## 10. Recipes

**Escalation ladder.** Alert first (`priority: normal`). If the condition persists,
a prompt with `resolver: "server"` and two options. If it worsens, `priority: "urgent"`
targeting every device — urgent is the only level that pierces quiet hours.

**Ask once, everywhere.** Omit `targets`; the first device to confirm wins and the
rest get `prompt.closed`. Use one prompt `id` per incident so retries do not fan
out twice.

**Photo triage.** Include an `image` choice; phones and glasses will show it,
watches will not. On `prompt.selected` with `payload.kind: "image"`, fetch
`payload.mediaUrl`, run your vision model, answer with an outcome whose `blocks`
include a `kv` of findings.

**Hands-free confirmation.** For a voice-only device (no `screen`), keep
`outcome.summary` short and spoken-friendly and set `confirmLabel` to a word the
device app can match ("Confirm"). The device app owns speech; you own the words.

**Long-running actions.** If an outcome's `action` is `longRunning` (`services.start`,
`snapshots.create`, `llamacpp.start|restart`), `prompt.confirmed.execution` is
`{ jobId, status: "running" }`; follow `job.done` and send an `alert` with the result.

## 11. Errors you will meet *(§5)*

| Status / `code` | Meaning |
|---|---|
| `400 invalid_prompt` / `invalid_choice` / `invalid_outcome` | schema problem; `message` names the field (e.g. an `option` without `outcome`, duplicate choice ids, action not in `allowedCommands`) |
| `403 scope_required` | your token is not an `agent` token |
| `404 not_found` | prompt/device/request gone (expired or revoked) |
| `409 stale_selection` | the selection is no longer pending; drop your outcome |
| `403 forbidden` | cancelling a prompt another agent raised (only the owner, or a `*` token, may) — cancelling an already-closed prompt is a harmless `200` |
| `413 payload_too_large` | prompt over 32 KB (excluding SVG) or message over the event budget |
| `403 sensors_rejected` / `409 sensors_unavailable` | see §7 |

## 12. Checklist

1. `agent` token; open `/events`; persist the cursor.
2. `GET /agent/devices` to learn caps, consent and presence.
3. Prompts with stable `id`s, pre-supplied options, escape hatches, `allowedCommands`, every figure representation you can author.
4. Handle `prompt.selected` (if `resolver: "agent"`), `prompt.confirmed`, `prompt.closed`/`dismissed`/`expired`.
5. Alerts for one-way news; messages for everything unmodelled; read `device.vars`.
6. Sensors with a `reason`, minimal rate/duration; artifacts only for declared runtimes, pure and hashed.
7. Run `clients/reference/agent-sim.js` against a dev server to see all of it in one file.
