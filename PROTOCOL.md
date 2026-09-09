# Doca Client Protocol — `/api/v1`

Protocol version **1.0**. This document is the contract between the Doca platform
and any thin client: a smartwatch, a phone companion app, smart glasses, a car
display, a kiosk, a headless script, or the agent itself. It is complete: a
developer who has never seen the codebase can implement a client from this file.

Related: `docs/api/README.md` (developer guides: getting started, device app
guide, agent guide, cookbook), `docs/api/openapi.json` (OpenAPI 3.1, also served
at `GET /api/v1/openapi.json`), `docs/proposals/client-api-phase1.md` (design
rationale), `clients/reference/` (working bash + Node clients), `test/*.test.js`
(executable specification).

---

## 1. Principles

- **Dumb clients.** The server decides *what exists*, *what it means* and *what is
  allowed*. The client decides *how to draw it*. Nothing about layout, colour or
  typography crosses the wire — only typed data, thresholds, and an opaque
  `display` string for clients that cannot format.
- **Device-agnostic until the device says otherwise.** A device declares its own
  capabilities (`caps`) at pairing time; every section is optional. A display-less
  camera, a round watch, a phone and a headless agent speak the same protocol.
- **Everything goes through this layer.** Any access a device needs — data,
  commands, dialogue with the agent, sensors, uploads, receiving code to run — is
  exposed here. What the device *does* with it is the device app's business.
- **Budgeted payloads.** Every message class has a documented ceiling that the
  server enforces and advertises (§20).
- **Least authority.** Each device holds its own scoped token. Losing a watch
  should not mean losing the host.
- **Unforeseen data is welcome.** Every message carries an optional opaque `ext`
  object, and every device has a free-form `vars` document. The server stores and
  forwards these untouched; the agent parses them directly.

## 2. Base URL and reachability

```
https://<host>:4242/api/v1
```

- `<host>` is the machine's Tailscale name or IP (the dashboard is only
  reachable inside the tailnet — this layer adds **no public ingress**).
- TLS: the server presents a Tailscale-issued certificate when
  `tailscale cert` succeeds, otherwise a self-signed one (pin it, or accept it
  on first pairing). Plain HTTP is only used when certificate generation fails.
- `GET /api/v1/` and `GET /api/v1/openapi.json` are the only unauthenticated
  reads; the first returns the protocol version and the pairing/capabilities
  URLs, the second the machine-readable description of this document.
- Requests and responses are JSON (`Content-Type: application/json`) unless a
  section says multipart (uploads) or binary (images, media, artifacts).
- Send `X-Doca-Client: <name>/<version>` on every request. It is logged
  with the device and helps support.

## 3. Versioning

| Where | Meaning |
|---|---|
| `X-Doca-Protocol: 1.0` response header | Protocol version the server speaks. |
| `GET /capabilities` → `protocol.version`, `protocol.minClient` | Current version and the oldest client version still served. |
| `caps.protocol.max` (sent by the device) | Highest version the client understands. The server never sends a construct newer than this. |
| Event envelope `v` | Envelope schema version (currently `1`). |
| `capabilities.deprecations[]` | Machine-readable list of fields/endpoints scheduled for removal, with a `until` date. |

Rules: additive changes (new fields, new event types, new metric kinds, new block
types, new choice types) are **minor** and do not bump the major. Clients **must
ignore unknown fields, unknown event types, unknown block types and unknown
choice types**. A **major** bump changes the base path (`/api/v2`) and both
versions run side by side for the deprecation window.

## 4. Authentication and authorisation

### 4.1 Tokens

```
Authorization: Bearer doca_<deviceId>.<secret>
```

- Opaque, random, per device. Only `SHA-256(secret)` is stored server-side.
- The plaintext is returned **once** (pairing completion, CLI issue, rotation).
- `GET /events` alone also accepts `?access_token=…` because browser
  `EventSource` cannot set headers.
- Failure codes: `401 unauthenticated` (no token), `401 invalid_token` (unknown,
  expired, revoked).

### 4.2 Getting a token

**Pairing (normal path).** An admin device (phone, or the CLI) starts a pairing;
the new device completes it with a six-digit code.

```http
POST /api/v1/devices/pair/start           (scope devices:admin)
{ "name": "my-watch", "preset": "watch" }               // or "scopes": [...]

201 { "code": "641-598", "expiresAt": "…", "scopes": [...], "name": "my-watch",
      "completeUrl": "/api/v1/devices/pair/complete",
      "qr": "doca://pair?code=641598&host=doca.tailnet.ts.net:4242" }
```

```http
POST /api/v1/devices/pair/complete        (no auth)
{ "code": "641-598", "name": "my-watch", "caps": { …see §7… } }

201 { "token": "doca_dev_9f4b….QTM8…", "device": { … }, "capabilitiesUrl": "/api/v1/capabilities", "protocol": "1.0" }
```

Codes live 5 minutes and are single use.

**Direct issue.** `POST /devices` (scope `devices:admin`) with
`{ name, preset | scopes, caps?, expiresAt?, kind? }` returns `{ token, device }`.
On the host: `npm run token -- issue --name phone --preset phone`.

**Rotation.** `POST /devices/me/rotate` returns a new token; the old one stays
valid for 60 s (`previousValidUntil`) so a client can swap atomically.

**Revocation.** `DELETE /devices/:id` (scope `devices:admin`). The device's
live streams receive a durable `revoked` event followed by an SSE `close`
frame, its outbox and profile are deleted, and its token fails with
`invalid_token` from then on. A device cannot revoke itself.

### 4.3 Scopes

A scope is `family:target`; `target` may be `*` or a dotted prefix ending in
`.*`. The bare scope `*` is everything.

| Family | Targets | Grants |
|---|---|---|
| `read` | surface id, `system.*`, `*` | snapshots and `surface.update` pushes for those surfaces; chart rendering of their metrics |
| `command` | command id, `*` | `POST /commands/:id`; confirming a prompt outcome whose action is that command |
| `interact` | — | receive prompts/alerts, select, confirm/back, `POST /messages` |
| `profile` | `self`, `*` | write own profile / any profile (reading own is always allowed) |
| `vars` | `self`, `*` | write own variables / read+write any |
| `sensors` | `report`, `*` | post own samples / read any device's samples |
| `media` | `upload`, `*` | upload media / read anyone's media |
| `artifacts` | `self`, `*` | fetch artifacts addressed to me / any artifact |
| `devices` | `admin` | list/create/pair/patch/revoke devices |
| `agent` | — | the `/agent/*` API (raise prompts and alerts, request sensors, deliver outcomes and artifacts, read devices/vars/sensors/media) |

Matching: `read:*` ⊇ `read:gpu.0`; `read:system.*` ⊇ `read:system.cpu`;
`command:compose.restart` does **not** grant `command:compose.stop`.

Presets (returned by `GET /devices` and used by the CLI):

| Preset | Scopes |
|---|---|
| `admin` | `*` |
| `agent` | `agent read:* artifacts:* media:* sensors:* vars:* profile:*` |
| `watch` | `read:* interact profile:self vars:self sensors:report media:upload artifacts:self` |
| `phone` | `read:* command:* interact profile:* vars:self sensors:report media:upload artifacts:self devices:admin` |
| `viewer` | `read:*` |

A device may `PATCH /devices/me` its own `name` and `caps`, never its scopes.

## 5. Errors

Every error has the same shape and a stable `code`:

```json
{ "error": { "code": "scope_required", "message": "Requires command:compose.restart", "required": ["command:compose.restart"] } }
```

| HTTP | code | When |
|---|---|---|
| 400 | `bad_json`, `invalid_request`, `invalid_params`, `invalid_prompt`, `invalid_choice`, `invalid_outcome`, `invalid_selection`, `invalid_confirmation`, `invalid_profile`, `ext_too_large`, `invalid_pairing`, `invalid_artifact`, `invalid_alert`, `invalid_device` | malformed input; `message` says which field |
| 401 | `unauthenticated`, `invalid_token` | see §4.1 |
| 403 | `scope_required` (+ `required[]`), `forbidden`, `choice_not_available`, `sensors_rejected` | authorised identity, insufficient rights |
| 404 | `not_found`, `unknown_command`, `unknown_request`, `no_recipient` | |
| 409 | `invalid_state`, `stale_selection`, `prompt_closed`, `selection_conflict`, `sensors_unavailable` | state machine refused; body includes current `state`/`selectionId` |
| 412 | `etag_mismatch` (+ `currentEtag`, `currentVersion`) | optimistic concurrency on profiles |
| 413 | `payload_too_large`, `vars_too_large`, `image_too_large` | over a §20 budget |
| 415 | `unsupported_media` | mime not in `capabilities.media.accept` |
| 500 | `command_failed`, `internal` | the underlying action failed; `message` carries stderr/summary |

## 6. Capability discovery

`GET /api/v1/capabilities` is the first call after authentication and after
every `profile.changed`/`resync`. It is **already filtered by the token's
scopes and shaped by the device's `caps`**: a client can build its entire UI
from it and never hard-codes an id.

```json
{
  "protocol": {
    "version": "1.0", "minClient": "1.0", "clientMax": "1.0", "motionVocabulary": "1",
    "blockTypes": ["text","metric","figure","image","media","artifact","list","kv"],
    "choiceTypes": ["option","voice","text","image","dismiss"],
    "priorities": ["low","normal","high","urgent"],
    "eventTypes": [{ "type": "prompt.new", "class": "durable" }, { "type": "surface.update", "class": "ephemeral" }, …],
    "metricKinds": ["gauge","counter","rate","duration","timestamp","text","enum","boolean","bytes","vector"],
    "units": ["%","°C","B","B/s","s","MHz","W","count",""],
    "itemStates": ["running","stopped","paused","error","starting","unknown"],
    "easings": ["linear","ease-in","ease-out","ease-in-out","spring"],
    "colorRoles": ["ok","warn","crit","accent","muted"]
  },
  "server": { "name": "doca", "version": "2.6.0", "time": "2026-09-09T07:33:07.552Z" },
  "device": { "id": "dev_9f4bf9ba62b1", "name": "my-watch", "kind": "device", "scopes": [...], "caps": { … }, "vars": {}, "varsVersion": 0, "createdAt": "…", "lastSeenAt": "…", "expiresAt": null, "revokedAt": null },
  "scopes": { "granted": ["read:*","interact",…], "families": { "read": "Read snapshots…", … } },
  "surfaces": [ { "id": "system.cpu", "title": "CPU", "kind": "metrics", "group": "system", "refreshHintSec": 5,
                  "metrics": [ { "id": "system.cpu.pct", "label": "CPU", "kind": "gauge", "unit": "%", "min": 0, "max": 100,
                                 "thresholds": [{ "level": "warn", "gte": 70 }, { "level": "crit", "gte": 90 }] }, … ],
                  "itemMetrics": [], "commands": [], "itemCommands": [] }, … ],
  "commands": [ { "id": "services.stop", "title": "Stop inference service", "scope": "command:services.stop",
                  "params": { "id": { "type": "string", "required": true, "enum": ["whisper","kokoro","vllm","sd-webui","comfyui"] } },
                  "confirm": true, "longRunning": false }, … ],
  "push": { "url": "/api/v1/events", "ackUrl": "/api/v1/events/ack", "heartbeatSec": 25,
            "retainedEvents": 500, "retainedHours": 24, "cursor": 17, "pending": 1,
            "backoff": { "initialMs": 1000, "maxMs": 60000, "factor": 2, "jitter": 0.2 } },
  "render": { "formats": ["png"], "maxImageBytes": 204800, "themes": ["dark","light"], "text": true,
              "chartUrl": "/api/v1/render/chart", "figureUrl": "/api/v1/render/figure/{figureId}",
              "defaults": { "w": 450, "h": 450, "round": true } },
  "limits": { "snapshotBytes": 16384, "promptBytes": 32768, "eventBytes": 32768, "imageBytes": 204800,
              "mediaBytes": 1572864, "audioBytes": 1048576, "audioSec": 30, "artifactBytes": 262144,
              "extBytes": 8192, "varsBytes": 16384, "sparkMaxPoints": 60, "minRefreshSec": 2,
              "sensorMaxRateHz": 50, "sensorMaxDurationSec": 600, "sensorBatchMax": 500 },
  "profile":   { "version": 1, "etag": "\"v1\"", "url": "/api/v1/devices/me/profile", "warnings": [] },
  "vars":      { "version": 0, "url": "/api/v1/devices/me/vars" },
  "sensors":   { "declared": [ { "id": "heartRate", "unit": null, "maxRateHz": null }, … ], "allowed": ["heartRate"], "autoReport": ["battery"], "reportUrl": "/api/v1/sensors/samples" },
  "media":     { "uploadUrl": "/api/v1/media", "accept": ["image/jpeg","image/png","image/webp","audio/ogg",…] },
  "artifacts": { "url": "/api/v1/artifacts/{artifactId}", "runtimes": ["js"] },
  "prompts":   { "url": "/api/v1/prompts", "open": 0, "receive": true },
  "messages":  { "url": "/api/v1/messages" },
  "deprecations": []
}
```

Notes:
- `surfaces[]` only lists surfaces that exist on this host **and** that the token can read. `gpu.N` surfaces appear only when a GPU is detected.
- `commands[]` only lists commands the token may run. A watch with the `watch` preset gets `[]`.
- `push.cursor`/`push.pending` let a client decide whether to open the stream immediately.
- `render.defaults` derives from `caps.screen` (capped at 480 px) — request images without `w`/`h` and they fit the screen.
- `profile.version` is included so an offline-edited profile is never missed.

## 7. Device capabilities (`caps`)

Sent at pairing and updatable via `PATCH /devices/me { caps }`. Every section is
optional; the server normalises and fills defaults. **Nothing here is a
platform identifier** — it describes abilities, not brands.

```json
{
  "formFactor": "watch",                  // watch | phone | glasses | tablet | browser | headless | other
  "protocol":   { "max": "1.0" },
  "screen":     { "w": 450, "h": 450, "shape": "round", "dpr": 2, "color": true },   // omit if no display
  "input":      { "touch": true, "voice": true, "text": false, "camera": false, "buttons": true, "gaze": false, "crown": true, "gesture": false },
  "audio":      { "mic": true, "speaker": false, "haptic": true },
  "render":     ["image", "sprite", "text"],          // svg | svg.smil | sprite | image | image.inline | text (text always present)
  "motion":     ["1"],                                // motion vocabularies understood
  "exec":       ["js"],                               // runtimes the device can execute artifacts in (open vocabulary: js, wasm, lua, …)
  "sensors":    ["heartRate", { "id": "accelerometer", "maxRateHz": 50, "unit": "m/s²" }, "battery", "heading"],
  "ext":        { "os": "wearos", "model": "…" }      // anything else, ≤ 8 KB
}
```

How `caps` change what the server sends:

| Capability | Effect |
|---|---|
| `screen` absent | `render.defaults` fall back to 320×160; figures prefer `text`; prompts still delivered (voice/haptic device) |
| `input.camera` | `image` choices are offered; otherwise they are filtered out of prompts |
| `audio.mic` or `input.voice` | `voice` choices offered |
| `input.text`/`touch`/`voice` | `text` choices offered |
| `render` | figure representation selection (§19.4); `format=svg` on render endpoints honoured only with `svg` |
| `motion` | motion scenes sent only if the vocabulary is listed |
| `exec` | artifacts delivered only for listed runtimes; `artifact` blocks degrade to text otherwise |
| `sensors` | only declared sensors can be requested or reported; `maxRateHz` caps request rates |

**Sensor vocabulary** (open — any string is accepted; these are the conventional
ids so agents can reason about them): `accelerometer` (m/s², `values:[x,y,z]`),
`gyroscope` (rad/s, xyz), `magnetometer` (µT, xyz), `heading` (° true north),
`orientation` (`values:[yaw,pitch,roll]`), `location` (`values:[lat,lon,alt?]`,
`accuracy` m), `barometer` (hPa), `ambientLight` (lux), `proximity` (0/1 or cm),
`heartRate` (bpm), `heartRateVariability` (ms), `spo2` (%), `skinTemperature` (°C),
`steps` (count), `battery` (%), `temperature` (°C), `noiseLevel` (dB),
`wristState` (0/1), `gaze` (`values:[x,y]`).

## 8. Data model

### 8.1 Surfaces

A **surface** is a named, independently scoped group of metrics and/or items
with the commands that apply to it. Ids are stable and dotted:
`system.cpu`, `system.memory`, `system.storage`, `system.network`,
`system.host`, `gpu.<n>`, `docker.containers`, `services.inference`,
`models.ollama`, `models.llamacpp`, `agent.prompts`.

`kind` is `metrics` (scalar values) or `list` (items, each with its own
metrics/commands). `refreshHintSec` is how often the value is worth refreshing.

### 8.2 Metrics

```json
{ "id": "system.cpu.temp", "label": "Temp", "kind": "gauge", "unit": "°C",
  "value": 71, "display": "71°C", "min": 0, "max": 110,
  "thresholds": [{ "level": "warn", "gte": 80 }, { "level": "crit", "gte": 90 }],
  "observedAt": "2026-09-09T07:33:07.552Z", "ttlSec": 15, "stale": false,
  "spark": [64, 66, 69, 71] }
```

| Field | Meaning |
|---|---|
| `kind` | `gauge` (bounded number), `counter` (monotonic count), `rate` (per second), `duration` (seconds), `timestamp` (ISO string), `text`, `enum` (+`values[]`), `boolean`, `bytes`, `vector` (array of numbers, e.g. per-core %) |
| `unit` | closed enum: `%`, `°C`, `B`, `B/s`, `s`, `MHz`, `W`, `count`, `` |
| `value` | typed; `null` when the collector had nothing (sensor missing) — render `display` |
| `display` | server-formatted string, always present (`"15.3 GB"`, `"2d 4h"`, `"—"`) |
| `min`/`max` | for gauges/rings; `max` may be dynamic (GPU power limit) |
| `thresholds` | ordered `{ level, gte }`; the client maps `level` (`warn`,`crit`) to its own colours. Absence means "no server opinion" |
| `observedAt` / `ttlSec` / `stale` | when the sample was taken; after `observedAt + ttlSec` the client should grey the value; `stale:true` means the collector failed and this is the last known value |
| `spark` | last ≤60 samples (opt-in via `?spark=1` or profile `spark:true`), only for gauge/rate/bytes with ≥2 points |

### 8.3 Items

```json
{ "id": "a1b2c3", "label": "doca-vllm", "state": "running", "detail": "Up 3 hours",
  "metrics": [ … ], "commands": [ { "id": "docker.container.stop", "params": { "id": "a1b2c3" } } ] }
```

`state` is one of `itemStates`. `commands[]` are ready-to-post invocations; the
client still needs the matching `command:` scope (check `capabilities.commands`).
Lists are truncated at 40 items with `truncated: <total>` on the surface.

### 8.4 Commands

Each command has an id, a params schema, `confirm` (should the client ask before
posting), and `longRunning` (returns a job). Current registry:

`compose.start|stop|restart`, `docker.container.start|stop|restart {id}`,
`services.start {id, gpu?, modelId?}` (job), `services.stop {id}`,
`llamacpp.start|stop|restart {id}` (start/restart are jobs), `skills.toggle {name}`,
`snapshots.create {label?}` (job), `panel.restart`.

## 9. Snapshots

```http
GET /api/v1/surfaces                          → { surfaces: [definitions…], observedAt }
GET /api/v1/surfaces/:id?spark=1              → { surface, observedAt, stale }
GET /api/v1/snapshot?surfaces=a,b&spark=1&sparkPoints=30
                                              → { surfaces: [ {id,title,kind,observedAt,ttlSec,stale,metrics[],items?} ], observedAt, stale }
```

- Omitting `surfaces=` returns everything the token can read (mind the budget).
- Responses carry an `ETag`; send `If-None-Match` to get `304`.
- All snapshot calls share **one server-side sampler**: N clients cost one
  collection per tick. The sampler runs only while there is demand and stops
  after 60 s of silence, so polling clients pay nothing when idle.
- Budget: 16 KB per requested surface; a `413 payload_too_large` asks you to
  request fewer surfaces or disable `spark`.

## 10. Commands and jobs

```http
POST /api/v1/commands/services.stop
{ "params": { "id": "vllm" }, "idempotencyKey": "7d1f…" }

200 { "status": "done", "commandId": "services.stop", "result": { "ok": true } }
202 { "status": "running", "jobId": "job_3a…", "commandId": "services.start", "jobUrl": "/api/v1/jobs/job_3a…" }
500 { "error": { "code": "command_failed", "message": "docker: not found", "commandId": "services.stop" } }
```

- `idempotencyKey` (client UUID): a retry with the same key returns the original
  response with `replay: true` (kept in memory for the server's lifetime).
- Params are validated against the schema (type, enum, max length, no shell
  metacharacters) → `400 invalid_params { param }`.
- Long-running commands return a **job**. Progress arrives as ephemeral
  `job.progress { jobId, commandId, text }` events; completion as a durable
  `job.done { jobId, commandId, status: done|failed, error?, result?, outputTail[] }`.
  `GET /jobs/:id` returns `{ job: { id, commandId, status, startedAt, endedAt, result, error, outputTail } }`
  for clients without a stream.

## 11. Push channel

### 11.1 Transport

```http
GET /api/v1/events?since=<seq>          Accept: text/event-stream     → SSE stream
GET /api/v1/events?since=<seq>          Accept: application/json      → { events[], nextSince, resync, retryAfterSec }
POST /api/v1/events/ack                 { "seq": 17 }                 → { acked, pending, cursor }
```

Server-Sent Events over the same HTTPS connection: one socket, native reconnect
(`Last-Event-ID` is honoured as `since`), no separate WebSocket upgrade. Clients
that cannot hold a socket (battery-saver mode, iOS background) use the JSON poll
form with identical semantics.

SSE framing:

```
retry: 3000

event: hello
data: {"deviceId":"dev_…","cursor":17,"since":16,"replay":1,"resync":false,"heartbeatSec":25,"protocol":"1.0"}

id: 18
event: prompt.new
data: {"seq":18,"id":"evt_…","ts":"…","type":"prompt.new","class":"durable","ttlSec":3600,"priority":"high","ack":true,"v":1,"payload":{…}}

: ping 1757400000000

event: close
data: {"reason":"revoked"}
```

- A comment line `: ping` every `heartbeatSec` (25 s). If nothing arrives for
  2× that, reconnect.
- Reconnect with exponential backoff from `push.backoff` and `since=<last seq
  you processed>`.

### 11.2 Envelope

| Field | Meaning |
|---|---|
| `seq` | per-device monotonic integer; your cursor |
| `id` | globally unique event id |
| `ts` | server time |
| `type` | see catalogue below |
| `class` | `durable` or `ephemeral` |
| `ttlSec` | durable only: after this the server stops retaining it |
| `priority` | `low`/`normal`/`high`/`urgent` — a hint for haptics and quiet-hours handling |
| `ack` | `true` for durable events (acknowledge them) |
| `v` | envelope schema version |
| `payload` | type-specific |

### 11.3 Delivery guarantees

- **Ephemeral** (`surface.update`, `job.progress`, `prompt.progress`,
  `sensor.samples`, `resync`): at-most-once; dropped when the device has no live
  stream. Never rely on them for state — refetch on connect.
- **Durable** (everything else): at-least-once until acknowledged. Retained per
  device for up to 500 events / 24 h / the event's `ttlSec`, whichever is first.
  Acknowledge **implicitly** by connecting with `since=<seq>` (everything ≤ seq
  is released) or **explicitly** with `POST /events/ack`.
- **Resync.** If `since` predates retained history the server sends an
  ephemeral `resync { reason, cursor }` (and `resync: true` on the poll). Treat it
  as "my picture may be stale": call `/capabilities`, `/prompts`, `/snapshot`,
  then continue from `cursor`.
- Ordering is per device by `seq`. Ephemeral events consume seq numbers too, so
  gaps in a replay are normal.

### 11.4 Event catalogue

| type | class | payload |
|---|---|---|
| `surface.update` | ephemeral | `{ surface }` — one surface in §9 shape, at the profile's `refreshSec` |
| `job.progress` | ephemeral | `{ jobId, commandId, text }` |
| `job.done` | durable | `{ jobId, commandId, status, error, result, outputTail[] }` |
| `prompt.new` | durable, high | `{ prompt }` — device-tailored view (§12.3) |
| `prompt.progress` | ephemeral | `{ promptId, selectionId, stage: transcribing|thinking }` |
| `prompt.outcome` | durable, high | `{ promptId, selectionId, status: outcome_ready, outcome }` or `{ …, status: failed, error: { code, message } }` |
| `prompt.closed` | durable | `{ promptId, reason: confirmed_elsewhere|cancelled|expired }` |
| `alert` | durable, high | `{ id, title, body[], priority, haptic, from, ext }` |
| `profile.changed` | durable | `{ version, etag, updatedBy, url }` — refetch the profile |
| `agent.message` | durable | `{ from, type, payload, ext }` — free-form from the agent |
| `artifact.deliver` | durable | `{ artifact, inline?, inlineEncoding?: utf8|base64, message, ext }` |
| `sensor.request` | durable (ttl = duration + 30 s) | `{ request: { id, sensors: [{ id, mode, rateHz, durationSec, unit }], reason, ext, expiresAt } }` |
| `sensor.stop` | durable | `{ requestId, reason }` |
| `revoked` | durable | `{ reason, by }` — then the stream closes; forget the token |
| `resync` | ephemeral | `{ reason, cursor }` |
| **Agent-side** | | |
| `prompt.selected` | durable | `{ promptId, selectionId, deviceId, choiceId, payload: { kind, text?, transcript?, caption?, mediaId?, mediaUrl?, ext? }, resolver }` |
| `prompt.confirmed` | durable | `{ promptId, deviceId, selectionId, choiceId, input, outcome, execution }` |
| `prompt.dismissed` / `prompt.expired` | durable | `{ promptId, deviceId?, selectionId? }` |
| `device.vars` | durable | `{ deviceId, vars, version, updatedAt, changed[] }` |
| `device.message` | durable | `{ from, type, payload, ext }` |
| `sensor.samples` | ephemeral | `{ deviceId, requestId, samples[] }` |

## 12. Prompts — the interaction protocol

A prompt is the agent asking the user something. The cycle is
**prompt → selection → outcome → confirmation**, and it works identically for a
tap on a watch, a sentence spoken to glasses, a paragraph typed on a phone, or
a photo.

### 12.1 Lifecycle and state machine

Prompt states: `open → confirmed | cancelled | expired`. First confirmation from
any device wins; the others receive `prompt.closed { reason: confirmed_elsewhere }`.

Per-device states (what a client renders):

```
open ──select option──▶ outcome_ready ──confirm──▶ confirmed
open ──select voice/text/image──▶ pending ──(outcome)──▶ outcome_ready
                                  pending ──(failed)───▶ open  (+error)
outcome_ready ──back──▶ open              pending ──back──▶ open
open ──select dismiss──▶ dismissed        any ──▶ closed   (confirmed elsewhere / cancelled / expired)
```

### 12.2 Agent raises a prompt

```http
POST /api/v1/agent/prompts                       (scope agent)
{
  "id": "gpu-temp-001",                            // optional; same id → returns the existing prompt (idempotent)
  "title": "GPU 0 at 97 °C for 10 min",           // ≤120 chars
  "priority": "high",                              // low | normal | high | urgent (urgent bypasses quiet hours if allowed)
  "targets": ["dev_9f4bf9ba62b1"],                 // omit → every device with `interact`
  "ttlSec": 3600,                                  // 30 s … 7 d, default 1 h
  "resolver": "agent",                             // "server" (default: gateway decides) | "agent" (you decide via prompt.selected)
  "allowedCommands": ["services.stop"],            // optional allow-list for outcome actions
  "body": [ …blocks (§19.1)… ],
  "choices": [
    { "id": "stop", "type": "option", "label": "Stop vLLM",
      "outcome": { "summary": "Stop container doca-vllm", "detail": "Frees 22 GB VRAM.",
                   "action": { "commandId": "services.stop", "params": { "id": "vllm" } }, "confirmLabel": "Stop it" } },
    { "id": "wait", "type": "option", "label": "Wait 10 min", "outcome": { "summary": "Re-check in 10 minutes" } },
    { "id": "say",  "type": "voice", "label": "Tell me", "maxSec": 20 },
    { "id": "type", "type": "text",  "label": "Type instead", "maxChars": 280, "placeholder": "e.g. cap power to 250W" },
    { "id": "shoot","type": "image", "label": "Show me" },
    { "id": "no",   "type": "dismiss", "label": "Ignore" }
  ],
  "ext": { "incident": "gpu-temp-001" }
}
201 { "prompt": { …stored prompt…, "delivered": [{ "deviceId": "dev_…", "seq": 6 }] }, "created": true }
```

Choice types: `option` (pre-supplied outcome — instant), `voice` (audio clip or
device transcript), `text`, `image` (camera/gallery), `dismiss`. ≤8 choices,
unique ids. `option` **requires** an `outcome`.

Outcome shape (also what resolvers return):
`{ summary ≤200, detail ≤1000, blocks[], action?: { commandId, params }, confirmLabel ≤24, backLabel ≤24, ext }`.

Other agent calls: `GET /agent/prompts[?state=]`, `GET /agent/prompts/:id`,
`DELETE /agent/prompts/:id` (cancel), `POST /agent/prompts/:id/outcome`.

### 12.3 Device receives the prompt

Over push (`prompt.new`) or `GET /prompts` / `GET /prompts/:id`. The view is
**tailored**: choices the device cannot perform are removed (no camera → no
`image`), figure blocks are collapsed to one representation, `outcome.actionAllowed`
tells the client whether its own token could confirm that action.

```json
{ "id": "prm_1f50…", "createdAt": "…", "expiresAt": "…", "priority": "high",
  "title": "GPU 0 at 97 °C for 10 min",
  "body": [ { "type": "text", "text": "vLLM is the only tenant. What should I do?", "style": "body" },
            { "type": "metric", "metric": "gpu.0.temp" },
            { "type": "figure", "id": "fig_…", "alt": "VRAM drains 22 GB → 0", "representation": { "kind": "motion", "scene": { … } } } ],
  "choices": [ { "id": "stop", "type": "option", "label": "Stop vLLM", "outcome": { "summary": "Stop container doca-vllm", "actionAllowed": false, … } },
               { "id": "say", "type": "voice", "label": "Tell me", "maxSec": 20, "accept": ["audio/ogg", …] },
               { "id": "type", "type": "text", "label": "Type instead", "maxChars": 280 },
               { "id": "no", "type": "dismiss", "label": "Ignore" } ],
  "resolver": "agent", "state": "open", "selectionId": null, "choiceId": null, "stage": null, "outcome": null, "error": null,
  "haptic": true, "ext": { "incident": "gpu-temp-001" } }
```

### 12.4 Select

```http
POST /api/v1/prompts/:id/select                  (scope interact)
{ "selectionId": "<client UUID>", "choiceId": "wait" }
200 { "status": "outcome_ready", "promptId", "selectionId", "outcome": { "summary": "Re-check in 10 minutes", … } }
```

- `selectionId` is generated by the client and keys the whole cycle. A retry
  returns the original response with `replay: true`. Using it from another
  device → `409 selection_conflict`.
- Selecting while not `open` → `409 invalid_state { state, selectionId }` (go
  `back` first).
- `dismiss` → `200 { status: "dismissed" }`; the agent gets `prompt.dismissed`.

Free-form choices return **202** and resolve asynchronously:

```http
POST /prompts/:id/select
{ "selectionId": "…", "choiceId": "type", "payload": { "kind": "text", "text": "just cap the power to 250W", "ext": { "locale": "en-GB" } } }
202 { "status": "pending", "promptId", "selectionId", "stage": "thinking", "expectedWithinSec": 8, "pollUrl": "/api/v1/prompts/prm_…" }
```

Voice — multipart (`audio` or `file` part) **or** a device-side transcript:

```http
POST /prompts/:id/select     Content-Type: multipart/form-data
selectionId=…  choiceId=say  payload={"kind":"voice","durationMs":3200}  audio=@clip.ogg;type=audio/ogg
202 { "status": "pending", "stage": "transcribing", … }

POST /prompts/:id/select     (JSON, watch did its own STT)
{ "selectionId": "…", "choiceId": "say", "payload": { "kind": "voice", "transcript": "wait for now" } }
202 { "status": "pending", "stage": "thinking", … }
```

Image — multipart `image` part (jpeg/png/webp ≤ 1.5 MB) or a previously
uploaded `payload.mediaId` (§17), with optional `payload.caption`:

```http
POST /prompts/:id/select     multipart
selectionId=…  choiceId=shoot  payload={"kind":"image","caption":"the fan is not spinning","w":1920,"h":1080}  image=@photo.jpg;type=image/jpeg
202 { "status": "pending", "stage": "thinking", … }
```

While pending the device gets ephemeral `prompt.progress { stage }` and then a
durable `prompt.outcome`. If the stream is down, poll `GET /prompts/:id` —
`state` flips to `outcome_ready` and `outcome` is filled. On failure
(`resolver_unavailable`, `resolver_failed`, `resolver_bad_reply`,
`resolver_timeout` after 90 s, STT errors) the device state returns to `open`
with `error` set and a `prompt.outcome { status: "failed", error }` event.

### 12.5 How free-form input is resolved

`resolver: "server"` (default): the server transcribes audio through the
configured STT service (`/api/chat/transcribe` backend), then calls the OpenClaw
gateway's OpenAI-compatible chat-completions endpoint (same config as the
dashboard chat: `gateway.http.endpoints.chatCompletions.enabled` in
`openclaw.json`, `OPENCLAW_GATEWAY_URL`) with a system instruction asking for
the outcome JSON. Images are attached as an `image_url` data-URL content part
(vision). No agent-side code is needed.

`resolver: "agent"`: the server pushes `prompt.selected` to the agent device
(the token that created the prompt). The agent answers:

```http
POST /api/v1/agent/prompts/:id/outcome
{ "selectionId": "…", "outcome": { "summary": "Cap GPU 0 power to 250 W", "blocks": [ { "type": "kv", "items": [ { "k": "Before", "v": "350 W" }, { "k": "After", "v": "250 W" } ] } ], "confirmLabel": "Apply" } }
200 { "outcome": { … } }        409 stale_selection if it is no longer pending
```

Audio/images from selections are stored as media (`payload.mediaUrl`) so the
agent can fetch them with its token.

### 12.6 Confirm / back

```http
POST /api/v1/prompts/:id/confirm
{ "selectionId": "…", "decision": "confirm" }        // or "back"

200 { "status": "confirmed", "promptId", "selectionId", "execution": null }
200 { "status": "confirmed", …, "execution": { "status": "done", "result": { … } } }
200 { "status": "confirmed", …, "execution": { "jobId": "job_…", "status": "running" } }
200 { "status": "open", … }                          // back
403 scope_required                                   // outcome.action needs command:<id> on *this* device
409 stale_selection | invalid_state | prompt_closed
500 command_failed                                   // action failed; device stays outcome_ready, may retry or back
```

Idempotent: repeating the same `(selectionId, decision)` returns the first
response with `replay: true`. Confirmation runs `outcome.action` **under the
confirming device's scopes**, closes the prompt for every other device, and
emits `prompt.confirmed` to the agent with the original input.

### 12.7 Worked example — the full cycle from a watch

1. Agent: `POST /agent/prompts` (§12.2) → delivered `{ deviceId, seq: 6 }`.
2. Watch stream: `prompt.new` #6 → renders title, two option chips, mic and keyboard glyphs, "Ignore".
3. User taps **Wait 10 min** → `POST /prompts/prm_…/select { selectionId: A, choiceId: "wait" }` → `200 outcome_ready` → watch shows "Re-check in 10 minutes" with **Confirm** / **Back**.
4. User taps **Back** → `POST …/confirm { selectionId: A, decision: "back" }` → `200 open`.
5. User taps **Type instead**, enters "just cap the power to 250W" → `POST …/select { selectionId: B, choiceId: "type", payload: { kind: "text", text } }` → `202 pending, stage: thinking`; watch shows a spinner.
6. Agent stream: `prompt.selected { selectionId: B, payload.text }`; agent posts the outcome (§12.5).
7. Watch stream: `prompt.outcome #8 { status: outcome_ready, outcome.summary: "Cap GPU 0 power to 250 W", blocks: [kv] }`.
8. User taps **Apply** → `POST …/confirm { selectionId: B, decision: "confirm" }` → `200 confirmed`.
9. Agent stream: `prompt.confirmed { input.text, outcome, execution }`. Phone stream (if it was also targeted): `prompt.closed { reason: confirmed_elsewhere }`.

`clients/reference/demo.sh` step 7 runs exactly this.

## 13. Alerts and free-form messages

```http
POST /api/v1/agent/alerts        { "title", "body": [blocks], "priority", "targets"?, "ttlSec"?, "haptic"?, "ext"? }   → 202 { alertId, delivered[] }
POST /api/v1/agent/messages      { "type", "payload", "targets"?, "ttlSec"?, "ext"? }                                → 202 { delivered[] }   (device gets agent.message)
POST /api/v1/messages            { "type", "payload", "to"?, "ext"? }   (scope interact)                             → 202 { delivered[] }   (agent gets device.message)
```

Alerts are one-way, durable, no reply. Messages are the generic channel for
anything this document did not foresee — a gesture, a HUD line, a custom
handshake. `type` is a free string ≤64 chars; `payload` is any JSON within the
event budget.

## 14. Device profiles

A profile says **what** a device shows and may do, in what order, and how
often — never how it looks. Stored per device on the server, versioned,
editable by any device with `profile:*` (the phone), read by the device.

```http
GET  /api/v1/devices/me/profile                → 200 { profile }  + ETag: "v3"       (304 on If-None-Match)
GET  /api/v1/devices/:id/profile               (own, or profile:* / agent)
PUT  /api/v1/devices/:id/profile   If-Match: "v3"   { …profile body… }   → 200 { profile }  | 412 etag_mismatch
```

Profile body:

```json
{
  "refreshSec": 5,                                        // 2 … 3600; also drives the shared sampler when this device is streaming
  "quietHours": { "from": "23:00", "to": "07:00", "allowUrgent": true },
  "pages": [
    { "id": "home", "title": "Home",
      "surfaces": [ { "id": "system.cpu", "metrics": ["system.cpu.pct","system.cpu.temp"], "spark": true },
                    { "id": "system.memory", "metrics": ["system.memory.pct"] } ] },
    { "id": "stack", "surfaces": [ "docker.containers", { "id": "services.inference", "maxItems": 5, "commands": ["services.stop"] } ] }
  ],
  "commands": ["services.stop"],                          // commands this device should expose as quick actions
  "prompts": { "receive": true, "haptic": true, "allowVoice": true, "allowText": true, "allowImage": true },
  "sensors": { "allow": ["heartRate","accelerometer"], "autoReport": ["battery"] },   // consent list, see §16
  "artifacts": [],                                        // artifact ids the device should have cached
  "ext": { "theme": "amber" }                             // ≤ 8 KB, opaque
}
```

Server behaviour:
- Returned profiles are **effective**: surfaces and commands the device's token
  cannot use are removed and listed in `warnings[]` (`surface_not_in_scope`,
  `command_not_in_scope`) so the phone UI can show the mismatch.
- `version` increments on every PUT; `etag` is `"v<version>"`.
- The target device receives a durable `profile.changed { version, etag, updatedBy }`
  and should `GET` the profile again. `capabilities.profile.version` carries the
  same number for clients that were offline.
- Live `surface.update` pushes follow `pages[].surfaces` and `refreshSec`. A
  device whose profile lists no surfaces gets no surface pushes.
- Quiet hours suppress prompts and alerts below `urgent` (with `allowUrgent`).

## 15. Variables

Free-form per-device key/value document — for state the protocol did not
anticipate (battery, wrist state, app mode, anything). The device writes, the
agent reads and is notified.

```http
PATCH /api/v1/devices/me/vars   { "batteryPct": 58, "wristRaised": true, "ext": { "anything": "goes" } }   // null deletes a key
200 { deviceId, vars, version, updatedAt }
GET   /api/v1/devices/:id/vars   (own, vars:*, or agent)
```

Budget 16 KB. Each change emits `device.vars { deviceId, vars, version, changed[] }` to every agent device.

## 16. Sensors

Nothing is collected unless asked. The device declares sensors in `caps`; the
profile's `sensors.allow` is the consent list (set by the phone/user); the agent
requests readings for a bounded time; the device streams batches; the server
forwards them to the requester and keeps a short ring.

```http
POST /api/v1/agent/sensors/requests
{ "deviceId": "dev_…", "reason": "HRV check before a risky restart",
  "sensors": [ { "id": "heartRate", "rateHz": 1, "durationSec": 20 }, { "id": "accelerometer", "rateHz": 10, "durationSec": 5, "mode": "stream" }, "location" ],
  "ext": { "analysis": "hrv" } }
201 { "request": { "id": "sreq_…", "deviceId", "sensors": [ { id, mode: stream|once, rateHz, durationSec, unit } ], "reason", "ext", "status": "active", "expiresAt", "sampleCount": 0 },
      "rejected": [ { "id": "location", "reason": "not_declared" } ] }
403 sensors_rejected { rejected: [ { id, reason: not_declared | not_allowed_by_profile } ] }    // nothing acceptable
409 sensors_unavailable                                                                          // device declared no sensors
GET    /api/v1/agent/sensors/requests/:id?limit=200   → { request, samples[] }
DELETE /api/v1/agent/sensors/requests/:id             → { request: { status: "stopped" } }   (device gets sensor.stop)
```

Rates are clamped to the declared `maxRateHz` and the server max (50 Hz);
durations to 600 s. The device receives `sensor.request` and reports:

```http
POST /api/v1/sensors/samples        (scope sensors:report)
{ "requestId": "sreq_…",
  "samples": [ { "sensor": "heartRate", "ts": "2026-09-09T07:33:11.001Z", "value": 71 },
               { "sensor": "accelerometer", "values": [0.02, -0.01, 9.81], "accuracy": 3 },
               { "sensor": "battery", "value": 58 },
               { "sensor": "custom.thing", "ext": { "raw": "…" } } ] }
200 { "accepted": 3, "rejected": [ { "sensor": "heading", "reason": "not_requested" } ] }
```

- `value` (number) or `values` (number[≤16]) or `ext` (anything) per sample; `ts` defaults to server time.
- Samples for sensors in the profile's `autoReport` list are accepted **without** a request (e.g. `battery`); `requestId` may then be omitted.
- Batch ≤500 samples; keep batches at the request's natural cadence (e.g. 1 s of accelerometer per POST).
- The requester receives ephemeral `sensor.samples { deviceId, requestId, samples[] }`; `GET /devices/:id/sensors` returns `{ declared, latest }` (last value per sensor).

## 17. Media

Device uploads (photos, audio) referenced by id.

```http
POST /api/v1/media      multipart: file=@photo.jpg;type=image/jpeg  meta={"w":640,"h":480,"source":"camera","ext":{"lens":"wide"}}
201 { "media": { "id": "med_…", "mime", "kind": image|audio|other, "bytes", "sha256", "ownerDeviceId", "meta", "createdAt", "expiresAt", "url": "/api/v1/media/med_…" } }
GET  /api/v1/media/:id          → binary with Content-Type       GET /api/v1/media/:id/info → { media }
```

Accepted types: `image/jpeg|png|webp`, `audio/ogg|webm|mp4|mpeg|wav|flac`,
`application/octet-stream`, `application/json`, `text/plain`. Limits 1.5 MB
(images/other), 1 MB / 30 s (audio). Retention 24 h. Readable by the owner,
`media:*`, or any agent device.

## 18. Artifacts (agent → device code and data)

The agent can hand a device something to run or use — a JS function, a wasm
module, a Lua script, a lookup table. The server stores, hashes and delivers;
it never executes. Delivery is gated on `caps.exec`.

```http
POST /api/v1/agent/artifacts
{ "name": "rmssd", "runtime": "js", "mime": "text/javascript", "entry": "rmssd", "params": { "windowSec": 60 },
  "purpose": "HRV from RR intervals, computed on the device", "targets": ["dev_…"]?, "ttlSec": 3600?,
  "content": "export function rmssd(rr){…}"    // or "contentBase64" for binary
}
201 { "artifact": { "id": "art_…", "name", "runtime", "mime", "bytes", "sha256", "entry", "params", "purpose", "targets", "ext", "createdAt", "expiresAt",
                    "url": "/api/v1/artifacts/art_…", "contentUrl": "/api/v1/artifacts/art_…/content" } }

POST /api/v1/agent/artifacts/:id/deliver   { "targets": ["dev_…"], "inline": true, "message": "run on each heartRate batch" }
202 { "report": [ { "deviceId", "delivered": true, "seq": 11 }, { "deviceId", "delivered": false, "reason": "runtime_unsupported", "exec": [] } ] }
GET /api/v1/agent/artifacts     DELETE /api/v1/agent/artifacts/:id
```

Device side: `artifact.deliver` event (with `inline` content when requested,
≤ event budget), `GET /artifacts/:id` → `{ artifact }`, `GET /artifacts/:id/content`
→ bytes with `Content-Type` and `X-Doca-Runtime`. Verify `sha256` before
executing. Artifacts ≤ 256 KB. A `targets` list restricts visibility to those
devices; `null` means any device with `artifacts:self`.

Artifacts can also appear inside prompt/alert bodies as `artifact` blocks; on a
device without the runtime they degrade to a text block with the `alt`.

## 19. Rendering, blocks, motion

### 19.1 Blocks (rich content in prompts, outcomes, alerts)

| type | fields | notes |
|---|---|---|
| `text` | `text ≤2000`, `style: body|title|caption|code` | |
| `metric` | `metric: <metricId>`, `label?` | client shows the live value from its snapshot |
| `figure` | `id`, `alt`, `representation` (device view) — authored as `svg?`, `motion?`, `image?`, `text?`, `sizeHint?` | §19.4 |
| `image` | `url`, `alt`, `w?`, `h?` | fetch with your token |
| `media` | `mediaId`, `url`, `alt` | §17 |
| `artifact` | `artifactId`, `runtime`, `url`, `contentUrl`, `alt` | §18 |
| `list` | `items: string[≤20]` | |
| `kv` | `items: [{ k ≤48, v ≤120 }]` | |

Any block may carry `ext`. Unknown block types are dropped at authoring time;
clients must still skip types they do not know.

### 19.2 Server-rendered charts

```
GET /api/v1/render/chart?metrics=system.cpu.pct,system.memory.pct
    [&w=360&h=160&rangeSec=3600&theme=dark|light&title=…&unit=%&labels=CPU,RAM
     &thresholds=[{"level":"warn","gte":70}]&min=0&max=100&round=1&format=svg]
→ image/png (Cache-Control: private, max-age=5)
```

- Up to 4 metrics from the sampler's history ring (≈1 h at 5 s). Requires
  `read:` on each metric's surface.
- Defaults to `render.defaults` (screen size, round corners for round screens).
- `format=svg` is honoured only for devices with `svg` in `caps.render`.
- PNGs are ≤ 200 KB (`413 image_too_large` otherwise — reduce size).
- Text is present when `capabilities.render.text` is `true` (the server found a
  TTF; set `DOCA_FONT=/path/font.ttf` to choose one).

### 19.3 Figures: posters and sprite sheets

```
GET /api/v1/render/figure/:figureId?w=120&h=120            → PNG poster (t = 0)
GET /api/v1/render/figure/:figureId?w=120&h=120&frames=8   → PNG sprite sheet, frames laid out horizontally
      response headers: X-Doca-Frames: 8   X-Doca-Duration-Ms: 4000
GET /api/v1/render/figure/:figureId?format=svg             → original SVG (svg-capable devices only)
```

Sprite frames are sampled from a **SMIL subset** of the SVG: `<animate>` with
`from/to` or `values` on numeric or numeric-list attributes, `<animateTransform>`
(`rotate`, `translate`, `scale`), `<set>`, `dur`, `begin`, `repeatCount`,
`fill="freeze"`. Anything else renders as its initial state. Authors targeting
watches should stay inside this subset or supply a `motion` scene.

### 19.4 Representation selection

A `figure` is authored once with several representations; each device receives
exactly one, chosen in this order against `caps.render` / `caps.motion`:

1. `svg` — if the device lists `svg` (and `svg.smil` when the SVG is animated) → `{ kind: "svg", svg, animated }`
2. `motion` — if a scene is provided and the device lists its vocabulary → `{ kind: "motion", scene }`
3. `sprite` — animated SVG and device lists `sprite` → `{ kind: "sprite", url, frames, fps, w, h, loop }`
4. `image` — static/animated SVG or an authored image, device lists `image` → `{ kind: "image", url, w, h }`
5. `text` — always → `{ kind: "text", text }` (the scene caption or `alt`)

Sizes come from `sizeHint`, else the device screen (≤480 px).

### 19.5 Motion vocabulary `1`

Five primitives that map onto native animation APIs (Compose/Wear `animate*AsState`,
SwiftUI `withAnimation`, CSS transitions). Targets are metric ids or block ids
in the same prompt.

```json
{ "vocab": "1", "loop": false, "caption": "VRAM ring empties",
  "tracks": [
    { "type": "morph",  "target": "gpu.0.temp",     "from": 97, "to": 71, "durationMs": 800, "easing": "ease-out", "unit": "°C" },
    { "type": "ring",   "target": "gpu.0.vram.pct", "from": 0.9, "to": 0, "durationMs": 4000, "easing": "ease-out", "color": "ok" },
    { "type": "reveal", "target": "outcome",        "mode": "slide-up", "durationMs": 300, "delayMs": 200 },
    { "type": "pulse",  "target": "title",          "count": 3, "periodMs": 800, "color": "warn" },
    { "type": "sequence", "loop": false, "steps": [ …primitives… ] }
  ] }
```

`easing` ∈ `easings`, `color` ∈ `colorRoles` (the client owns the palette).
Unknown primitives are dropped; the scene is still delivered. Durations are
clamped (50 ms – 10 s).

## 20. Payload size guidance

| Payload | Server limit | Guidance for constrained clients |
|---|---|---|
| Snapshot | 16 KB per surface | ask for 2–4 surfaces per screen; `spark` adds ≤60 numbers per gauge |
| `surface.update` event | 32 KB (lists trimmed to 10 items if needed) | one event per surface; parse incrementally |
| Prompt (excluding figure SVG) | 32 KB | title + ≤8 choices + a few blocks is ~2–4 KB |
| Any push event | 32 KB | |
| Rendered image | 200 KB PNG | watch: 240–450 px squares are 5–40 KB |
| Media upload | 1.5 MB image / 1 MB audio (30 s) | downscale photos to ≤1280 px, use webp/jpeg; ogg/opus for voice |
| Artifact | 256 KB | |
| `ext` (anywhere) | 8 KB | |
| Variables document | 16 KB | |
| Sensor batch | 500 samples | batch by ~1 s of data |
| Outbox | 500 events / 24 h per device | reconnect at least daily or you will get `resync` |
| Heartbeat | every 25 s | reconnect after 50 s of silence |

Battery guidance: keep **one** SSE stream open while the app is foregrounded;
in the background switch to the JSON poll at `retryAfterSec`, or rely on the
phone to relay. Use `If-None-Match` on snapshots/profiles; they are cheap 304s.

## 21. Client implementation checklist

**Any device**
1. Pair (`/devices/pair/complete`) with an honest `caps`; store the token in the secure store.
2. `GET /capabilities`; build screens from `surfaces`, `commands`, `profile`.
3. `GET /devices/me/profile`; `GET /snapshot?surfaces=<page>&spark=1`.
4. Open `/events` (SSE) with `since=<last seq>`; handle `hello.resync`.
5. On `surface.update` → update values; on `prompt.new`/`alert` → notify (haptic when `haptic:true`); on `profile.changed` → refetch profile and capabilities; on `revoked` → wipe token; on `resync` → step 2.
6. Ack durable events (`POST /events/ack` or via `since`).
7. Prompt UI: `select` with a fresh UUID, show `outcome` or spinner for `pending`, `confirm`/`back`; treat 409 `stale_selection` by refetching the prompt.
8. Persist `since`, `selectionId`s in flight, and the profile ETag across restarts.

**Watch extras**: prefer `render:["image","sprite","text"]` + `motion:["1"]`; request chart images at screen size; expose voice via `payload.transcript` if on-device STT exists, else upload ogg.

**Phone extras**: `profile:*` + `devices:admin` — implement pairing UI (show the code/QR), the profile editor (respect `warnings`), and device revocation. Declare `input.camera` to receive image choices.

**Glasses / display-less**: omit `screen`; still receive prompts (voice + speaker); declare `input.camera` and sensors such as `heading`, `gaze`.

**Agent**: `agent` preset. Listen on `/events`; answer `prompt.selected` when using `resolver:"agent"`; raise prompts/alerts; request sensors with a `reason`; ship artifacts only for declared runtimes; read `device.vars` and `device.message` for anything unforeseen.

## 22. Server operations

- Data directory: `DOCA_DATA_DIR` (default `<repo>/.doca`, gitignored): `devices.json`, `prompts.json`, `profiles/`, `outbox/`, `media/`, `artifacts/`. Atomic writes; safe to back up.
- Tokens: `npm run token -- issue|list|rotate|revoke|scopes`.
- Free-form resolution needs the gateway chat endpoint (`OPENCLAW_GATEWAY_URL`, `openclaw.json` → `gateway.http.endpoints.chatCompletions.enabled`) and, for audio, an STT service (`DOCA_STT_URL` or dashboard voice settings).
- Fonts for rendered text: `DOCA_FONT=/path/to/font.ttf` (auto-detects DejaVu/Liberation/Noto).
- Tests: `npm test` (node --test, no external services required).
- Extending: add a surface in `modules/api-v1/surfaces.js` (`DEFS` + `buildSurface`), a command in `commands.js` (`COMMANDS`), an event type in `bus.js` (`TYPES`). Everything appears in `/capabilities` automatically. Additive changes do not bump the protocol version.

## 23. Endpoint index

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/` | — | discovery |
| GET | `/openapi.json` | — | OpenAPI 3.1 description of this API |
| POST | `/devices/pair/complete` | — | finish pairing → token |
| GET | `/capabilities` | any | §6 |
| GET | `/devices` | `devices:admin` \| `agent` | list devices (+ presets) |
| POST | `/devices` | `devices:admin` | issue a token directly |
| POST | `/devices/pair/start` | `devices:admin` | start pairing |
| GET / PATCH | `/devices/:id` | self \| `devices:admin` (\| `agent` for GET) | device record / update caps (admin: name, scopes, expiry) |
| POST | `/devices/:id/rotate` | self \| `devices:admin` | rotate token |
| DELETE | `/devices/:id` | `devices:admin` | revoke |
| GET / PUT | `/devices/:id/profile` | self (`profile:self` to write) \| `profile:*` | §14 |
| GET / PATCH | `/devices/:id/vars` | self (`vars:self` to write) \| `vars:*` \| `agent` | §15 |
| GET | `/devices/:id/sensors` | self \| `sensors:*` \| `agent` | latest samples |
| POST | `/sensors/samples` | `sensors:report` | report samples |
| GET | `/surfaces`, `/surfaces/:id`, `/snapshot` | `read:<id>` | §9 |
| GET | `/commands` | any | runnable commands |
| POST | `/commands/:id` | `command:<id>` | §10 |
| GET | `/jobs/:id` | owner \| `agent` \| `devices:admin` | job status |
| GET | `/events` | any | SSE / poll |
| POST | `/events/ack` | any | ack |
| GET | `/prompts`, `/prompts/:id` | `interact` | open prompts / one prompt (device view) |
| POST | `/prompts/:id/select`, `/prompts/:id/confirm` | `interact` | §12 |
| POST | `/messages` | `interact` | device → agent |
| POST | `/media` | `media:upload` \| `media:*` \| `agent` | upload |
| GET | `/media/:id`, `/media/:id/info` | owner \| `media:*` \| `agent` | fetch |
| GET | `/artifacts/:id`, `/artifacts/:id/content` | `artifacts:self` \| `artifacts:*` | fetch |
| GET | `/render/chart`, `/render/figure/:id` | `read:<surface>` / any | §19 |
| GET | `/agent/devices` | `agent` | devices with effective profiles |
| POST / GET / DELETE | `/agent/prompts[/:id]` | `agent` | raise / list / cancel |
| POST | `/agent/prompts/:id/outcome` | `agent` | resolve a pending selection |
| POST | `/agent/alerts`, `/agent/messages` | `agent` | §13 |
| POST / GET / DELETE | `/agent/sensors/requests[/:id]` | `agent` | §16 |
| POST / GET / DELETE | `/agent/artifacts[/:id]`, POST `/agent/artifacts/:id/deliver` | `agent` | §18 |

All paths are relative to `/api/v1`.
