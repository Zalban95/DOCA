# Doca Client API — Phase 1: survey and proposal

Status: **proposal, awaiting approval**. Nothing in this document is implemented.

Scope: a device-agnostic layer that exposes the Doca platform to thin clients
(smartwatch, phone companion, anything else on the tailnet). No public ingress.
Tailnet = reachability boundary; scoped tokens = authority boundary.

---

## 0. Inventory of what exists today

### 0.1 Reusable behind an adapter

| Area | Where | What it gives us | Notes |
|---|---|---|---|
| Aggregate status | `GET /api/status` (`modules/controls.js`) | containers, GPU array (temp/util/VRAM/power/fan/clocks), CPU % + per-core, CPU temp, load 1/5/15, RAM, swap, per-mount disk, disk I/O rate, net rate, uptime, procs, Ollama installed/loaded models, HF cache, llama.cpp instances | 2–6 KB JSON. Computed **per request**: 200 ms CPU sample + 4 child processes (`docker ps`, `nvidia-smi`, 2× `curl`). Dashboard polls it every 5 s. |
| Metric registry | `STATS_DEFS` (`modules/stats.js`) | 14 stat ids with `label`, `group`, `default` | Seed of a metric catalogue. Lacks units, kinds, thresholds — the 70/90 % warn/crit bands are hard-coded in `public/js/sidebar.js` (`barColor`). |
| Service registries | `INFERENCE_SERVICES` (`services.js`), llama.cpp instances (prefs), `SYSTEM_TOOLS`, `CODE_TOOLS` | Static catalogues with ids/labels | Map naturally onto "surfaces" |
| Commands | `POST /api/action`, `/api/docker/containers/:id/action`, `/api/services/start|stop`, `/api/models/llamacpp/start|stop|restart`, `/api/skills/:name/toggle`, `/api/snapshots/create`, `/api/models/ollama/pull|delete`, `/api/restart` | Every side effect a watch could plausibly trigger | Mixed styles: some JSON, some SSE progress streams, none idempotent |
| Voice | `POST /api/chat/transcribe` (multipart → Whisper `/v1/audio/transcriptions`), `POST /api/chat/synthesize` (→ Kokoro) | STT and TTS proxies | Directly reusable for the voice escape hatch and for TTS read-back of outcomes |
| Agent | `loadGatewayChatConfig()` in `chat.js` → OpenClaw gateway `/v1/chat/completions` (streaming), `claude -p` fallback | A way to ask the agent a question | Reusable to *produce* deferred outcomes server-side |
| TLS | `modules/https-cert.js` | Tailscale-issued cert (`tailscale cert`) when the CLI is present, self-signed otherwise | With the Tailscale cert the chain is publicly trusted → no cert pinning on the watch |
| Streaming primitives | `sseHeaders`, `streamCmd` (`utils.js`); `ws` dep + upgrade router (`terminal.js`) | SSE writer, WS server | Upgrade router `socket.destroy()`s unknown paths — would need a hook if we ever add WS |
| Runtime | Node ≥ 18 | `fetch`, `crypto.randomUUID`, `crypto.subtle`, `node:test` | No test infrastructure exists; `node --test` needs no dependency |

### 0.2 Absent — needs new surface

| Need | Current state |
|---|---|
| Authentication / identity | **None.** Every `/api/*` route — file write, `docker rm -f`, PTY shells — is open to any tailnet peer. No device concept. |
| Server push | SSE exists only as request-scoped command output (logs, installs, chat). No event bus, subscriptions, sequence numbers, or offline queue. |
| Durable state | `.dashboard-prefs.json`: unlocked read-modify-write from ~8 modules. Chat history is an in-memory array lost on restart. Nothing suitable for device records, hashed tokens, outboxes. |
| Typed data model | Raw JSON shaped for the sidebar; units, formatting and thresholds live in the frontend. |
| Rendering | No server-side rasteriser. No image dependency. |
| Agent → user initiative | The agent can only *answer*. Nothing lets it raise a prompt, alert or decision. |
| Versioning | None. |

### 0.3 Constraints observed in the codebase

- `express.json({ limit: '50mb' })` is global; the new layer needs its own tight limits.
- Native modules have hurt this project (node-pty ABI rebuild saga, v2.3.4–2.3.5). New dependencies should be pure JS or wasm.
- Per-request collection in `/api/status` does not scale to several always-on clients: the new layer needs one shared sampler that fans out.
- Chat history is process-global (single conversation, no per-device context). Prompts must not be built on it.

---

## 1. Transport

**Recommendation: REST + one server→client event stream, exposed as SSE, with plain polling of the same cursor as the mandatory fallback. No WebSocket.**

Three options were weighed:

| | A. REST + SSE (recommended) | B. REST + WebSocket | C. REST polling only |
|---|---|---|---|
| Radio cost while foregrounded | One idle TCP socket + 1 heartbeat / 25 s | Same | Periodic wakeups; each poll is a full request |
| Radio cost while backgrounded | Same as B: Wear OS / Android Doze kill both. Client closes the stream and polls on the platform job scheduler, or the phone relays. | Same | Native fit |
| Resume after drop | `Last-Event-ID` is part of the SSE spec; client libs (OkHttp-SSE, EventSource) do it | Must invent a cursor protocol + ping/pong + backoff | Cursor in the query string |
| Client → server | Ordinary REST (all of our upstream traffic is small, one-shot: a selection, an ack, an audio clip) | Frames | REST |
| Server work | Express route; `res.write` | Hook into existing upgrade router in `terminal.js` | Trivial |
| Latency for agent prompts | Sub-second | Sub-second | Poll interval |

The battery argument does not separate A from B: an idle socket costs the same either way, and neither survives the platform putting the app to sleep. What separates them is that SSE gives us resumable delivery for free and degrades to polling with **the same cursor and the same JSON**. WebSocket would only pay off if the client needed to stream data *up* — it does not (audio is one multipart POST).

Concretely:

- `GET /api/v1/events?since=<seq>` with `Accept: text/event-stream` → long-lived SSE stream; `id:` on every event = `seq`; `retry:` set by server; `: ping` comment every `heartbeatSec` (default 25, advertised in capabilities).
- Same URL with `Accept: application/json` → returns `{ events: [...], nextSince, retryAfterSec }` and closes. A client that cannot hold a stream just polls this.
- Reconnect policy (documented, enforced by clients): exponential backoff 1 → 2 → 4 → … → 60 s, ±20 % jitter, reset on a successful read. Server may send `retry:` to override.
- Full-refresh rule: on (re)connect the client compares `nextSince` to its own; if the server reports the cursor is older than its retained window it emits a `resync` event and the client re-fetches snapshots.

Payload ceilings (server enforces, capabilities advertises): surface snapshot ≤ 16 KB, prompt ≤ 32 KB, single event ≤ 32 KB, image ≤ 200 KB, audio upload ≤ 1 MB / 30 s.

---

## 2. Capability discovery

**Obvious answer, stated once:** a single authenticated `GET /api/v1/capabilities` that returns everything the *calling device* may see and do, already filtered by its scopes and shaped by the capabilities the device declared about itself. The client builds its UI from this and never hard-codes a surface, metric or command id.

Response outline (fully annotated in Phase 3):

```json
{
  "protocol": { "version": "1.0", "minClient": "1.0" },
  "server":   { "name": "doca", "version": "2.3.5", "time": "…" },
  "device":   { "id": "dev_7f3a", "name": "Al's watch", "scopes": ["read:*", "command:compose.restart", "interact", "profile:self"] },
  "surfaces": [ { "id": "system.cpu", "title": "CPU", "metrics": [ …typed metric defs… ], "refreshHintSec": 5 } ],
  "commands": [ { "id": "compose.restart", "title": "Restart stack", "params": {}, "confirm": true, "longRunning": true } ],
  "push":     { "url": "/api/v1/events", "heartbeatSec": 25, "retainedEvents": 500, "retainedHours": 24 },
  "render":   { "formats": ["png", "webp"], "maxImageBytes": 200000, "motionVocabulary": "1" },
  "limits":   { "snapshotBytes": 16384, "promptBytes": 32768, "audioBytes": 1048576, "audioSec": 30 },
  "profile":  { "version": 12, "etag": "…" },
  "deprecations": []
}
```

Why zero server work for a new device type: the server has **no notion of device type**. It has a device *record* — scopes, a profile, and a self-declared capability set (`screen`, `input`, `render`, `motion`, `audio`) sent at pairing and updatable later. Everything the server sends is derived from registries that already exist (`STATS_DEFS`, `INFERENCE_SERVICES`, llama.cpp instances, Docker) plus the filter of scopes ∩ declared capabilities. A new device class is a new *client*, not a new server branch.

---

## 3. Authorisation

### 3.1 Threat model (stated so the design is honest)

Today anyone on the tailnet has full authority over the host via `/api/*`. Scoped tokens on `/api/v1/*` therefore protect against a **lost, borrowed or over-trusted device**, not against a tailnet peer. The legacy surface stays as it is (non-goal to change it in this task), but the new layer is built so that gating `/api/*` behind an admin token later is a one-line middleware addition.

### 3.2 Token format — obvious answer

Opaque random bearer tokens: 32 random bytes, presented as `doca_<deviceId>.<secret>`, stored **hashed** (SHA-256) server-side. No JWTs: revocation must be immediate (delete the record), watches have unreliable clocks (JWT `exp`/`nbf` skew is a real support problem), and there is nothing to verify offline anyway — every call reaches the same server. The `deviceId` prefix makes lookup O(1) without scanning hashes.

Header: `Authorization: Bearer doca_…`. Exception: browser `EventSource` cannot set headers, so `/api/v1/events` alone also accepts `?access_token=`; the server strips it from logs.

### 3.3 Scopes

Dotted, wildcard-able strings. The set is fixed by the server and returned in capabilities.

| Scope | Grants |
|---|---|
| `read:<surfaceId>` / `read:*` | snapshot + push for that surface |
| `command:<commandId>` / `command:*` | invoke that command; confirm an outcome whose action is that command |
| `interact` | receive prompts, select, confirm |
| `profile:self` / `profile:*` | read/write own profile / any device's profile |
| `devices:admin` | pair, list, revoke, rotate, set scopes |
| `agent` | post prompts, receive selections/confirmations, post deferred outcomes |

Enforcement is in two places: a route-level middleware (`requireScope('devices:admin')`) and item-level filtering when building capabilities/snapshots (a device with `read:system.*` never sees a Docker surface, so the client never has to hide anything).

Profiles cannot exceed scopes: a profile that lists a command the device is not scoped for is stored but that command is dropped at read time and flagged in `profile.warnings`.

### 3.4 Issuing — pairing flow (obvious)

1. A device with `devices:admin` (phone) calls `POST /api/v1/devices/pair/start { name, scopes, ttlSec }` → `{ code: "482-193", expiresAt, qr: "doca://pair?…" }`. Code lives 5 min, single use.
2. The new device calls `POST /api/v1/devices/pair/complete { code, caps: {…self-description…} }` (unauthenticated — the code is the credential) → `{ token, device, capabilitiesUrl }`. The token is shown exactly once.
3. Everything after that is `Authorization: Bearer`.

Rotation: `POST /api/v1/devices/:id/rotate` (admin, or self) returns a new token and invalidates the old one after a 60 s grace so a live stream can swap. Revocation: `DELETE /api/v1/devices/:id` — token invalid on the next request, any open stream receives a `revoked` event and is closed, outbox deleted. Optional `expiresAt` on tokens for borrowed devices.

### 3.5 Bootstrapping the first admin — real trade-off, 2 options

| | Option 1: CLI issuance (recommended for Phase 2) | Option 2: dashboard auto-enrols as admin device |
|---|---|---|
| How | `npm run token -- --name phone --scopes devices:admin,read:*,command:*,interact,profile:*` prints a token once. Also `DOCA_ADMIN_TOKEN` env for systemd deployments. | On first load `public/` calls `POST /api/v1/devices/bootstrap`, allowed only while `DOCA_LEGACY_TRUST=1` (default), and stores a cookie. Settings UI gets a Devices tab. |
| Pros | No UI work; no change to legacy trust posture; scriptable | Pairing a watch is a click in the panel you already use |
| Cons | You SSH in once | Formalises "anyone on the tailnet is admin" in code; adds frontend scope to this task |

Recommend 1 now. Option 2 is a natural follow-up once the phone app exists, and nothing in the design blocks it.

---

## 4. Data model

Four nouns. Everything a client renders is one of these.

- **Surface** — a named, scoped group of metrics and commands (roughly today's sidebar card / tab): `system.cpu`, `system.memory`, `gpu.0`, `docker.containers`, `services.inference`, `models.ollama`, `agent.prompts`. Carries `refreshHintSec` and a `kind` (`metrics` | `list` | `status`).
- **Metric** — one typed value inside a surface:

  ```json
  {
    "id": "system.cpu.pct", "label": "CPU", "kind": "gauge", "unit": "%",
    "value": 37, "display": "37 %", "min": 0, "max": 100,
    "thresholds": [ { "level": "warn", "gte": 70 }, { "level": "crit", "gte": 90 } ],
    "observedAt": "2026-09-08T21:40:11Z", "ttlSec": 15, "stale": false,
    "spark": [31, 33, 40, 37]
  }
  ```

  `kind` ∈ `gauge` | `counter` | `rate` | `duration` | `timestamp` | `text` | `enum` | `boolean` | `bytes`. `unit` is a closed enum (`%`, `°C`, `B`, `B/s`, `s`, `MHz`, `W`, `count`, `""`). `display` is the server-formatted string so a dumb client can print it without knowing units. `spark` is optional, ≤ 60 points, only when the profile asks for it.
- **Item** — an element of a `list` surface (a container, a model, a service) with `id`, `label`, `state` (enum with a small fixed vocabulary: `running`/`stopped`/`error`/`unknown`), optional metrics, and the commands valid *for this item* (`docker.container.restart` with `params.id` prefilled).
- **Command** — `{ id, title, params (JSON-schema-lite), confirm: bool, longRunning: bool, scope }`. Invocation: `POST /api/v1/commands/:id { params, idempotencyKey }` → `202 { jobId }` for long-running or `200 { result }`; progress arrives as `job.progress` / `job.done` push events, so a watch never holds a stream open for an install.

Staleness is server-authored: `observedAt` + `ttlSec`; `stale: true` when the collector failed and the last good value is being served. Thresholds are server-authored per metric (moving the 70/90 rule out of `sidebar.js`), so the watch never invents a colour band.

Snapshot endpoints: `GET /api/v1/surfaces` (ids only, cheap), `GET /api/v1/surfaces/:id`, `GET /api/v1/snapshot?surfaces=a,b,c` (one round trip for a whole page; ETag). Push: `surface.update` events carry the same metric objects, only for surfaces named in the device's profile, throttled to the profile's `refreshSec`.

Server-side change required: replace per-request collection with **one sampler** (`modules/api-v1/sampler.js`) that ticks at the minimum interval any connected device asked for (floor 2 s), caches the last result, and fans out. `/api/status` can be re-pointed at it later.

---

## 5. Server push

One channel per device (§1), one envelope:

```json
{ "seq": 4182, "id": "evt_01J…", "ts": "2026-09-08T21:41:03Z", "type": "prompt.new",
  "class": "durable", "ttlSec": 3600, "priority": "high", "ack": true, "v": 1,
  "payload": { … } }
```

Two delivery classes, decided per event type, not per message:

| | `ephemeral` | `durable` |
|---|---|---|
| Types | `surface.update`, `job.progress`, `heartbeat` | `prompt.new`, `prompt.outcome`, `prompt.closed`, `alert`, `profile.changed`, `job.done`, `revoked`, `resync` |
| Offline | dropped; last-wins coalescing per surface while connected | queued in the device's outbox (ring: 500 events or 24 h, whichever first; expired by `ttlSec`) |
| Ordering | per-device `seq`, monotonic | same |
| Guarantee | at-most-once | at-least-once until acked |
| Ack | none | implicit: the `since`/`Last-Event-ID` cursor on the next connect; explicit: `POST /api/v1/events/ack { seq }` for clients that want to release server memory early |
| De-dup | n/a | client keeps a small set of recent `id`s |

Outbox persistence: append-only `.doca/outbox/<deviceId>.jsonl`, compacted on ack; survives a server restart, which matters because the dashboard self-updates and restarts.

Agent-initiated events (`prompt.new`, `alert`) originate from the agent-facing API (§7.5) and fan out to every device whose scopes and profile admit them. `priority: "urgent"` is a *hint* (client may vibrate); the server never assumes the client is awake.

Constraint worth stating: with no public ingress there is no FCM/APNs. Push works only while the client (or its phone relay) holds a stream or polls. Durable queueing is what makes that acceptable — a prompt raised while the watch slept is waiting when it wakes.

---

## 6. Rendering split

Rule: **if the user can touch it, or it has ≤ 60 discrete values, it is data. Otherwise it is an image sized for the requesting device.**

| Sent as data (client draws natively) | Sent as image (server rasterises) |
|---|---|
| Metric values, gauges, progress rings, state badges | Time series > 60 points |
| Sparklines ≤ 60 points | Multi-series / annotated charts |
| Lists, items, choice buttons, outcome text | Agent-authored diagrams, tables too wide for a watch |
| Motion vocabulary (§9) | Animated content on clients without motion support (§9 fallback) |

Image contract: `GET /api/v1/render/<kind>?…&w=&h=&dpr=&theme=&format=png|webp` with ETag; parameters default to the device's declared `screen` so a watch usually omits them. Payloads reference images as `{ "type": "image", "url": "…", "w": 320, "h": 160, "bytes": 18000, "alt": "CPU last hour" }`; for very small images (< 8 KB) the server may inline `data:` to save a round trip — the client's `render.inline` capability flag opts in.

Rasteriser — real trade-off, 3 options:

| | `@resvg/resvg-wasm` (recommended) | `sharp` | `canvas` (node-canvas) |
|---|---|---|---|
| Build | pure wasm, no native toolchain | prebuilt native binaries, falls back to compile | native, needs cairo/pango system libs |
| Input | SVG → PNG | SVG (via librsvg) → PNG/WebP/AVIF | imperative drawing API |
| Fit | server composes SVG from a template + data, one code path for charts and agent SVG; also gives us frame rendering for §9 | best encoders, but the node-pty history says avoid native | most control, worst ops story |
| Output formats | PNG only (WebP would need a second encoder) | PNG, WebP | PNG |

Recommend `@resvg/resvg-wasm`; PNG is universally decodable and 320×160 charts compress to 10–30 KB. Revisit WebP only if payload budgets bite.

---

## 7. Interaction protocol

### 7.1 Entities and state machine

A **Prompt** is agent-authored. Its lifecycle per device:

```
open ──select(option)──▶ outcome_ready ──confirm──▶ confirmed
 │                          │      ▲                 (terminal)
 │                          └─back─┘
 ├──select(voice|text)──▶ pending ──agent replies──▶ outcome_ready
 │                          └──timeout/error──▶ open (+ error notice)
 ├──dismiss──▶ dismissed        ├──expire(ttl)──▶ expired
 └──agent cancels / another device confirms──▶ closed
```

Any device targeted by the prompt sees it; the **first confirmation wins** and every other device receives `prompt.closed { reason: "confirmed_elsewhere" }`.

### 7.2 Prompt (agent → server → client, via `prompt.new` event and `GET /api/v1/prompts/:id`)

```json
{
  "id": "prm_01J8…", "createdAt": "…", "expiresAt": "…", "priority": "high",
  "title": "GPU 0 has been at 97 °C for 10 min",
  "body": [ { "type": "text", "text": "vLLM is the only tenant. What should I do?" },
            { "type": "figure", "alt": "GPU temp last 30 min", "…representations per §9…" } ],
  "choices": [
    { "id": "c1", "type": "option", "label": "Stop vLLM",
      "outcome": { "summary": "Stop container doca-vllm", "detail": "Frees 22 GB VRAM. Restart from Services later.",
                   "action": { "commandId": "services.stop", "params": { "id": "vllm" } }, "confirmLabel": "Stop it" } },
    { "id": "c2", "type": "option", "label": "Cap power to 250 W",
      "outcome": { "summary": "nvidia-smi -pl 250 on GPU 0", "action": { "commandId": "gpu.powerLimit", "params": { "gpu": 0, "watts": 250 } } } },
    { "id": "c3", "type": "voice", "label": "Tell me", "maxSec": 20, "accept": ["audio/ogg", "audio/mp4", "text/plain"] },
    { "id": "c4", "type": "text",  "label": "Type instead", "maxChars": 280 },
    { "id": "c5", "type": "dismiss", "label": "Ignore for now" }
  ],
  "resolver": "server"
}
```

`option` choices ship a **pre-supplied outcome**, so selecting one is instant and offline-safe. `voice` and `text` never do.

### 7.3 Selection (client → server)

`POST /api/v1/prompts/:id/select` — JSON, or `multipart/form-data` when audio is attached.

```json
{ "selectionId": "sel_9c1e…", "choiceId": "c3",
  "payload": { "kind": "voice", "transcript": null, "audio": "<multipart part 'audio'>", "durationMs": 6400 } }
```

`selectionId` is a client-generated UUID and the idempotency key: retrying the same body returns the same response. Payload kinds: `option` (empty), `text { text }`, `voice { audio | transcript }` — a client with on-device STT sends the transcript and no audio; the server prefers a transcript when both are present.

Response:

- `option` → `200 { "status": "outcome_ready", "selectionId", "outcome": {…same object the prompt carried…} }`
- `voice` / `text` → `202 { "status": "pending", "selectionId", "stage": "transcribing", "expectedWithinSec": 8, "pollUrl": "/api/v1/prompts/prm_…" }`

While pending the client shows progress; `stage` advances `transcribing → thinking → outcome_ready` via `prompt.progress` (ephemeral) events and is also readable from the poll URL for clients without a stream. The outcome arrives as a **durable** `prompt.outcome { promptId, selectionId, outcome }` event — never as the HTTP response to the selection.

### 7.4 Confirm / back

`POST /api/v1/prompts/:id/confirm { "selectionId": "sel_9c1e…", "decision": "confirm" | "back" }`

- `confirm`: if `outcome.action` is set, the server checks the **device** holds `command:<id>` (else `403 scope_required`), runs it (202 + job events if long-running), moves the prompt to `confirmed`, emits `prompt.confirmed` to the agent channel. Repeating the same `selectionId` + `confirm` returns `200` with the original result — never `409`.
- `back`: prompt returns to `open`, the selection is discarded, the client re-renders the choice set. Repeating is a no-op `200`.
- Confirming a `selectionId` that is not the current one → `409 stale_selection` with the current state.

### 7.5 Where outcomes for free-form input come from — real trade-off, 2 options, propose both

| | `resolver: "server"` (default) | `resolver: "agent"` |
|---|---|---|
| Mechanism | Server transcribes (existing Whisper proxy), then calls the OpenClaw gateway `/v1/chat/completions` with the prompt context + transcript and a system instruction to answer with an outcome JSON object (strict schema, retried once on parse failure) | Server emits `prompt.selected { promptId, selectionId, transcript }` on the agent's event stream; the agent posts `POST /api/v1/agent/prompts/:id/outcome { selectionId, outcome }` |
| Agent-side work | none — works with today's gateway config | an OpenClaw skill/tool that subscribes and replies |
| Latency | one LLM call | agent's own loop |
| Fit | alerts the dashboard raises itself, simple decisions | rich agent workflows where the agent already has state |

The agent-facing API (`agent` scope): `POST /api/v1/agent/prompts` (idempotent on the agent-supplied `id`), `DELETE /api/v1/agent/prompts/:id` (cancel), `POST /api/v1/agent/alerts`, `POST /api/v1/agent/prompts/:id/outcome`, and the same `GET /api/v1/events` stream carrying `prompt.selected`, `prompt.confirmed`, `prompt.dismissed`, `prompt.expired`. The agent is simply a device whose scopes include `agent`; its token is issued like any other.

---

## 8. Device profiles

Server-side, per device, versioned, written by the phone, followed by the watch.

```json
{
  "version": 12, "updatedAt": "…", "updatedBy": "dev_phone",
  "refreshSec": 10, "quietHours": { "from": "23:00", "to": "07:00", "allowUrgent": true },
  "pages": [
    { "id": "home",  "surfaces": [ { "id": "system.cpu", "metrics": ["system.cpu.pct", "system.cpu.temp"], "spark": true },
                                    { "id": "gpu.0",      "metrics": ["gpu.0.temp", "gpu.0.util"] } ] },
    { "id": "stack", "surfaces": [ { "id": "docker.containers", "commands": ["docker.container.restart"] } ] }
  ],
  "commands": ["compose.restart", "services.stop", "docker.container.restart"],
  "prompts": { "receive": true, "haptic": true, "allowVoice": true }
}
```

This is *what* and *in which order*, not how it looks — layout and styling stay the client's business, per the non-goals. `commands` is intersected with the token's scopes on read (§3.3).

Endpoints: `GET /api/v1/devices/me/profile` (any device; ETag), `PUT /api/v1/devices/:id/profile` with `If-Match` (optimistic concurrency; `412` on mismatch) needing `profile:self` for own or `profile:*` for others. Every successful PUT bumps `version` and emits a **durable** `profile.changed { version, etag }` to the target device; the client re-fetches and re-renders without restart. If the target is offline the event waits in its outbox, and on reconnect the capabilities call also reports the current profile version, so a client cannot miss an update. The phone learns the watch's declared capabilities (screen shape, size, inputs) from `GET /api/v1/devices/:id` so it can author sensibly.

---

## 9. Motion and rich graphics

Premise accepted: no runtime SVG or SMIL on the watch; WebView is off the table.

### 9.1 Content is authored once, with alternates

Every rich block in a prompt body or alert is a `figure` with an ordered list of representations. The **server**, not the client, picks the best representation the device declared it can render, and sends only that one — so the watch payload never carries an SVG string it cannot use.

```json
{ "type": "figure", "alt": "VRAM draining as vLLM unloads",
  "representations": [
    { "kind": "svg",    "svg": "<svg …><animate …/></svg>" },
    { "kind": "motion", "vocab": "1", "scene": { … §9.2 … } },
    { "kind": "sprite", "url": "/api/v1/render/figure/fig_…?w=200&h=200&frames=12", "frames": 12, "fps": 8, "w": 200, "h": 200 },
    { "kind": "image",  "url": "/api/v1/render/figure/fig_…?w=200&h=200", "w": 200, "h": 200 },
    { "kind": "text",   "text": "VRAM 22 GB → 0 GB over 4 s" }
  ] }
```

Device capability flags: `render.svg`, `render.svg.smil`, `render.motion.1`, `render.sprite`, `render.image`, plus `screen: { w, h, shape: "round"|"square", dpr }`. Selection order is the list order filtered by flags; `text` is always present as the floor.

### 9.2 Motion vocabulary v1 (data, mapped to native animation)

Deliberately tiny — five primitives the agent can author and any client can map to `ValueAnimator` / Compose `animate*AsState` / CSS transitions:

| Primitive | Fields | Native mapping |
|---|---|---|
| `morph`   | `metric`, `from`, `to`, `durationMs`, `easing` | number tween on a displayed value |
| `ring`    | `from`, `to` (0–1), `durationMs`, `color` role | arc progress |
| `reveal`  | `target` block id, `mode: fade|slide-up|slide-in`, `durationMs`, `delayMs` | alpha / translate |
| `pulse`   | `target`, `count`, `periodMs` | scale/alpha keyframes |
| `sequence`| ordered list of the above | chained animators |

`easing` ∈ `linear` | `ease-in` | `ease-out` | `ease-in-out` | `spring`. Colours are **roles** (`ok`, `warn`, `crit`, `accent`, `muted`), never hex — the client themes them. Unknown primitive → the client drops that track and keeps the rest; the server never sends vocab `2` primitives to a client that declared `render.motion.1`.

### 9.3 How to derive the degraded forms — real trade-off, 3 options

| | Option A: server renders everything (recommended) | Option B: phone companion rasterises SVG and pushes frames to the watch | Option C: motion vocabulary only, no SVG at all |
|---|---|---|---|
| Path | Agent supplies `svg` and/or `motion`. Server rasterises SVG (resvg-wasm) to a static PNG and, for animated SVG, samples N frames into a sprite sheet. Motion scenes are passed through to motion-capable clients. | Watch payload references the SVG; phone app fetches, rasterises with Android's real renderer, relays bitmaps over the Wearable Data Layer. | Agent may only author the vocabulary; charts are static PNG. |
| Works with no phone present | yes | **no** — watch alone gets the text floor | yes |
| Server work | resvg + a frame sampler (SMIL `animate` on a small attribute subset, or `motion` → frames) | none beyond serving SVG | none |
| Fidelity on watch | sprite ≤ 12 frames, ~50–150 KB | full, but Data Layer relay costs battery on both devices | native, smooth, tiny payload |
| Risk | SMIL sampling is a partial implementation; we cap it to `animate`/`animateTransform` on `opacity`, `transform`, `r`, `width`, `height`, `stroke-dashoffset` | couples the protocol to a companion topology the task says not to assume | agents lose free-form drawing |

Recommend **A with C's vocabulary as the primary authoring target**: agents describe motion in the vocabulary when they can (cheap, native, degrades to a single frame trivially) and attach SVG only for genuinely free-form figures; the server derives sprite/PNG/text from whichever it has. B remains possible later purely as a client-side optimisation — the protocol already exposes `svg` to any client that declares `render.svg`.

---

## 10. Versioning

- **Path major, additive minor.** `/api/v1/…` never removes or retypes a field. `protocol.version: "1.x"` in capabilities is bumped for additive changes; a new major is a new path.
- **Clients declare, server tailors.** At pairing and via `PATCH /api/v1/devices/me { caps, protocol: { max: "1.3" } }` the device states what it can render and the highest minor it understands. The server never emits an event type, block kind, choice type or motion primitive introduced after the client's declared minor. Absent a declaration, the server assumes the minor that existed when the device paired.
- **Client rules (documented in `PROTOCOL.md`):** ignore unknown fields; ignore unknown event types; treat unknown `choice.type` as unsupported (do not render it); `text` representation and `display` strings are always present as floors.
- **Deprecation signalling:** `Deprecation` + `Sunset` response headers, mirrored in `capabilities.deprecations[]`, minimum one minor version of overlap.
- **Envelope `v`** on every push event so a stream can carry mixed versions during a rollout.
- `X-Doca-Client: <name>/<version>` on every request, logged, so a stale install can be spotted before it breaks.

---

## 11. Proposed Phase 2 shape (for sizing, not approval of details)

- New directory `modules/api-v1/`: `store.js` (atomic JSON files under `.doca/`, replaces ad-hoc prefs writes for this layer only), `auth.js`, `devices.js`, `scopes.js`, `bus.js` + `outbox.js`, `sampler.js`, `surfaces.js` (adapters over existing collectors/registries), `commands.js` (adapters over existing handlers, idempotency + jobs), `prompts.js`, `profiles.js`, `render.js` (resvg-wasm), `motion.js`, `capabilities.js`, `router.js` mounted at `/api/v1` from `server.js`. No changes to existing routes.
- `bin/doca-token.js` for admin issuance (`npm run token`).
- Reference client: `clients/reference/` — bash + curl + jq scripts covering pairing, capabilities, snapshot, stream, command, and the full prompt cycle including a voice selection with an asynchronously delivered outcome; plus a tiny Node script that acts as the agent.
- Tests: `node --test` (no new dependency) for scope enforcement, idempotency, outbox replay/ack/ttl, profile propagation, representation selection. Adds `npm test`.
- New dependency: `@resvg/resvg-wasm` only.

---

## 12. Decisions needed before Phase 2

| # | Decision | Recommendation |
|---|---|---|
| D1 | Transport | REST + SSE with polling fallback on the same cursor; no WS (§1) |
| D2 | Admin bootstrap | CLI token issuance now; dashboard enrolment later (§3.5) |
| D3 | Rasteriser | `@resvg/resvg-wasm`, PNG only (§6) |
| D4 | Deferred-outcome resolver | support both; `server` default, `agent` opt-in per prompt (§7.5) |
| D5 | Motion strategy | server-side derivation, vocabulary as primary authoring target, SVG passthrough for capable clients (§9.3) |
| D6 | Command authority on confirm | confirming device must hold `command:<id>`; agent-side effects need only `interact` (§7.4) |
| D7 | Multi-device prompts | first confirmation wins, others get `prompt.closed` (§7.1) |
| D8 | Payload ceilings | 16 KB snapshot / 32 KB prompt & event / 200 KB image / 1 MB · 30 s audio (§1) |

---

## 13. Addendum — approved with additions (implemented in Phase 2)

The proposal was approved with the following additions, all of which are now in `PROTOCOL.md` and the implementation:

| Addition | How it landed |
|---|---|
| Device-agnostic until the device declares a form factor; glasses with camera/mic and no display must coexist with a watch | `caps.formFactor` is self-declared and every `caps` section is optional (`screen` may be absent). Choice types, representations and defaults derive from abilities, never from the form factor. |
| Input images | Third free-form choice type `image` (multipart upload or `mediaId`), generic `POST /media`, images forwarded to the gateway as vision content parts by the server resolver, or to the agent as `mediaUrl`. |
| A field for general variables / unforeseen data the agent can parse directly | Opaque `ext` object accepted and forwarded on every message type (≤ 8 KB) and a per-device `vars` document (`PATCH /devices/me/vars`, `device.vars` events to agents). |
| All sensor data the device can offer, collected only when relevant | Open sensor vocabulary declared in `caps.sensors`; agent-initiated, time-bounded `sensor.request` with rate/duration; profile `sensors.allow` as the consent list; `autoReport` for cheap always-on values; batched `POST /sensors/samples`. Nothing is collected without a request. |
| Any access from the device must be possible; e.g. collect sensor data, compute on a server the agent just made, hand back "a small js or anything" | `artifacts`: agent uploads a runtime-tagged payload (js, wasm, lua, …) and delivers it only to devices declaring that runtime in `caps.exec`; `agent.message` / `device.message` free-form channels for anything else. |

All eight D-decisions were taken as recommended.
