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

### 2.2 One hub, several addresses

A hub may answer at its Tailscale name, its tailnet address and — when it listens on the local network (hub 2.233,
`network.listen: lan`) — its LAN addresses. `GET /api/v1/hub/links` (any token) lists them best first as
`{links: [{url, label}], mode}`. A client keeps them all with the one it paired at, and when a request to the
current one cannot connect, tries the others in order and prefers the one that answered. The certificate is the same
at every address, so a pinned certificate holds; the device token is the same too. A device that is outside the
tailnet and the LAN still has no route — this lists addresses, it does not open any.

### 2.3 Wake-word models

`GET /api/v1/wakeword` (any token) lists the wake-word models the hub trained and keeps (openWakeWord ONNX, one per
word, each with its sha256) and the runtime's two shared models; a device downloads them from the URLs given and runs
the chain itself: 16 kHz mono → every 1280 samples a mel spectrogram of the last 1760 (÷10 + 2) → a speech embedding of
the last 76 mel frames → the word's model over the last 16 embeddings → a score; the word is heard at `frame.threshold`.
Nothing leaves the device until it is heard. A model for a word not kept answers 404.

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

**`kind`** is `device` by default and `agent` for a paired agent. Since hub 2.157.0 the hub itself makes
devices of kind **`channel`**: one per linked chat of a messaging channel (Telegram first), bound to the
person who linked it, with `caps.ext.channel` naming the service. They appear in device lists like any
other; a client that does not know the kind should draw it as a device and may leave it out of lists of
things to hand a screen to (it has no screen of its own to show a canvas on). The kind is additive: no
existing field changed. Since hub 2.164.0 there is also **`browser`**: a browser someone signed in on,
with no scopes and no token of its own (it reaches the hub by its sign-in session); revoking it signs that
browser out. `GET /settings/effective` answers any token with that device's settings over the hive's.
Since hub 2.168.0 `POST /mcp` is the hub as an MCP server (JSON-RPC: initialize, tools/list, tools/call), for
any MCP client holding a device token; its tools follow the token's scopes.
Since hub 2.187.0 `POST /agui` (scope `harness:chat`) is the hub as an AG-UI agent: AG-UI's RunAgentInput in
(`threadId`, `runId`, `messages`; the last user message is the turn), AG-UI's event stream out as SSE — `RUN_STARTED`,
`TEXT_MESSAGE_START`/`_CONTENT`/`_END`, `TOOL_CALL_START`/`_ARGS`/`_END`, `TOOL_CALL_RESULT`, then `RUN_FINISHED`
(`result.conversation` is the conversation id) or `RUN_ERROR`, with `CUSTOM` `doca.prompt` for a question asked of this
device (answer it through `/prompts`) and `doca.note` for input the hub does not use (the front end's own `tools`,
`state`). A `threadId` that is one of the person's conversation ids is that conversation; any other maps to one of its
own, the same one every time. It is the same turn `POST /harness/messages` starts; closing the stream does not stop it.
Since hub 2.189.0 `POST /a2a` (scope `harness:chat`) is the hub as an A2A agent (JSON-RPC 2.0, protocol 0.3):
`message/send` (text parts; the Task comes back `completed` with the answer, `failed` or `canceled`, or `working` with
`configuration.blocking: false`), `tasks/get`, `tasks/cancel`; a `contextId` is a conversation, as a `threadId` is for
AG-UI. The agent card is public at `https://<hub>/.well-known/agent-card.json`.
Since hub 2.191.0 `GET /clients/node` (any token) is the hub's release channel for `doca-client`: each file with its
sha256, and `GET /clients/node/:file` the bytes — a client compares, fetches what differs, and checks before replacing.
Since hub 2.194.0 the scope family `packs` (`packs:send`; the `hub` preset holds it and nothing else) lets another hub
send this one packs: `GET /packs` says who it is, `POST /packs` (the `.dpack` as multipart `file`) puts it in the
library for a host to bring in — nothing is applied on arrival.
Since 2.198.0, `packs:read` (the `registry` preset) lists what a hub publishes (`GET /packs/published`) and downloads one
(`GET /packs/published/:id`) — only while that hub's `experiments.packRegistry` is on (else 404), only packs a host
published.

**Rotation.** `POST /devices/me/rotate` returns a new token; the old one stays
valid for 60 s (`previousValidUntil`) so a client can swap atomically.

**Revocation.** `DELETE /devices/:id` (scope `devices:admin`). The device's
live streams receive a durable `revoked` event followed by an SSE `close`
frame, its outbox and profile are deleted, and its token fails with
`invalid_token` from then on. A device cannot revoke itself.

**Forgetting.** `DELETE /devices/:id?purge=1` (same scope) revokes *and* deletes
the registry row. Revocation deliberately keeps the row — it is the record that
a credential was withdrawn — but a device that is re-paired on every test run
leaves one behind each time, and nothing was ever removing them. The two are
one call with a flag because forgetting a live device without revoking it first
would drop the row while its token was still being honoured in flight.

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
| `mcp` | `self` | read and re-address the one MCP server this device hosts; offer a new one for the user to accept (§22) |
| `devices` | `admin` | list/create/pair/patch/revoke devices |
| `harness` | `chat`, `sessions`, `memory` | talk to the agent: post a message and receive turns / manage conversations / read what it remembers (§23) |
| `agent` | — | the `/agent/*` API (raise prompts and alerts, request sensors, deliver outcomes and artifacts, read devices/vars/sensors/media) |

`harness:*` and `agent` are opposite directions, not degrees of the same thing:
`harness:*` is a client asking the agent for something, `agent` is the agent
acting on clients. Neither implies the other. No target in `harness` lets a
device define what the agent may run, and none writes a setting — a proposal is
applied by a click in the dashboard, never by a token.

Matching: `read:*` ⊇ `read:gpu.0`; `read:system.*` ⊇ `read:system.cpu`;
`command:compose.restart` does **not** grant `command:compose.stop`.

Presets (returned by `GET /devices` and used by the CLI):

| Preset | Scopes |
|---|---|
| `admin` | `*` |
| `agent` | `agent read:* artifacts:* media:* sensors:* vars:* profile:*` |
| `watch` | `read:* interact profile:self vars:self sensors:report media:upload artifacts:self harness:chat` |
| `phone` | `read:* command:* interact profile:* vars:self sensors:report media:upload artifacts:self devices:admin mcp:self harness:chat harness:sessions` |
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
  "server": { "name": "doca", "version": "2.6.1", "time": "2026-09-09T07:33:07.552Z" },
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
  "formFactor": "watch",                  // watch | phone | car | glasses | tablet | desktop | browser | headless | other
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
| `agent.turn` | durable | `{ turnId, sessionId, state: started\|done\|failed, by, message?, text?, steps?, proposals[]?, error?, quiet? }` — one conversation turn (§23) |
| `agent.text` | ephemeral | `{ turnId, sessionId, delta }` — reply text as produced; **only to the device that posted the message** |
| `agent.tool` | ephemeral | `{ turnId, sessionId, name, phase: call\|result, step, args?, ok?, preview? }` |
| `agent.mission` | durable on start/finish, ephemeral for step ticks | `{ missionId, agentId, label, task, state: running\|paused\|done\|failed\|cancelled, steps, tokens, startedAt, endedAt?, result?, error?, plan?, progress?, archivedAt?, quiet? }` — a specialist agent's work, to every device with `harness:chat` whose owner may open the conversation (§23). `paused` means a restart cut it off; the agent asks the user whether to continue on the next turn from any device. `plan` is the specialist's own checklist (`[{ title, state: done\|running\|queued\|failed }]`, at most 12) and `progress` `{ done, total, percent }` from it — draw the bar from these, else from `steps`. `archivedAt` (hub 2.228) means the mission was put away: **take its row off and notify nothing** — it always comes with `quiet: true`. A `paused` mission is waiting for its person (continue or drop), not finished. A work chat arrives in the same shape with `kind: "work"` and `agentId: "work"`; one a person stopped or dropped is `cancelled` (why in `error`) — nothing finished, so nothing is announced as done. `GET /harness/missions` is the same picture for a client that has just woken up. |
| `artifact.deliver` | durable | `{ artifact, inline?, inlineEncoding?: utf8|base64, message, ext }` |
| `sensor.request` | durable (ttl = duration + 30 s) | `{ request: { id, sensors: [{ id, mode, rateHz, durationSec, unit }], reason, ext, expiresAt } }` |
| `sensor.stop` | durable | `{ requestId, reason }` |
| `revoked` | durable | `{ reason, by }` — then the stream closes; forget the token |
| `device.control` | durable (24 h) | `{ id, action: refresh\|reconnect\|ask\|disconnect\|revoke\|restore, family? }` — do it, then `POST /devices/self/control/{id}/ack { ok, detail }` (§22.1) |
| `device.wake` | durable (120 s) | `{ deviceId, type }` — to the phone that paired a watch (`pairedBy`), when a durable event lands for that watch and it is not listening. Pass it to the watch (Data Layer `/doca/wake`); the watch polls with its own token. Never carries the event (`modules/api-v1/wake.js`) |
| `console.input` | ephemeral (frames) / durable 60 s (a press) | `{ deviceId, enabled, mode: keys\|joystick, frames[{ t, accel?, heading?, crown? }], press?: A\|B\|C, button?: { id, behaviour: button\|toggle, down }, toggles: { A, B, C }, joystick?: { x, y, crown }, macro?: { keys } }` — only to the devices the panel linked to a console (`modules/device-console.js`); never to the harness. `down` is `false` only when a toggle latches off. `joystick` (mode `joystick`) is tilt, −1…1 at 90°, in the watch's own axes; `macro.keys` (mode `keys`) is the button's key chords for the receiver to type, e.g. `ctrl+s` |
| `resync` | ephemeral | `{ reason, cursor }` |
| **Agent-side** | | |
| `prompt.selected` | durable | `{ promptId, selectionId, deviceId, choiceId, payload: { kind, text?, transcript?, caption?, mediaId?, mediaUrl?, ext? }, resolver }` |
| `prompt.confirmed` | durable | `{ promptId, deviceId, selectionId, choiceId, input, outcome, execution }` |
| `prompt.dismissed` / `prompt.expired` | durable | `{ promptId, deviceId?, selectionId? }` |
| `device.vars` | durable | `{ deviceId, vars, version, updatedAt, changed[] }` |
| `device.message` | durable | `{ from, type, payload, ext }` |
| `sensor.samples` | ephemeral | `{ deviceId, requestId, samples[] }` |

**`quiet: true`** (hub 2.127.0) may appear on `agent.turn` and `agent.mission`
when the hub itself started the work — an automatic reply, a mission or work
chat starting or finishing — **and the owner is reading the panel right now**
(the panel reports its page visible every 30 s). It means: update what you show,
**raise no notification and no haptic**. It is never set on a turn a device
asked for. Absent means notify as before; a client that ignores the field (§3)
only notifies once more than it needs to. A quiet event does not trigger a
`device.wake` for a watch.

Since hub 2.242 a mission **put away** (`archivedAt` set) is also sent with `quiet: true`,
whoever is at the panel: finished work being tidied must never buzz a wrist again.
The rule for a client is the same either way — `quiet` present means no notification,
no haptic, no sound; `archivedAt` present means remove the row.

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

A prompt has two possible authors and a device cannot tell them apart, which is
the intent: an external agent holding an `agent`-scoped token posts to the
endpoint below, and the hub's own built-in harness raises one directly through
the same code (its `ask_device` tool). A prompt from the harness carries
`from`/`agentId` of `harness`, which is **not** a device id — do not look it up in
the registry. It asks with `option` choices, waits for the answer, and cancels the
prompt if nobody answers, so a device may see `prompt.closed` with reason
`cancelled` for a question that simply went unanswered.

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

**`ext.layout: "quadrants"`** (the agent's `ask_device` with an `svg`): the prompt's
`figure` block is the whole screen and its quarters are the `option` choices in
order — top-left, top-right, bottom-left, bottom-right; at most four. The drawing
labels them itself. A client that does not know the layout shows the figure and
the choices as usual, which is always correct.

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

A relayed client is still a client. A companion device with no network of its own —
a watch, which has no way to join a tailnet — may have a phone perform its requests,
and the hub neither knows nor cares: what makes it the *same* device is that the
relayed request carries **that device's own token**, so its scopes, its profile and
its `from` attribution are unchanged. A relay that substituted the carrier's token
would be handing out the carrier's authority, which §3's "losing a watch should not
mean losing the host" exists to prevent. See `DocaMobile/docs/WEAR_BRIDGE.md` for the
one implementation of this that exists.

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

## 22. MCP servers a client hosts

Most clients read and answer. A desktop-class client can also *offer* something:
an MCP server of its own, giving the agent tools that act on that machine — its
windows, its clipboard, its files — which the host cannot reach any other way.

Such a server is always `transport: http`. There is no stdio to a machine the
host is not running on, so a client-hosted server is a URL the host calls, and
the definition records which device is behind it. The agent is told, per tool,
which machine the call lands on, so "take a screenshot on my PC" resolves to the
right function rather than to the host's own screen.

**The registry is not yours to write.** `mcpServers` holds an address the host
calls and, for a host-side server, a command it spawns — and the legacy
`POST /api/mcp` is unauthenticated to every peer on the tailnet. So a client
cannot create, delete or start a definition. It gets exactly two things:

```http
POST  /api/v1/mcp/offer      (scope mcp:self)
{ "label": "DocaDesk", "url": "https://100.x.y.z:18765/mcp/<secret>",
  "tools": ["list_windows", "screenshot"], "note": "Windows desktop tools" }
202 { "offer": { "id": "mo_…", "status": "pending", … } }

GET   /api/v1/mcp/self       (scope mcp:self)  → { server: { id, label, transport, url, headers, state, error, toolCount } }
PATCH /api/v1/mcp/self       (scope mcp:self)  → { server }        body: { url?, headers? }
```

`202` means recorded, not accepted: the offer queues a card in the dashboard and
a human click is what creates the definition. Accepting always produces an http
server owned by the offering device. One pending offer per device — offering
again replaces it, which is how a client corrects a URL it has just regenerated.

`GET /mcp/self` is `404` until such a definition exists, and it is *self only*:
there is no admin form of it and no way to see another device's server.
`PATCH /mcp/self` writes the address and nothing else. Transport, owning device,
`autostart` and any command are ignored however they are spelled, because a
client that could set a command would be a way to run code on the host. It
exists for the case that genuinely breaks: a listener that regenerates a secret
in its URL on restart, which would otherwise leave a dead entry only a human
with a clipboard could repair.

`state` is the *host's* view of reaching you, not your view of your own listener.

The host may ask you to bring that listener up or down:

```
mcp.listener  { action: "start"|"stop", serverId, url, by }
```

A request, not a command. Refuse it if the user has consent switched off. The
`url` is the address the host currently holds, so a mismatch is your cue to
`PATCH /mcp/self`. Report success simply by becoming reachable; the host
discovers that when it connects.

**Securing the listener is your problem, not the protocol's.** Bind to the
tailnet interface only, and treat every request as untrusted until proven
otherwise. `headers` exists so the host can carry a bearer token you require.

### 22.1 A device as the harness's hands

A paired client can offer the harness the same **tool families** the host has —
`files`, `shell`, `processes`, `screen`, `input`, `apps`, `device`, `elevated`,
`mcp` — as far as its operating system allows (docs/design/devices-as-hands.md).

- The client asks its person **once per family**, in its own UI, and reports the
  result: `PUT /devices/self/grants { grants: { files: true, shell: false, … } }`.
  Note the spelling: these two routes are a literal `/devices/self/…`, while the
  device's own record elsewhere is `/devices/me` (an alias of its id). `me` is
  not accepted here, and `self` is not an alias there.
  DOCA offers the harness only a family that is granted and not revoked on
  DOCA's side. Reporting also clears a disconnect.
- DOCA may send `device.control` (§11.4). Handle each action, then
  `POST /devices/self/control/{id}/ack { ok, detail }`:
  - `refresh` — report caps (`PATCH /devices/{id}`) and grants again;
  - `reconnect` — drop and reopen the push stream (DOCA also closes it);
  - `ask` — ask the person for `family` again (on Android, `screen` also ends any
    capture session; sessions are opened per request and close after 30 s idle);
  - `disconnect` — close sessions and stop background services until the person
    opens the app again; stay paired (DOCA also ends the device's panel sessions);
  - `revoke` / `restore` — DOCA took `family` back / allowed it again; stop or
    resume offering it.
- **The `files` family**, on the MCP server the device hosts (§22): tools
  `files_list {path}` → `{path, entries:[{name,isDir,size,mtime}]}` (an empty
  path is the device's home), `files_read {path, encoding?}` → `{content, size,
  mtime}` (`encoding: "base64"` for bytes), `files_write {path, content,
  encoding?}`, `files_mkdir {path}`, `files_move {from,to}`, `files_copy
  {from,to}`, `files_delete {paths}` → `{ok}`; results as JSON text, a refusal as
  an MCP error. DOCA's Files tab and tree then browse the device
  (`/api/devices/{id}/files/*`, the host's shapes), only while `files` is granted
  and not revoked. The device decides what it shares.
- **Trust.** A paired device's own tools are trusted like the host's (not framed
  as outside text); a tool it forwards from another server, named
  `<server>__<tool>`, stays third party.
- **The device's page** is `https://<host>:<port>/d/<device-id>/` — the panel,
  with a "This device" card in Settings. Open it with the device token on the
  first load (as DocaMobile does); it is served only to that device's session or
  its owner, so the id in the path grants nothing.

- **One name per action, per family** (audit 2026-10-06, cl 27). A skill names a tool once for every client, so a
  client lending a family uses these names; a client still on an older name is marked, to be aligned in its next
  release. **Canonical** first; what each first-party client lends today:

  | Family | Canonical tools | DocaDesk | DocaMobile | doca-client |
  |---|---|---|---|---|
  | `shell` | `shell`, `shell_job` | as canonical | — | `shell_run` → `shell` |
  | `files` | `files_list`, `files_read`, `files_write`, `files_mkdir`, `files_move`, `files_copy`, `files_delete` | as canonical | as canonical | as canonical |
  | `screen` | `screen_capture` (an MCP `image`), `screen_read` (the accessibility tree), `screen_press`, `screen_windows` | `screen_capture`, `screen_windows` | `screen_capture`, `screen_read`, `screen_press` | `screen_capture` |
  | `input` | `input_click`, `input_type`, `input_keys`, `input_move`, `input_swipe` | `input_click`, `input_type`, `input_keys`, `input_move` | `input_tap` → `input_click`, `input_key` → `input_keys`, `input_type`, `input_swipe` | — |
  | `apps` | `apps_list`, `apps_open` | `apps_open` | `apps_list`, `apps_open` | `apps_open` |
  | `processes` | `processes_list`, `processes_start`, `processes_stop` | as canonical | — | `processes_list`, `processes_stop` |
  | `device` | `device_info`, `device_notify`, `device_clipboard_read`, `device_clipboard_write`, `device_camera`, `device_location`, `device_sensors` | — | `device_notify`, `device_camera`, `device_location`, `device_sensors` | `device_info`, `device_notify`, `device_clipboard_read`, `device_clipboard_write` |
  | `media` | `media_control` | — | as canonical | — |

  A tool that acts on what a person sees or types (`screen_press`, `input_*`) follows the computer's rules: a password
  field is never typed into, and a control that pays, buys, signs in or submits needs `confirm: true` (§22.2).

### 22.2 Lending tools over the device's own socket (since hub 2.202.0)

A device the hub cannot dial — a browser extension, a phone off the tailnet, anything behind NAT — can still host
an MCP server: it **dials the hub**. Open a WebSocket to `wss://<hub>/api/v1/mcp/host` with the token
(`Authorization: Bearer …`, or `?access_token=` where a socket cannot carry headers; scope `mcp:self`) and be an MCP
server on it: the hub sends JSON-RPC requests (`initialize`, `tools/list`, `tools/call`, …), one JSON message per
text frame, and you answer each by its `id`. One socket per device; a newer one replaces the older (close code 4000).

- Offer it like any hosted server, without an address: `POST /mcp/offer {transport: "socket", label, tools}`. A
  person accepts it in the MCP tab; until then nothing runs. While the socket is open the server runs; when it
  closes its tools are gone, and they come back when the device dials again.
- Mark a tool that reads the open world (a web page, a mailbox) with MCP's `annotations.openWorldHint: true`: its
  results reach the agent framed as other people's words. A device's other own tools stay trusted like the host's.
- A message every 20–30 s (a notification such as `{"jsonrpc":"2.0","method":"notifications/keepalive"}`) keeps
  intermediaries — and a browser's service worker — from closing an idle socket.
- `browser_click` / `browser_type` with `confirm: true`, from any device, is always asked of a person (as for an
  agent's computer).

The DOCA browser extension (`clients/browser`, preset `extension` = `mcp:self` only) is the first such client.

### 22.3 Sealed secrets: used on the device, never read by the agent (TODO P1.3)

An agent can have a password, a PIN or a key typed or pasted on one of its person's devices without ever seeing it
(CONSTITUTION S4): it calls `secret_use {secret, device, …}`, a person is asked every time, and the hub hands the value
to **that device alone, sealed for it**, for one use (or a few pastes) and a short time. The agent learns what was
done ("filled field [2] on https://bank.example", "on its clipboard for 1 paste or 30 s"), never the value. A device
that hosts an MCP server (§22, §22.2) takes part by doing three things:

1. **Take its seal key.** `GET /mcp/self/seal` (scope `mcp:self`) → `{v: 1, alg: "A256GCM", key, aad}`: 32 random bytes
   (base64) minted for this device the first time it asks, the same afterwards. Keep it where only the app reads it
   (Android Keystore-wrapped preferences, Windows DPAPI, the extension's own storage). A hub without sealed secrets
   answers 404: carry on without.
2. **Answer the hidden tool `secret_fill`.** It is never listed in `tools/list` (so an agent cannot call it), and only
   the hub calls it: `tools/call {name: "secret_fill", arguments: {sealed: {v: 1, iv, data}}}`. `iv` is 12 bytes and
   `data` is the AES-256-GCM ciphertext followed by its 16-byte tag (what WebCrypto's `encrypt` writes), both base64;
   the additional data is the UTF-8 of `aad` (`doca-seal:<your device id>`). Opened, it is JSON:

   | field | |
   |---|---|
   | `device` | your device id — refuse anything else |
   | `iat`, `nonce` | when it was sealed (ms) and a one-time id — refuse one older than 5 minutes or seen before |
   | `how` | `field` (a field on a web page), `type` (typed into what has focus), `clipboard` |
   | `value` | the secret — use it, never return, log or store it |
   | `ref`, `tab`, `origin` | for `field`: the `[n]` from the last snapshot, the tab (null: in front), the only origin it may be filled on |
   | `uses`, `ttlSec` | for `clipboard`: pastes before it is forgotten (1–10) and the most seconds it may stay (5–300) |

   Use it as `how` says or refuse with `isError` and a sentence (never containing the value): a `field` only when the
   tab's origin is exactly `origin` (a look-alike gets nothing); `clipboard` cleared after `uses` pastes where the OS
   can count them, else after `ttlSec`, and kept out of clipboard history where the OS allows. While a secret is on
   the clipboard, refuse your own clipboard reads and command lines. Answer
   `{"done": "field"|"typed"|"clipboard", "uses": n, "counted": true|false, "seconds": s}` as text.
3. **Forget it.** Nothing of the value stays after the use: not in a file, a log, a crash report or a notification.

Clients: `clients/node` (doca-client: `type` and `clipboard`, with the `device` family lent) and `clients/browser` (the
extension: `field`). What DocaMobile and DocaDesk implement is `docs/api/sealed-secrets.md`.

## 23. Talking to the agent (`/harness`)

Every client is an input and an output to one agent. A watch, a phone and a
kiosk are not three assistants; they are three ways into the same conversation.

**Posting a message and receiving the answer are separate.**

```http
POST /api/v1/harness/messages          → 202 { turnId, sessionId }
{ "message": "how many containers are up?", "sessionId": "s_…" }   // sessionId optional
```

`voice` (since hub 2.217.0, optional): `"call"` when the message was spoken in a live call — the answer is shaped to be
heard (short sentences, no markdown, questions asked aloud) — or `"assistant"` when the call came from a face: quicker
and shorter still, in the owner's `assistant.style` and at `assistant.effort` (turn/effort.js). The hub's own call
engine (§23.1.1) sets it: `"assistant"` for a watch, `"call"` for anything else.

Omitting `sessionId` addresses the persistent Orchestrator, independently of
which conversation is selected in the Harness. An explicit `sessionId` still
addresses that conversation. The dashboard's floating chat uses the same
Orchestrator; clearing it archives its transcript and starts a fresh main chat.

The reply does not come back in that response. It is published on the push
channel (§11), which is already cursor-based, resumable and multi-subscriber:

| Event | Who receives it | Why |
|---|---|---|
| `agent.turn` `state: started` | every device with `harness:chat` | any client can show "Doca is answering", and `by` says which device asked |
| `agent.tool` | every device with `harness:chat` | what it is doing, instead of a spinner |
| `agent.text` | **only the device that posted** | a client with no screen open should not pay radio time for tokens |
| `agent.turn` `state: done` | every device with `harness:chat` | carries the whole reply in `text`, so a client that missed the deltas missed nothing |
| `agent.turn` `state: failed` | every device with `harness:chat` | `error.code` is `harness_unconfigured` (no model chosen) or `harness_error` |
| `agent.mission` | every device with `harness:chat` | a mission runs with nobody watching, so its start and finish are worth having on waking; the step ticks in between are not |

"Every device with `harness:chat`" means, since hub 2.147.0, every such device **whose owner
may open the conversation**: the person it belongs to (the first to write in it, or the person
above a work chat or mission), and anyone holding `host`. A device paired to nobody is not narrowed.
`GET /harness/missions` and `GET /harness/sessions` list the same set. A client needs no change; a
phone simply stops receiving another person's turns.

`agent.turn` is durable and the other two are ephemeral. That is the whole
battery story: a watch may subscribe and simply ignore `agent.text`, or go
offline mid-turn and still find the answer waiting when it returns. A client
that connects during a turn can ask `GET /harness/turns` instead of waiting for
the next event.

A conversation is the unit of state, and it is the same conversation the
dashboard console shows — there is no separate device-side history:

```http
GET  /harness/sessions              → { sessions[], active }
POST /harness/sessions              → { session }        // becomes active
GET  /harness/sessions/:id?limit=50 → { session, messages[] }
POST /harness/sessions/:id/activate
DELETE /harness/sessions/:id
```

`messages[]` is shaped for drawing a chat: `{ role, content, from?, name?,
tools[]? }`, where `tools[]` names what an assistant row called rather than
reproducing the model's tool-call plumbing, and `from` is the client that asked
(`{ id, name, formFactor }`) so one shared conversation still shows which window
each question came through.

**The hub tags the turn; the client does not.** A device does not describe itself
per message and there is no field for it to try: the hub reads the caps the
device was paired with (§7) and tells the agent, in the system prompt of that
turn, which client is asking and how much answer it can hold — a watch gets one
or two sentences and no tables, a phone short paragraphs, a desktop the full
detail, an `agent`-kind client machine-readable output with no formatting at all.
Three consequences worth knowing:

- **Declaring your caps honestly is how you get a readable answer.** A phone that
  claims a 450×450 screen will be answered like a watch.
- **The tag is never glued to the user's words.** `content` is what was typed, so
  a transcript stays quotable and a second device reads it as prose, not as
  metadata.
- **The dashboard console tags itself too** (as a desktop browser). No turn is
  anonymous, which is why the agent can say "I'll keep this short, you're on the
  watch" without being told.

Rules a client can rely on:

- **One turn per conversation, and nobody waits for it.** A `POST` while a turn is
  running is accepted (`202`, with `queued: true` and the `position` it waits at) —
  never refused (hub 2.148.0; it was `409 turn_in_flight` before). The running turn
  reads the message before its next step, and this `turnId` then goes `started` →
  `done` carrying *that* turn's answer; or, if the turn ends first, the message
  starts the next turn as this device. Two devices still never interleave one
  transcript: messages are read in order, between steps.
- **A device never writes a setting.** `GET /harness/memory` shows what the agent
  remembers, the rules it follows, and any settings proposal it has made;
  applying one is a click in the dashboard. A client should show a waiting
  proposal, not offer to accept it.
- **Unknown event types and payload fields must be ignored** (§3), which is how
  thinking traces and multimodal turns will arrive without breaking you.

**Files in a turn.** A message may carry `mediaId` (one id or a list, uploaded first with §17) or `attachments`
(names of files already in the hub's attachments): the hub copies each into its attachments and the agent is given
its path, as for a file dropped into the panel — it reads, converts or shows it with its tools. An id the hub does not
know, or one that expired, is `404 not_found`, never silently dropped. Voice out and an `agent.thinking` event are not
part of this protocol (a live call, §23.1, is how a device speaks with the agent).

### 23.0 Stopping, putting away, and what waits for the person (hub 2.257.0)

What the panel's Harness does to running work, a device does too, as its person — each conversation's access rule
decides, and anything else answers 404 as if absent:

| Route | Scope | Does |
|---|---|---|
| `POST /harness/missions/{id}/stop` | `harness:chat` | stops a specialist at its next step; what sent it waits for its person |
| `POST /harness/work/{id}/restart` · `/drop` | `harness:chat` | carries on with, or ends, a work chat a person stopped |
| `POST /harness/sessions/{id}/archive` `{on}` | `harness:sessions` | puts a conversation away (its missions with it) or back — not a delete |
| `POST /harness/missions/{id}/archive` `{on}` | `harness:chat` | puts a finished mission away or back |
| `GET /harness/working` | `harness:chat` | `{missions, auto, stopped}`: what runs on its own now, with why, and what waits for restart or drop |
| `GET /ambient?place=&units=` | `harness:chat` | the person's day: weather, today's calendar, notices — what the ambient screen shows |
| `GET /decisions` | `harness:chat` | everything waiting for the person's decision, `{kind, id, title, at, page}` (a host's device also the hive's) |

Putting away is announced like any change: `agent.mission` with `archivedAt` and `quiet` — take the row off, notify
nothing. Since 2.257.0 the `watch` preset holds `harness:sessions` (the face and schedules); a watch paired earlier
gets it with `npm run token -- grant <deviceId> --preset watch` or the device's Re-apply preset.

### 23.1 A live call (since hub 2.200.0; an experiment)

`GET /realtime` (scope `harness:chat`) says whether the hub can hold a live call with a realtime speech model
(`available`, which needs the owner's `experiments.realtimeVoice` and `realtime.model`), which protocol it relays
to (`openai` or `gemini`) and the audio it takes: `{format: "pcm16", rate: 24000, channels: 1}`.

The call is a **WebSocket on the same path**, `wss://<hub>/api/v1/realtime`, with the device's token —
`Authorization: Bearer …`, or `?access_token=` for a client that cannot set headers on a socket — and optionally
`?session=<id>` for one of the person's conversations (otherwise the call gets a new conversation of its own).

- **Binary frames are audio, both ways**: PCM16 little-endian, mono, 24 kHz. Send the microphone in frames of
  about 100 ms; play what comes back in order.
- **Text frames are JSON.** From the hub: `ready` (`protocol`, `model`, `sessionId`), `user` (what the person was
  heard to say), `agent` (the voice's words as they are spoken, deltas), `interrupted` (the person talked over the
  answer: **drop audio queued to play**), `working` (`text`: a request handed to the hive), `done` (an answer
  finished), `error` (`message`), `closed` (`reason`, `stats`). From the client: `{"type": "stop"}`.
- The voice holds no power of its own: anything real it hands to the conversation as an ordinary turn of this
  device (`agent.turn` on the bus as usual, its person's level and approvals; a question for the person reaches the
  device as a prompt, §12). A request longer than the owner's `realtime.waitSec` keeps running and is spoken when done.
- The provider's key stays on the hub: a client needs no account with the speech service.

#### 23.1.1 A call by whichever engine the hub has (since hub 2.211.0)

`GET /call` (scope `harness:chat`) and the WebSocket `wss://<hub>/api/v1/call` are §23.1 with the engine chosen by
the hub: `engine: "realtime"` while a realtime model is on, else `engine: "pipeline"` — the hive's own speech-to-text,
a turn and text-to-speech (Settings → Voice). **The wire is identical**: the same PCM16 24 kHz frames both ways, the
same JSON frames, `ready.protocol` `"pipeline"`. With the pipeline every utterance is a request to the conversation
(`user`, then `working`), the answer is spoken a sentence at a time (`agent` carries each sentence), speech over it
sends `interrupted`, and a recording with under 300 ms of speech is dropped. `available` is `false` with a `reason`
when the voice services do not answer. A client that wants a call writes it once against `/call`; this is what a
watch reaches through its phone (DocaWear, docs/design/watch-call.md).

### 23.2 What a person has in the hive (since hub 2.201.0)

The device's person's recipes, schedules and face, answered as that person exactly as the panel answers them:

- `GET /recipes` (`harness:chat`) — `{recipes: [{id, title, description, params}]}`; `POST /recipes/:id/run`
  (`harness:chat`, `{values}`) runs one with no model, through the person's approvals (a question may reach this
  device as a prompt, §12), and answers when it ends: `{ok, summary, steps}`.
- `GET /schedules` (`harness:sessions`) — the person's schedules, including ones the agent `proposed`;
  `POST /schedules/:id/state` (`harness:chat`, `{state: "on" | "paused"}`). Switching one on is a person's decision:
  a device of kind `agent` may pause and gets `403 person_only` for `on`.
- `GET /face` (`harness:sessions`) — `{state, detail}`: idle, thinking, working, speaking, asking, error (`detail`,
  a tool name, only for a host's device); `GET /face/stream` is the same as server-sent events, on every change and
  a heartbeat every 15 s — what a watch face or a desktop overlay draws from.

## 24. Server operations

- Data directory: `DOCA_DATA_DIR` (default `<repo>/.doca`, gitignored): `devices.json`, `prompts.json`, `profiles/`, `outbox/`, `media/`, `artifacts/`. Atomic writes; safe to back up.
- Tokens: `npm run token -- issue|list|rotate|revoke|grant|scopes`. A token carries the scopes it was minted with, so a device paired before a scope family existed needs `grant <deviceId> --preset <p>` (or `--add harness:chat`) to reach the new routes; its token keeps working.
- Free-form resolution needs the gateway chat endpoint (`OPENCLAW_GATEWAY_URL`, `openclaw.json` → `gateway.http.endpoints.chatCompletions.enabled`) and, for audio, an STT service (`DOCA_STT_URL` or dashboard voice settings).
- Fonts for rendered text: `DOCA_FONT=/path/to/font.ttf` (auto-detects DejaVu/Liberation/Noto).
- Tests: `npm test` (node --test, no external services required).
- Extending: add a surface in `modules/api-v1/surfaces.js` (`DEFS` + `buildSurface`), a command in `commands.js` (`COMMANDS`), an event type in `bus.js` (`TYPES`). Everything appears in `/capabilities` automatically. Additive changes do not bump the protocol version.

## 25. Endpoint index

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
| GET / PATCH | `/mcp/self` | `mcp:self` | the MCP server this device hosts; correct its address (§22) |
| POST | `/mcp/offer` | `mcp:self` | offer one for the user to accept (§22) |
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
| POST | `/harness/messages` | `harness:chat` | ask the agent; the turn arrives as events (§23) |
| GET | `/harness/turns` | `harness:chat` | turns in flight |
| GET | `/harness/usage?days=1` | `harness:chat` | model calls and tokens per provider — `{ since, total, rows[{ key, calls, prompt, completion, cached, estimated }] }`, tokens only |
| GET / POST | `/harness/sessions` | `harness:sessions` | list / start a conversation |
| GET / DELETE | `/harness/sessions/:id` | `harness:sessions` | transcript / delete |
| POST | `/harness/sessions/:id/activate` | `harness:sessions` | make it the active one |
| GET | `/harness/memory` | `harness:memory` | durable memory, rules, waiting proposals |
| GET, WS | `/realtime` | `harness:chat` | a live call with a realtime speech model (§23.1) |
| GET | `/recipes`, POST `/recipes/:id/run` | `harness:chat` | the person's recipes (§23.2) |
| GET | `/schedules` | `harness:sessions` | the person's schedules (§23.2) |
| POST | `/schedules/:id/state` | `harness:chat` | on / paused; never on for an `agent` device |
| GET | `/face`, `/face/stream` | `harness:sessions` | what the hive is doing (§23.2) |
| GET | `/clients/android/:app`, `/clients/android/:app/apk` | any | the newest build of DocaMobile or DocaWear this hub keeps: `versionCode`, `versionName`, `sha256`, `bytes`, `url`; update when `versionCode` is higher than yours, and check the download's sha256 |
| GET | `/agent/devices` | `agent` | devices with effective profiles |
| POST / GET / DELETE | `/agent/prompts[/:id]` | `agent` | raise / list / cancel |
| POST | `/agent/prompts/:id/outcome` | `agent` | resolve a pending selection |
| POST | `/agent/alerts`, `/agent/messages` | `agent` | §13 |
| POST / GET / DELETE | `/agent/sensors/requests[/:id]` | `agent` | §16 |
| POST / GET / DELETE | `/agent/artifacts[/:id]`, POST `/agent/artifacts/:id/deliver` | `agent` | §18 |

All paths are relative to `/api/v1`.
