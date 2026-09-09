# Doca client API — developer documentation

Everything a developer needs to talk to a Doca host from a watch, a phone, a pair
of glasses, a kiosk, a script, or an agent. The API lives at
`https://<host>:4242/api/v1`, is reachable only inside your tailnet, and is the
**single door** for every device: data, commands, dialogue with the agent, sensors,
uploads, code delivery.

## Start here

| I want to… | Read |
|---|---|
| see it work in ten minutes with `curl` | [Getting started](getting-started.md) |
| build the app that runs **on a device** (watch, phone, glasses, browser, kiosk) | [Device app guide](device-app-guide.md) |
| build the thing that **asks the user questions** (the agent, an alerting rule, a cron job) | [Agent guide](agent-guide.md) |
| copy code in JavaScript, Kotlin, Swift or Python | [Cookbook](cookbook.md) |
| look up an exact request/response shape | [OpenAPI document](openapi.json) — also served live at `GET /api/v1/openapi.json` |
| read the normative specification, section by section | [`PROTOCOL.md`](../../PROTOCOL.md) |
| understand why it is designed this way | [Phase 1 survey and proposal](../proposals/client-api-phase1.md) |

## The API in one paragraph

A device pairs once with a six-digit code and a self-description of its abilities
(`caps`), and receives an opaque bearer token with a set of **scopes**. From then
on it asks `GET /capabilities` what it may see and do (already filtered for it),
reads typed **surfaces** of platform state, and keeps one **push channel** open
(`GET /events`, Server-Sent Events or JSON poll) on which everything unsolicited
arrives with sequence numbers: live values, alerts, and **prompts** — the agent
asking a question. A prompt is answered by tapping a pre-supplied option or by
speaking, typing or sending a photo; the answer becomes an **outcome** the user
confirms, and confirmation may run a command under the device's own scopes. The
phone edits each device's **profile** (what to show, how often, which sensors the
user allows). Agents can also **borrow sensors** for a bounded time and **ship
small programs** to devices that declared a runtime. Anything the protocol did not
foresee travels in `ext` fields, per-device `vars`, and free-form messages.

## Tooling

```bash
npm run token -- issue --name phone --preset phone   # mint tokens on the host
npm run client:demo                                  # the whole protocol, end to end, against a live server
npm run openapi > docs/api/openapi.json              # regenerate the OpenAPI document (a test keeps it in sync)
npm test                                             # executable specification (node --test)
```

Import `openapi.json` into Postman, Insomnia, Bruno or Swagger UI for exploratory
calls, or feed it to a generator (`openapi-generator`, `openapi-typescript`,
`swift-openapi-generator`, `ktorfit`) for a typed client. Every operation carries
`x-scope` (the token scope it needs); the `x-events` extension lists every push
event type with its payload schema; `x-limits` mirrors the server's payload budgets.

## Reference clients

`clients/reference/` contains working clients that exercise every endpoint and
double as executable examples:

- `watch.sh` — a shell "watch": pairing, capabilities, snapshot, stream, prompt cycle, sensors, artifacts, vars, charts.
- `agent-sim.js` — a Node agent: raises prompts, resolves free-form answers without an LLM, requests sensors, ships an artifact.
- `demo.sh` — orchestrates the two against a server; `DOCA_ARTIFACT_DIR=… npm run client:demo` also saves the rendered images.

## Versioning and compatibility

The protocol is `1.0`. Additive changes (new fields, event types, block types,
choice types, metric kinds) do **not** bump the major and can appear at any time:
clients must ignore what they do not recognise. `GET /capabilities` reports
`protocol.version` and `protocol.minClient`; a device sends its own ceiling in
`caps.protocol.max`. A breaking change would be a new base path (`/api/v2`) run
alongside `/api/v1` for a deprecation window announced in `capabilities.deprecations[]`.
