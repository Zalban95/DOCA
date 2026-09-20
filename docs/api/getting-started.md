# Getting started with the Doca client API

Ten minutes from a fresh host to a device that receives a live prompt. Everything
below uses `curl` and `jq`; the same calls translate directly into any HTTP
library (see the [cookbook](cookbook.md)).

You need:

- A running Doca dashboard (`npm start` on the host, or the existing install), reachable inside your tailnet as `https://<host>:4242`.
- Shell access to that host once, to mint the first admin token.
- `curl` and `jq` on your machine.

> The server uses HTTPS with a self-signed or Tailscale certificate. Examples use
> `curl -ksS`: `-k` accepts the certificate and `-sS` still prints connection errors.
> In an app, pin the certificate or accept it at pairing time. Plain HTTP is only
> a boot-time fallback if certificate setup fails, not a second listener or redirect.

## 1. Mint an admin token (on the host)

```bash
npm run token -- issue --name laptop --preset admin
```

```
Device  dev_2c1e7a9d40f3  (laptop)
Scopes  *

Token (shown once):

  doca_dev_2c1e7a9d40f3.k3JmZ0…

Use:  curl -ksS -H "Authorization: Bearer doca_…" https://<host>:4242/api/v1/capabilities
```

The plaintext is never stored; only its SHA-256 is. Put it in an environment variable for the rest of this page:

```bash
export DOCA_URL=https://<host>:4242
export ADMIN=doca_dev_2c1e7a9d40f3.k3JmZ0…
```

## 2. Discover

The root is the only unauthenticated read (besides the OpenAPI document):

```bash
curl -ksS $DOCA_URL/api/v1/ | jq
```

```json
{
  "name": "doca",
  "protocol": { "version": "1.0", "minClient": "1.0" },
  "auth": "Authorization: Bearer doca_<device>.<secret>",
  "pairUrl": "/api/v1/devices/pair/complete",
  "capabilitiesUrl": "/api/v1/capabilities",
  "openapiUrl": "/api/v1/openapi.json",
  "docs": "PROTOCOL.md",
  "guides": "docs/api/README.md"
}
```

## 3. Pair a device the way a real app would

Pairing is two calls: an admin (a phone app, or you with the admin token) starts
it and gets a six-digit code; the new device completes it with the code and its
own **capabilities** (`caps`) and receives a token scoped by the `preset`.

```bash
# Admin side
curl -ksS -X POST $DOCA_URL/api/v1/devices/pair/start \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"my-watch","preset":"watch"}' | jq
```

```json
{
  "code": "825-381",
  "expiresAt": "2026-09-09T07:53:24.081Z",
  "scopes": ["read:*", "interact", "profile:self", "vars:self", "sensors:report", "media:upload", "artifacts:self"],
  "name": "my-watch",
  "completeUrl": "/api/v1/devices/pair/complete",
  "qr": "doca://pair?code=825381&host=localhost:4242"
}
```

```bash
# Device side — no token yet. Declare what the device can do; nothing here names a platform.
curl -ksS -X POST $DOCA_URL/api/v1/devices/pair/complete -H 'Content-Type: application/json' -d '{
  "code": "825-381",
  "name": "my-watch",
  "caps": {
    "formFactor": "watch",
    "screen": { "w": 450, "h": 450, "shape": "round" },
    "input": { "touch": true, "voice": true },
    "audio": { "mic": true, "haptic": true },
    "render": ["image", "sprite"],
    "motion": ["1"],
    "exec": ["js"],
    "sensors": ["heartRate", { "id": "accelerometer", "maxRateHz": 50 }, "battery"]
  }
}' | jq '{token, id: .device.id, scopes: .device.scopes}'
```

```json
{
  "token": "doca_dev_6c1d34a9dc42.Qm9v…",
  "id": "dev_6c1d34a9dc42",
  "scopes": ["read:*", "interact", "profile:self", "vars:self", "sensors:report", "media:upload", "artifacts:self"]
}
```

```bash
export WATCH=doca_dev_6c1d34a9dc42.Qm9v…
```

Codes live five minutes and are single-use. In a phone app, show `qr` as a QR code
and let the watch scan it; the URI carries `code` and `host`.

## 4. Ask the server what this device can see and do

`GET /capabilities` is the first authenticated call, and the one to repeat after
`profile.changed` or `resync`. It is already filtered by the token's scopes and
shaped by the device's caps, so a client never hard-codes an id:

```bash
curl -ksS $DOCA_URL/api/v1/capabilities -H "Authorization: Bearer $WATCH" \
  | jq '{protocol: .protocol.version, surfaces: [.surfaces[].id], commands: [.commands[].id], render: .render.defaults, push: .push.url, sensors: .sensors}'
```

```json
{
  "protocol": "1.0",
  "surfaces": ["system.cpu", "system.memory", "system.storage", "system.network", "system.host", "docker.containers", "services.inference", "models.ollama", "models.llamacpp", "agent.prompts"],
  "commands": [],
  "render": { "w": 450, "h": 450, "round": true },
  "push": "/api/v1/events",
  "sensors": { "declared": [ { "id": "heartRate", "unit": null, "maxRateHz": null }, { "id": "accelerometer", "unit": null, "maxRateHz": 50 }, { "id": "battery", "unit": null, "maxRateHz": null } ], "allowed": [], "autoReport": [], "reportUrl": "/api/v1/sensors/samples" }
}
```

`commands` is empty because the `watch` preset has no `command:` scope. Try an
admin call with the watch token and you get a structured refusal:

```bash
curl -ksS $DOCA_URL/api/v1/devices -H "Authorization: Bearer $WATCH" | jq
```

```json
{ "error": { "code": "scope_required", "message": "This action requires one of: devices:admin, agent", "required": ["devices:admin", "agent"] } }
```

## 5. Read data

Surfaces are typed groups of metrics. Ask only for what the current screen shows,
and add `spark=1` when you want sparkline history:

```bash
curl -ksS "$DOCA_URL/api/v1/snapshot?surfaces=system.cpu,system.memory&spark=1" -H "Authorization: Bearer $WATCH" \
  | jq '.surfaces[] | {id, metrics: [.metrics[] | {id, value, display, spark: (.spark // [] | length)}]}'
```

```json
{ "id": "system.cpu", "metrics": [ { "id": "system.cpu.pct", "value": 1, "display": "1%", "spark": 0 }, { "id": "system.cpu.temp", "value": null, "display": "—", "spark": 0 }, { "id": "system.cpu.cores", "value": [0, 0, 5, 0], "display": "4 values", "spark": 0 }, … ] }
{ "id": "system.memory", "metrics": [ { "id": "system.memory.pct", "value": 6, "display": "6%", "spark": 0 }, { "id": "system.memory.used", "value": 965000000, "display": "920 MB", "spark": 0 }, … ] }
```

`value` is typed (`system.cpu.cores` is a `vector`); `display` is a server-formatted
string you can always show; `null` means the host has no such sensor. `spark` is
empty on the very first call — the shared sampler only runs while someone is
asking, and fills the history ring from now on. Responses carry an `ETag`, so a
polling client sends `If-None-Match` and gets cheap `304`s.

## 6. Open the push channel

One Server-Sent Events stream carries everything the server wants to tell this
device. Leave it running in a second terminal:

```bash
curl -ksSN "$DOCA_URL/api/v1/events?since=0" -H "Authorization: Bearer $WATCH" -H 'Accept: text/event-stream'
```

```
retry: 3000

event: hello
data: {"deviceId":"dev_6c1d34a9dc42","cursor":0,"since":0,"replay":0,"resync":false,"heartbeatSec":25,"protocol":"1.0"}

id: 1
event: surface.update
data: {"seq":1,"id":"evt_29de…","ts":"…","type":"surface.update","class":"ephemeral","ttlSec":null,"priority":"normal","ack":false,"v":1,"payload":{"surface":{"id":"system.cpu",…}}}

id: 2
event: surface.update
data: {"seq":2,…,"payload":{"surface":{"id":"system.memory",…}}}

: ping 1757404448000
```

Live `surface.update` events start at once: every device gets a default profile
whose pages list the system surfaces and containers, refreshed every 10 s. A phone
(or the device itself) edits that profile to say which surfaces this device wants
and how often (`PUT /devices/me/profile`, see the device guide). Ephemeral events
like these consume sequence numbers too, which is why the prompt below is `seq: 5`.

Devices that cannot hold a socket use the same URL without the `Accept` header
and get a JSON page: `{ events: [...], nextSince, resync, retryAfterSec }`.

## 7. Raise a prompt from an agent

Agents are just devices with the `agent` scope. Mint one and ask the watch a question:

```bash
AGENT=$(curl -ksS -X POST $DOCA_URL/api/v1/devices -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"agent","preset":"agent","kind":"agent"}' | jq -r .token)

curl -ksS -X POST $DOCA_URL/api/v1/agent/prompts -H "Authorization: Bearer $AGENT" -H 'Content-Type: application/json' -d '{
  "title": "GPU 0 has been at 97 °C for 10 min",
  "priority": "high",
  "targets": ["dev_6c1d34a9dc42"],
  "body": [ { "type": "text", "text": "vLLM is the only tenant. What should I do?" } ],
  "choices": [
    { "id": "wait", "type": "option", "label": "Wait 10 min", "outcome": { "summary": "Re-check in 10 minutes" } },
    { "id": "say",  "type": "voice",  "label": "Tell me", "maxSec": 20 },
    { "id": "shoot","type": "image",  "label": "Show me" },
    { "id": "no",   "type": "dismiss","label": "Ignore" }
  ]
}' | jq '{id: .prompt.id, delivered: .prompt.delivered}'
```

```json
{ "id": "prm_e8a441dd08aca116", "delivered": [ { "deviceId": "dev_6c1d34a9dc42", "seq": 5 } ] }
```

The stream from step 6 shows the prompt arrive, **tailored to the watch**: it has
a mic, so the `voice` choice is kept (with the audio types the server accepts); it
has no camera, so the `image` choice is gone. The agent wrote four choices, the
watch sees three:

```
id: 5
event: prompt.new
data: {"seq":5,"id":"evt_…","ts":"…","type":"prompt.new","class":"durable","ttlSec":3600,"priority":"high","ack":true,"v":1,
       "payload":{"prompt":{"id":"prm_e8a441dd08aca116","title":"GPU 0 has been at 97 °C for 10 min",
         "choices":[{"id":"wait","type":"option",…},{"id":"say","type":"voice","accept":["audio/ogg","audio/webm",…]},{"id":"no","type":"dismiss",…}],
         "state":"open","haptic":true,…}}}
```

## 8. Answer it from the device

Selections are keyed by a client-generated `selectionId` so retries are safe:

```bash
curl -ksS -X POST $DOCA_URL/api/v1/prompts/prm_e8a441dd08aca116/select -H "Authorization: Bearer $WATCH" -H 'Content-Type: application/json' \
  -d '{"selectionId":"7c9e6679-7425-40de-944b-e07fc1f90ae7","choiceId":"wait"}' | jq
```

```json
{ "status": "outcome_ready", "promptId": "prm_e8a441dd08aca116", "selectionId": "7c9e6679-…",
  "outcome": { "summary": "Re-check in 10 minutes", "blocks": [], "confirmLabel": "Confirm", "backLabel": "Back" } }
```

Show the outcome with **Confirm** / **Back** buttons, then confirm:

```bash
curl -ksS -X POST $DOCA_URL/api/v1/prompts/prm_e8a441dd08aca116/confirm -H "Authorization: Bearer $WATCH" -H 'Content-Type: application/json' \
  -d '{"selectionId":"7c9e6679-7425-40de-944b-e07fc1f90ae7","decision":"confirm"}' | jq
```

```json
{ "status": "confirmed", "promptId": "prm_e8a441dd08aca116", "selectionId": "7c9e6679-…", "execution": null }
```

The agent's own stream receives `prompt.confirmed`. Repeat the confirm call and
you get the same body with `"replay": true` — the whole cycle is idempotent.

## 9. Acknowledge and reconnect

Durable events (`"ack": true` in the envelope — the prompt, not the surface
updates) are retained until acknowledged. Either reconnect with the last `seq` you
processed (`?since=5`) or ack explicitly:

```bash
curl -ksS -X POST $DOCA_URL/api/v1/events/ack -H "Authorization: Bearer $WATCH" -H 'Content-Type: application/json' -d '{"seq":5}' | jq
```

```json
{ "acked": 1, "pending": 0, "cursor": 5 }
```

## 10. Get a picture without an SVG engine

Watches often cannot render SVG. Ask the server for a PNG sized to the screen:

```bash
curl -ksS "$DOCA_URL/api/v1/render/chart?metrics=system.cpu.pct,system.memory.pct&w=450&h=225" \
  -H "Authorization: Bearer $WATCH" -o chart.png && file chart.png
```

```
chart.png: PNG image data, 450 x 225, 8-bit/color RGBA, non-interlaced
```

## Where to go next

- Building the app on the device? Read the [device app guide](device-app-guide.md).
- Building the thing that raises prompts? Read the [agent guide](agent-guide.md).
- Want code, not curl? The [cookbook](cookbook.md) has JavaScript, Kotlin, Swift and Python.
- Need exact shapes? Import `/api/v1/openapi.json` into your tool of choice, or read [`PROTOCOL.md`](../../PROTOCOL.md).
- The whole flow above, plus sensors, artifacts, variables and revocation, runs end to end with `npm run client:demo` (`clients/reference/demo.sh`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `curl: (60) SSL certificate problem` | self-signed certificate | `-k` for curl; pin or trust the certificate in your app |
| `401 unauthenticated` | no `Authorization` header | send `Bearer doca_…`; for `EventSource`, use `?access_token=` on `/events` only |
| `401 invalid_token` | token revoked, expired, or minted against a different `DOCA_DATA_DIR` | issue a new token; check the server's data dir |
| `403 scope_required` | the preset does not include that scope | look at `required[]`; issue with a different preset or explicit `--scopes` |
| `400 invalid_pairing` | code expired (5 min) or already used | start pairing again |
| `413 payload_too_large` on `/snapshot` | too many surfaces or `spark` on a slow host | request fewer surfaces per call |
| `commands: []` in capabilities | token has no `command:` scopes | intended for watches; use the `phone` preset or add scopes |
| Chart has no text | server found no TTF font | set `DOCA_FONT=/path/to/font.ttf` on the host; `capabilities.render.text` tells you |
