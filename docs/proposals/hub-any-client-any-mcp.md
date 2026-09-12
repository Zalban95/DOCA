# Doca as the hub — one agent, many clients, every MCP

Status: **proposal, awaiting approval**. Nothing in this document is implemented.
Companion to `client-api-phase1.md`, which built the layer this one extends.
Every "exists today" claim below was checked against code, not docs — including
two claims in the phase-1 proposal that have since stopped being true.

The goal in one sentence: **Doca is the agent; every other thing — phone, watch,
Windows desktop, browser — is an input and an output for it, and from any of them
you can reach any MCP server the hub knows about.** A client is not a smaller
dashboard; it is a microphone, a screen and a pair of hands. The watch is not a
special case, it is simply the smallest client.

---

## 0. What exists today

| Capability | Where | Reachable by a paired device? |
|---|---|---|
| Snapshots, metrics, push | `modules/api-v1/{surfaces,live,bus}.js` | **Yes** — `read:*` |
| Commands, confirm, params | `modules/api-v1/commands.js` | **Yes** — `command:*` |
| Prompts, choices, free-form answers | `prompts.js` + `agent-bridge.js` | **Yes** — `interact` |
| Voice **in**, inside a prompt answer | `prompts.js:309-347` → whisper | **Yes** — `interact` |
| Chart PNG, sized to the device screen | `render.js`, `router.js:418-432` | **Yes** — `read:<surface>` |
| Agent-authored SVG → PNG poster or sprite sheet | `render.js:135-269`, `router.js:436-448` | **Yes** |
| Media upload (audio, images) | `media.js`, `router.js:369-375` | **Yes** — `media:upload` |
| On-demand sensor samples, agent-initiated | `sensors.js:38-68` | **Yes** — `sensors:report` |
| A device registering **itself** as an MCP server | `/api/v1/mcp/self`, `/mcp/offer` | **Yes** — `mcp:self` |
| The agent itself: conversation, tools, memory | `/api/harness/*` (`modules/harness/*`) | **No** |
| MCP servers other than the caller's own | `/api/mcp/*` (`modules/mcp/*`) | **No** |
| Voice **out** (TTS) | legacy `POST /api/chat/synthesize` → kokoro | **No** — unauthenticated dashboard route only |
| A list of running / recently finished jobs | `jobs.js` has `GET /jobs/:id` only | **No** |

Corrections to `client-api-phase1.md`: there **is** a server-side rasteriser now
(`@resvg/resvg-wasm`, `render.js:3-5`) and there **is** durable device state
(`store.js`, `DOCA_DATA_DIR`). Plan around them, not around their absence.

Two facts decide most of this document:

1. **The harness has no device-facing surface.** `/api/harness/chat` is a legacy
   dashboard route with no scope middleware, and `scopes.js` has no `harness`
   family at all. `agent-bridge.js` is not a counter-example: it resolves *one*
   prompt answer into *one* command. No session, no tools, no memory.
2. **The `mcp` scope family means exactly one thing: `self`** — "the MCP server
   *this device itself hosts*". Listing, starting or using anyone else's server is
   dashboard-only.

DocaDesk closed the last mile on Windows: it hosts a listener and runs local
stdio MCP servers whose tools it forwards (`src/DocaDesk.Mcp/`). Those tools
still only reach the agent through the dashboard, because of fact 1.

---

## 1. What is missing

- **A. A device-facing agent conversation** — sessions, streamed replies, tool
  calls, the same memory and the same safety charter as the dashboard console.
  Nothing else here is reachable by voice without it.
- **B. A device-facing MCP surface** — which servers exist, their state, their
  tools, **where** each one lives; start and stop them.
- **C. Location as a first-class property.** When a filesystem server runs both
  on the hub and on the studio PC, the agent must be able to ask "on which
  machine?" rather than guess.
- **D. Client-hosted tools that work on a phone.** DocaDesk can host an HTTP
  listener because Windows lets it. Android cannot: Doze closes sockets and there
  is no stable inbound address. The transport has to invert for those clients.
- **E. A conversation that is multimodal and observable** — images and audio in,
  thinking and typing visible, and visible on *every* client at once, not only
  the one that asked.

---

## 2. The first design decision: how the hub reaches a client's tools

| | A. Client hosts, hub dials | B. Hub dispatches over the client's event stream | C. Client uploads tools and polls |
|---|---|---|---|
| Windows desktop | Yes — implemented (DocaDesk) | Yes | Yes |
| Android / Wear | **No** — no stable inbound address, Doze closes listeners | Yes — reuses the stream it already holds | Yes, wasteful |
| New protocol surface | None | One event type + one result route | Poll route + cursor |
| Reachability assumptions | Must be dialable on the tailnet | None beyond what push already needs | None |

**Recommendation: keep A for clients that can host, add B for clients that
cannot.** From the harness's point of view they are the same thing — a named
server contributing tools — and differ only in who dials.

For B: the hub emits `mcp.call` on the device's existing `/api/v1/events` stream
with `{callId, server, tool, arguments}`; the client answers
`POST /api/v1/mcp/calls/:callId/result` with MCP content blocks. A device
declares what it offers by extending the `mcp/self` document it already owns:
today it says "here is my URL", tomorrow it may say "here are my tools, call me
through the stream". A hub-side timeout turns a sleeping phone into a tool error,
which is what the agent should see anyway.

This is what makes the watch "just another client": it declares `speak` and
`ask`, and hosts nothing.

---

## 3. The second design decision: the conversation is a bus, not a response body

Today one HTTP request owns one answer: `POST /api/harness/chat` streams the
reply to whoever asked (`routes.js:74-83`). That cannot serve this ecosystem —
if you ask by voice on the watch and then raise your wrist, the answer is gone;
and the phone in your pocket never knew a turn was happening.

**So: posting a message and receiving the turn are separate.**
`POST /api/v1/agent/messages` returns `{turnId, seq}` immediately, and the turn
is published on the existing event bus, which is already cursor-based, resumable
and multi-subscriber (`bus.js`). Every client subscribed to the session sees the
same turn; a client that reconnects replays from its cursor.

That single change is what buys the three things asked for:

| Want | Event | Notes |
|---|---|---|
| Typing | `agent.turn` `{turnId, state: "started"｜"streaming"｜"done"}` | Any client can render "Doca is typing" for a turn it did not start |
| Thinking | `agent.thinking` `{turnId, text?}` | Name follows the existing `prompt.progress {stage:"thinking"}` (`prompts.js:350`) |
| Tool visibility | `agent.tool` `{turnId, name, phase, step}` | The harness already emits `tool_call`/`tool_result` internally |
| Reply text | `agent.text` `{turnId, delta}` | Ephemeral deltas; the final message is durable |

> **AS BUILT (2026-09-13).** Three of these four shipped. `agent.turn` has states
> `started｜done｜failed` — no `streaming`, because the deltas already say that and
> a state nobody sets is a lie in a table. **`agent.thinking` was not added: the
> harness has no producer for it.** `agent.js` emits `session｜text｜tool_call｜
> tool_result｜proposal`, and nothing about a model's reasoning; an event type
> declared with no caller would advertise a capability that does not exist (§9).
> It needs a step-boundary emit inside `agent.js` first — FUTURE, with phase 2.
> `state: failed` was added instead, because a turn that dies has no response body
> left to report into.

Ephemeral vs durable matters for battery: a watch subscribes to `agent.turn` and
the final message only, and never receives per-token deltas it cannot read
anyway. The phone, foregrounded, takes the deltas.

> **AS BUILT.** Stronger than specified: `agent.text` is published **only to the
> device that posted the message**, because the bus has no per-type subscription —
> a watch cannot decline deltas, it can only receive and discard them, which is
> exactly the radio time this was meant to save. The device with a screen open
> streams; everyone else gets `started`, the tool steps, and the whole reply on
> `done`.

### 3.1 Multimodal input

Images: the harness builds plain string content today (`agent.js:78-84`,
`:221`). The `image_url` block pattern already exists two files away in
`agent-bridge.js:48-50` — copy it, do not invent it. Audio: transcribe with
whisper *before* the model, exactly as the prompt path already does
(`prompts.js:342-347`), so the harness stays text-and-images and the transcript
is what lands in memory. Both arrive as `mediaId` references from
`POST /api/v1/media`, which already accepts and classifies audio and images.

Voice out needs one new route, because TTS today is an unauthenticated dashboard
route: `POST /api/v1/synthesize` (scope `interact`) proxying kokoro the way
`chat.js:297-325` already does.

---

## 4. Proposed surface

### 4.1 Scopes (`modules/api-v1/scopes.js`)

| New scope | Grants |
|---|---|
| `harness:chat` | Post messages, subscribe to turns |
| `harness:sessions` | List/create/switch/delete own conversations |
| `harness:memory` | Read the agent's durable memory (write stays a click) |
| `mcp:read` | List servers, state, tools, location |
| `mcp:control` | Start/stop a server a human has already admitted |
| `mcp:call` | Invoke a tool directly, without going through the agent |

Presets: `phone` gains `harness:chat`, `harness:sessions`, `mcp:read`,
`mcp:control`; `watch` gains `harness:chat` only — a watch asks the agent, it
does not administer servers.

**`mcp:define` deliberately does not exist.** A server definition is a command
line; only a human at a keyboard may create one. Same reason `mcpServers` is
absent from the harness's `SETTABLE` list (`AGENTS.md`), same reason DocaDesk's
local registry is UI-only. A device may *operate* what a human admitted, never
widen it.

### 4.2 Routes

> **CORRECTION (implemented 2026-09-13).** These went in under `/api/v1/harness/*`,
> not `/api/v1/agent/*`: `POST /api/v1/agent/messages` **already existed** as the
> agent-facing fan-out (`router.js`, scope `agent`, agent → devices). One prefix
> for both directions, with opposite scopes, is a trap for whoever reads it next.
> `/api/v1/harness/*` is a device asking the agent; `/api/v1/agent/*` is the agent
> acting on devices. The scope family was `harness:*` from the start, so the
> prefix now matches it. Implemented surface, normatively documented in
> `PROTOCOL.md` §23: `POST /harness/messages`, `GET /harness/turns`,
> `GET|POST /harness/sessions`, `GET|DELETE /harness/sessions/:id`,
> `POST /harness/sessions/:id/activate`, `GET /harness/memory`.
> Two additions the spec below did not have: `/harness/turns`, because a client
> that opens mid-turn should not have to wait for an event to know one is running,
> and `409 turn_in_flight`, because two devices posting into one conversation
> would interleave one transcript.

```
POST   /api/v1/agent/messages            → 202 {turnId, sessionId}   (harness:chat)
GET    /api/v1/agent/sessions            → list                      (harness:sessions)
POST   /api/v1/agent/sessions            → create / activate
GET    /api/v1/mcp                       → servers[] with host        (mcp:read)
POST   /api/v1/mcp/:id/action            → start | stop               (mcp:control)
POST   /api/v1/mcp/:id/tools/:tool       → call                       (mcp:call)
POST   /api/v1/mcp/calls/:callId/result  → 204                        (mcp:self)
POST   /api/v1/synthesize                → audio/mpeg                 (interact)
GET    /api/v1/jobs?active=1&limit=      → jobs[]                     (read:* | own)
```

`/api/v1/agent/*` is a thin adapter over `modules/harness/*`, not a second
harness: same `systemPrompt()` order, same charter, same
proposals-need-a-click rule. Whoever implements it updates `openapi.js` and
regenerates `docs/api/openapi.json`, or `test/openapi.test.js` fails — which is
the point.

### 4.3 A server record gains a location

```json
{ "id": "desk-fs", "label": "Files (studio PC)", "state": "running",
  "host": { "kind": "device", "deviceId": "dev_8f2…", "name": "STUDIO-PC" },
  "tools": ["read_file", "write_file"] }
```

`host.kind` is `hub` or `device`. The agent's tool names already carry the server
(`mcp__desk-fs__read_file`, ≤ 64 chars — `registry.slug()`), so *where* is
answerable without a lookup, and the harness can ask "the hub or STUDIO-PC?"
through the prompt mechanism that already exists.

### 4.4 Missions, and the jobs underneath them

A **mission is an instance the harness manages**: a named piece of work with an
id, a title, a state, a history and an outcome, which may outlive a single
conversation turn and may run several commands on the way. A **job** stays what
it is today — one execution of one long-running command. A mission is the thing a
human recognises; a job is a step inside it. The watch tile shows missions.

Two properties are required, not optional:

- **File-backed and hand-editable.** A mission lives under
  `DOCA_DATA_DIR/harness/missions/` as plain JSON, next to the conversations,
  memory and proposals that are already there. A human may open one and change it
  by hand, and the harness must re-read rather than cache it away. This is the
  same both-sides-may-write arrangement as memory rules (`memory.rules()`,
  `memory_rules_write` for the agent, the **Rules** modal for the user) and it
  works for the same reason: the file *is* the state, not a cache of it.
- **The agent may drive a mission, not authorise one.** Creating, advancing and
  closing a mission is ordinary agent work. Anything a mission *does* still goes
  through the existing gates — a command needs its scope, a setting still needs a
  click on a proposal. A mission is a plan with a memory, not a permission.

`jobs.js` today: `GET /jobs/:id` only, in-memory, capped at 200 with no time
window, no human title, and created **only** by the four `longRunning` commands
(`commands.js:33-46`). A harness turn creates nothing at all, so missions are
invisible to every client. In order: add `title`/`summary` to a job record
(joining `commandId` → `commands.describe().title` is not the watch's work); add
`GET /api/v1/jobs?active=&limit=`; add `missions` as a harness-owned store with
`GET /api/v1/missions` and a `mission.update` event. `job.progress` stays
ephemeral and `job.done` stays durable, so a watch that was asleep still learns
the outcome.

---

## 5. Consent stays a three-gate system

1. **On the device.** DocaDesk's per-server "Allow its tools"; the phone's
   sensor allowances. Off by default, local, not remotely settable.
2. **On the hub.** A human accepts an offered server once
   (`POST /api/mcp/offers/:id/accept`). Unchanged.
3. **In the harness.** The per-tool disable list in the ⚙ panel.

`mcp:control` sits *inside* those gates: it starts a server that is already
admitted and already consented. It cannot admit, define or consent to one.

---

## 6. The watch: server-drawn page, or fixed native layout?

This is the question that was actually asked, and the honest answer is that both
options as stated are traps, and the protocol already contains the way out.

| | Root A: hub sends a watch-sized page as an image | Root B: fixed native layout fed with data |
|---|---|---|
| New feature needs a watch release | No | **Yes** |
| Battery / bytes | 20–200 KiB per view, re-fetched on every change | ~1–3 KiB JSON, cursor-based |
| Interaction | A bitmap has no gestures, no scroll, no targets | Native everything |
| Legibility, ambient, accessibility | Fixed at render time; no font scaling | Free |
| Offline | Nothing to show | Last snapshot still renders |
| Exists today | Only charts and agent-authored SVG figures | The whole capability document |

**Recommendation: three tiers, in this order.**

1. **Declarative surfaces (the default).** The capability document is already a
   layout language: `surfaces[].metrics[]` carry `kind`, `unit`, `min`, `max` and
   `thresholds[{level,gte}]`; `commands[]` carry typed `params`. The watch ships
   *generic renderers per kind*, not per feature. A new metric or surface on the
   hub appears on the watch with **no watch release** — which is where the
   "almost absolute versatility" actually comes from, at root B's battery cost.
2. **Rendered image (the density valve).** When something cannot be expressed as
   metrics — a chart, a screenshot from DocaDesk, a diagram the harness composed
   — the hub sends a PNG. `GET /render/chart` does multi-metric charts today,
   sized from `caps.screen` and capped at 200 KiB; `GET /render/figure/:id` turns
   **agent-authored SVG** into a PNG poster or a sprite sheet. That second route
   is root A, already built, and it is the right amount of root A: the harness
   composes a picture *when a picture is the answer*, rather than every screen
   becoming a bitmap. Fetch only on an explicit user action.
3. **Chat (the universal escape hatch).** Whatever no layout can express, you
   ask for: voice in via whisper, answer as text plus TTS, images out as `image`
   blocks. This is why phase 1 is phase 1.

**The invariant that keeps tier 1 versatile:** the watch must never enumerate
feature names. Unknown metric kind → render as number plus unit. Unknown block
type → render its text (which `PromptScreen.kt:110-116` already does; keep that
instinct). Unknown command → show its title and params generically. Any screen
that hard-codes a feature is a bug, because it converts a hub-side addition into
a watch release.

One thing to avoid: **artifacts are not the display path.** `artifacts.js` gates
delivery on `caps.exec` runtimes — it is for payloads a device *executes*. A PNG
for a human to look at is an `image` block (url) or a `media` block (mediaId).

### 6.1 Linking the watch with as few steps as possible

The pieces exist and are not connected. `:wear-bridge` in DocaMobile defines the
message paths (`/doca/pair/offer`, `/pair/result`, `/relay/event`, `/relay/ack`,
`/state`, `/request`) and `DocaWear` already receives an offer, completes pairing
itself and stores its own token in the Keystore. **But nothing in DocaMobile's
`:app` ever calls the bridge** — `sendPairOffer`, `publishPhoneState` and
`sendRelayEvent` have zero callers — and the two sides disagree on field names:
the phone writes `pairCode`/`certPin`, the watch reads `code`/`pin`. Wiring it up
without fixing that would fail silently with an empty code.

The flow, which needs no new protocol work on the hub:

1. Both apps declare a Wearable **capability** (`doca_wear_app`,
   `doca_phone_app`) in `res/values/wear.xml` and discover each other with
   `CapabilityClient`. Neither app does this today; it is why nothing is
   automatic.
2. On sign-in the phone notices a watch node and offers to link it. The phone
   holds `devices:admin` in its preset, so it can mint the watch's pairing code
   itself with the `watch` preset — the user taps once.
3. The phone sends `{code, baseUrl, pin}` over `/doca/pair/offer`; the watch
   completes pairing and gets **its own** token. The phone's token never crosses
   the Data Layer — that rule is already right, keep it.
4. If the watch is later unpaired from the phone, it keeps working standalone
   over its own token while the server is reachable.

### 6.2 The tile: active jobs and recent missions

`DocaTileService` exists as a static placeholder. Two rules for what replaces it:
a tile does **no network I/O** — it renders the last `/doca/state` DataItem the
phone published, which is exactly what `publishPhoneState()` was written for and
never used; and it shows **counts and one line of text**, never an image. Content:
active jobs with titles, and the last few finished missions with their outcome —
which is why §4.4 exists.

### 6.3 Battery

- **The watch does not hold the stream when the phone is present.** The phone's
  `PushService` (foreground, `dataSync`) plus `PushLoopEngine` already holds it
  with a watchdog and backoff; `sendRelayEvent()` exists to forward. Wire the
  relay, and keep the watch's own `PushEngine` (which already has a 50 s watchdog
  and backoff) for standalone mode only.
- **Deltas do not go to the wrist.** Per §3, a watch subscribes to turn state and
  final messages.
- **Images on demand only.** Never as part of a tile refresh or a push payload.
- **Use the server's numbers.** `push.backoff` is advertised in capabilities;
  both clients currently hard-code their own.

### 6.4 Permissions

Neither app requests a single runtime permission today. The phone declares
`POST_NOTIFICATIONS` and `RECORD_AUDIO` and asks for neither; the watch declares
`WAKE_LOCK` and `VIBRATE` and uses neither, while declaring `heartRate` and
`voice` in its capability document that it cannot actually deliver.
`accompanist-permissions` is already a dependency with no usages.

The rules worth writing down:

- Ask at first use, with the reason on screen — notifications when the first
  prompt would be delivered, microphone on the first voice tap, body sensors when
  the agent first requests heart rate. Never a wall of prompts at launch.
- **A denied permission must shrink the capability document.** `caps.sensors` and
  `profile.sensors.allow` are what the hub checks before it asks
  (`sensors.js:38-68`), so a device that lost microphone access must
  `PATCH /devices/:id` to stop advertising `voice`. Failing later is a bug; not
  advertising is the design.
- The phone cannot grant the watch's permissions. It can explain, and it can
  deep-link — nothing more. Two apps, two consent surfaces.

---

## 7. Phases

| Phase | Delivers | Unlocks |
|---|---|---|
| 1 — **DONE 2026-09-13** | `/api/v1/harness/*`, `harness:*` scopes, turns on the bus | Chat with Doca from phone and watch; typing and tool steps on every client |
| 2 | Images + audio in, `POST /api/v1/synthesize` | Talk to it and be answered out loud; show it a screenshot |
| 3 | `GET /api/v1/mcp` + `mcp:read` | "What can you reach right now?" |
| 4 | `POST /api/v1/mcp/:id/action` + `mcp:control` | Start the desktop's filesystem server by voice |
| 5 | `host` on server records, agent disambiguation | "On which machine?" |
| 6 | Missions as a harness-owned store, jobs list and titles | The watch tile: active missions and recent outcomes |
| 7 | Wear auto-link, relay transport, tile, permissions | The watch stops being a second-class client |
| 8 | Inverted MCP transport (`mcp.call` + result route) | Phone and watch tools; sensors as tools |

Phase 1 is worth doing first even alone: it is the difference between clients
that watch Doca and clients that talk to it.

---

## 8. What each repo has to do

**DOCA (this repo).** All of §3 and §4. Phase 1 is done: `modules/api-v1/harness.js`
adapts the existing harness, turns are published on `bus.js`, the scopes and the
`Harness` tag are in `scopes.js` and the OpenAPI document, and
`test/harness-client.test.js` covers it against a scripted stub model (no key, no
network). Still open here: `host` on the MCP record; jobs list and titles; scoped
transcribe/synthesize; media in a turn. Do not fork the harness, do not move the
charter, do not let a scope bypass proposals-need-a-click.

**DocaDesk.** The reference host client: listener, offer/accept reconciliation,
and a local stdio registry forwarding Windows-local servers. Remaining: report
`host` in its offer; a `screenshot`-to-`media` path so the harness can send a
desktop capture to the phone; and an agent console once §4.2 exists, so the
desktop stops needing the WebView for chat.

**DocaMobile.** Native monitoring is wired (capabilities, snapshots, push). Next:
an agent chat screen on `/api/v1/harness/*` with images and audio (phase 1–2); use
the server's `push.backoff`; **wire `:wear-bridge`, which nothing calls today**,
and fix the `pairCode`/`certPin` vs `code`/`pin` mismatch; request the two
permissions it already declares; use the `coil` dependency it already has for
rendered images. The WebView stays a full-dashboard escape hatch, not the home.

**DocaWear.** No new protocol work, and its README claiming "not yet scaffolded"
is stale — pairing, home, prompt and settings screens exist. Next: wire the
`PushEngine`, `SensorEngine` and `MotionEngine` that are already written and
unreferenced; a real tile from the phone's `/doca/state`; generic renderers per
metric kind rather than per feature; voice in and TTS out once phase 2 lands;
`RecognizerIntent` plus the microphone permission it never declared. It should
never hold `mcp:control`.

---

## 9. Keeping four repositories maintainable

Organisation is a feature here: four repos, one protocol, and agents working in
all of them. The arrangement is now uniform.

| File | In every repo | Holds |
|---|---|---|
| `AGENTS.md` | yes | What the thing is, how to run and test it, and the **invariants with the reason each one exists** — plus an "environment gotchas (not bugs)" section, because most first-run states here look like failures |
| `TODO.md` | yes | Known rough edges, deliberately deferred, each with `file:line` and an honest reason |
| `.agent/NEXT.md` | the two Android repos | The ordered, actionable next block with acceptance criteria, so a fresh agent in Android Studio can start without re-deriving context |
| `docs/proposals/*.md` | this repo | Design and future goals, as numbered phases |

Three rules that come out of writing those files:

1. **Never document intent as fact.** All three client repos had documentation
   describing features that were only written, never wired — `:wear-bridge` has no
   callers, DocaWear's `PushEngine` is never instantiated, DocaWear's README
   claimed the project was "not yet scaffolded" while shipping four screens. A
   doc that cannot be trusted is worse than no doc, because it stops people from
   reading the code.
2. **Code that exists for a future phase says so**: `// FUTURE(phase N): …`, so
   one grep answers "what is staged but not live?". The same applies to a
   dependency added ahead of its use — say which phase it is for, or delete it.
3. **A class with no callers is not a feature.** If it must stay, mark it
   `FUTURE(phase N)`; otherwise it reads as working code to every future agent.

---

## 10. Open questions for the human

1. **Watch streaming.** Turn state plus a final answer with TTS is the battery
   choice; token-by-token on the wrist costs a held connection. Confirm?
2. **One conversation or one per device?** Should the phone share the desktop's
   active session (continuity) or hold its own (privacy)? The bus design supports
   either; the presets differ.
3. **Ambiguity policy.** When several MCP servers match, always ask, or prefer
   the device the request came from and say what was chosen?
4. **Direct tool calls.** Is `mcp:call` wanted at all, or should every tool use
   go through the agent so it is always in the transcript?
5. **Mission vocabulary.** Is a "mission" exactly one harness turn, or a named
   thing that can span several? The tile in §6.2 reads better with the second,
   which needs a name and a lifecycle the harness controls.
