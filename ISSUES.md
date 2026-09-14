# ISSUES

Open faults with a named cause and the evidence for it. An entry stays here
until the "how to close it" line is true. Numbered `H-n` for harness faults.

---

## H-5 — A turn produces nothing because the provider streams keep-alives and never a token

**Status:** cause found, panel patched on `main`. The provider fault itself is
`deepseek-flash`'s and is not ours to fix — **the model must be changed to
`deepseek-v4-pro` for this install to work.** The panel's fault was that it
could not tell you any of this, and that part is fixed.

### What was seen

The console prints the session line and then nothing, forever:

```
session s_mu1a27lx91jj38
— live —
session s_mu1a27lx91jj38
```

No `step 1: … tokens` line, no text, no error. Reproduces in a fresh session.
The turn does not die — it **hangs**. Nothing is thrown, which is why
`.doca/restart.log` (the live panel's stderr) has no exception in it and why the
last line there is still the 20:15:58 startup banner.

`.doca/harness/sessions/s_mu1a27lx91jj38.jsonl` shows the user rows appended
with no assistant row after them — seven consecutive `user` rows at the tail
(`"hi"` ×6 and `"so..."`). By the rule in the handover that reads as "broke in
assembly", but assembly is not where it stopped: the first `memory.append` is
the *last* thing that happens before the model call, so a user row with no
assistant row is equally the signature of a first model call that never returned.

### Where in the code

`modules/harness/agent.js`:

- `complete()` (line 332) — `for (;;) { const { done, value } = await reader.read(); … }`.
  A line that does not start with `data:` is skipped silently (line 356), so an
  SSE comment frame is consumed and discarded. Nothing counts them, nothing
  times them out.
- `post()` (line 288) — passes `signal` straight through to `fetch`. On the turn
  path that signal is `handleChat`'s `res.on('close')` controller
  (`modules/harness/routes.js:71`), which fires only when the browser hangs up.
  **There is no timeout of any kind on a turn's model call.** Compare
  `ask()` at line 397, which has `signal || AbortSignal.timeout(120_000)`.
- `status()` (line 755) — the health check is `GET {baseUrl}/models` with a 4 s
  timeout. It never calls `/chat/completions`.

The first `usage` event is emitted at line 569, *after* `complete()` returns.
That is precisely why no `step 1` line ever appears.

### Evidence

The configured provider is `DeepSeek4f` → `https://api.deepseek.com/v1`, model
`deepseek-flash` (`.dashboard-prefs.json` → `harness.config.doca`; the key is
declared in `~/.openclaw/openclaw.json`, not `.env`). All three of the cheap
signals pass:

```
GET /models          → HTTP 200  {"data":[{"id":"deepseek-flash"},{"id":"deepseek-v4-pro"}]}
GET /user/balance    → HTTP 200  {"is_available":true,"total_balance":"19.68"}
```

So the model name is real, the key is good, the balance is not exhausted and
nothing is rate-limited. `agent.status()` reports `ready/reachable/hasKey` — and
is right to.

`POST /chat/completions` is where it stops. Streaming, `max_tokens: 8`,
one message, `"hi"`:

```
http=200 ttfb=12.42s total=180.00s bytes=196
content-type: text/event-stream; charset=utf-8
server: elb    via: CloudFront    x-ds-trace-id: 3496b9cf…
```

All 196 bytes are the same frame, fourteen times over three minutes:

```
: keep-alive

: keep-alive
```

Zero `data:` frames. Zero deltas. Three consecutive probes agree to the tenth
of a second — `ttfb=12.42s / 12.34s / 12.49s`, 28 bytes each in 25 s — so this
is deterministic, not a blip. Non-streaming behaves the same way: headers in
421 ms, then `r.text()` never resolves inside 90 s.

`: keep-alive` is DeepSeek's documented hold-the-connection frame for a queued
request. The request is accepted and then never served.

**Two probes narrow it to the model, not the transport:**

| Probe | Result |
| --- | --- |
| `stream:false`, `max_tokens:256`, `deepseek-flash` | headers in 0.49 s, **no body in 240 s** |
| `stream:true`, `max_tokens:256`, `deepseek-v4-pro` | **first frame in 0.43 s**, 24 data frames, complete in 1.25 s, 0 keep-alives, full usage frame |

So **streaming is not the fault** — turning it off hangs identically, and a
per-provider `stream:false` escape hatch would have bought nothing. And the
fault is **model-specific**: `deepseek-v4-pro` on the same key, same base URL,
same account answers immediately and correctly. `deepseek-flash` is the broken
one.

That makes the operational fix a one-line settings change
(`harness.config.doca.model` → `deepseek-v4-pro`), and the patch below is about
never again spending an evening on a blank screen.

Control, same code path, same machine, the other configured provider:

```
Mistral  POST /chat/completions  → HTTP 429 in 251 ms
{"message":"Rate limit exceeded","type":"rate_limited"}
```

Which `post()` turns into a readable error via `budget.explain()`. So the
network is fine, `complete()` is fine, and a provider that answers gets handled
correctly. The fault is that a provider that *neither* answers *nor* refuses
produces an unbounded silent wait.

### What this rules out

- **Duplicate panels — no.** One process serves `:4242`: pid 2921343,
  hand-started 22:15:58, cwd `/home/al/workspace/openclaw-dashboard`,
  stdout+stderr → `.doca/restart.log`. `ss -lptn` shows exactly one listener.
- **A stuck turn lock — no.** `_running` lives in `modules/api-v1/harness.js:52`,
  not `agent.js`, and guards `/api/v1/harness/messages`. The dashboard console
  posts to `/api/harness/chat` (`routes.js:65`), which has no lock and cannot
  return 409.
- **A throw in prompt assembly — no.** Nothing is thrown; `handleChat`'s catch
  would have emitted `{type:'error'}` and ended the stream.

### Two corrections to the handover

- **The systemd unit is not healthy.** It is still crash-looping — `NRestarts`
  went 63,640 → 63,644 while this was being written, one cycle every ~23 s. The
  `WorkingDirectory` fix worked; the unit now gets far enough to find the port
  already held by the hand-started panel and exits 1:

  ```
  Sep 14 22:27:29 bash[2939215]: [server] port 4242 is still in use after 20s —
                                 another DOCA Panel is probably already running.
  Sep 14 22:27:29 systemd[1]: openclaw-panel.service: Main process exited, code=exited, status=1/FAILURE
  ```

  This is harmless to the fault above but it means **`journalctl -u
  openclaw-panel` shows the restart loop, not the live panel's stderr.** The
  live panel's stderr is `.doca/restart.log`. Nothing was going to be found in
  the journal.

- **`ISSUES.md` did not exist** — not in the working tree, not in any commit on
  any branch, not in any stash, and the `H-n` convention appears nowhere in the
  repo. This file and this format are new; H-1 to H-4 have no prior text to
  match.

### The fix, as applied

On `main`, commit pending. Three changes, none of which cap what the agent may
do — the fix is visibility, not restriction:

1. **`firstTokenTimeoutMs` (default 90 s)** in `providers.defaultParams()`, with
   a `HARNESS_PARAMS` row and hint in `public/js/harness.js`. It is inside the
   `harness.config` prefix, so it is already `SETTABLE` and the agent can
   propose changing it. `0` restores the old unbounded wait.

   It is a deadline on the **first token only**. `firstTokenGuard()` in
   `agent.js` arms a timer before the request and disarms it the moment any
   parseable frame arrives; the rest of the stream stays unbounded, because a
   long answer is not a stall and cutting one off would turn this into exactly
   the kind of cap it must not be. `test/harness.test.js` pins that with
   *"a slow first token is not a stall once it arrives"*.

2. **The deadline covers the non-streaming path too.** `complete()` was split so
   both branches run inside the guard: this provider answered
   `application/json` in 421 ms and then never sent a body, and `r.json()` was
   bounded only by the caller's signal. Pinned by *"the deadline covers the
   non-streaming path too"*.

3. **Keep-alives are counted and reported.** An SSE comment used to be dropped
   by the `data:` filter without a trace. `complete()` now counts them and a
   `waiting` event is emitted every 15 s (or three times inside a shorter
   deadline) carrying provider, seconds and frame count. The console draws one
   amber row, rewritten in place and removed the instant a token arrives —
   amber because waiting is not failing. `logs.js` renders the same event, so it
   reaches the Logs tab whether or not the console is open.

The message satisfies charter rule 12 — it is `budget.stalled()`, beside
`explain()`, and says who went quiet, for how long, whose limit stopped the
waiting, and what to do:

> DeepSeek4f held the connection open for 8s without sending a token — that is
> this panel's firstTokenTimeoutMs, not the model's. Raise it in harness
> settings (harness.config.doca.firstTokenTimeoutMs), or try another provider or
> model. Nothing was cancelled at the provider's end: this stopped the waiting,
> not the work, so anything it was about to charge for it may still charge for.

That is a real capture, run against the live `deepseek-flash` endpoint with an
8 s deadline — not a mock. The last sentence is the same honesty the MCP timeout
message and Stop already carry.

A user pressing Stop is unaffected: both aborts surface as `AbortError`, and
only the guard knows which fired, so a deliberate stop keeps its own meaning.

### Original fix shape (kept — it is what was proposed before the probes)

Provider-side stalls are not this panel's to prevent, but *twenty minutes of a
blank screen* is. Three changes, none of which cap what the agent may do:

1. **A first-token deadline on the turn's model call, not a total one.** A turn
   is allowed to take as long as it likes — that is the whole design — but
   silence before the *first* `data:` frame is a different thing from a long
   answer. Arm a deadline when the request goes out, disarm it the moment the
   first frame with `choices` or `usage` arrives, and let the rest of the stream
   run unbounded. A setting in `defaultParams()` (`firstTokenTimeoutMs`, ~90 s),
   in `SETTABLE`, with a `HARNESS_PARAMS` row and a `hint` — so it is raisable,
   and so the agent can name it and propose changing it, per charter rule 12.
   `budget.explain()` should own the message and say whose limit it is.

2. **Count the keep-alives and say so.** `complete()` already reads every line;
   a line that is not `data:` and not blank is the provider holding the
   connection. Emit `{type:'waiting', provider, seconds, frames}` on the first
   one and every ~15 s after. The console then shows "DeepSeek has held the
   connection open for 45 s without sending a token" instead of nothing, and
   `logs.js` gets it for free since `say()` publishes to `agent.events`.

3. **Make the health check honest about what it checked.** `status()` pings
   `/models` and reports `reachable`. That is "the provider is up", not "the
   provider will answer". Either rename the field or have it carry what it
   actually tested, so `ready/reachable/hasKey` all green cannot mean what it
   means today.

### How to close it

- A turn against a provider that sends only `: keep-alive` ends inside the
  deadline with a message naming the provider, the elapsed time and the setting,
  instead of hanging.
- The console shows a waiting indication within ~15 s of the first keep-alive.
- A test in `test/harness-awareness.test.js` (or the stub model server in
  `test/fixtures/`) serves `: keep-alive` frames and nothing else, and asserts
  both the deadline and the `waiting` event. The stub server already exists and
  needs no key.
- `firstTokenTimeoutMs` appears in `HARNESS_PARAMS` with a hint — the greps in
  `harness-awareness.test.js` will fail until it does.

### Sitting directly behind this fix — resolved by moving to `main`

`agent.js:493` on **v2.22.2** declares `const summary` and `agent.js:624`
assigns `summary = folded` — a `TypeError: Assignment to constant variable.`
It was unreachable while `contextWindow` was 0, but proposal `p_mu1it6a6tkqq`
set it to 1000000 (`decidedAt: 2026-09-14T18:33:09Z`, 20:33 local), which made
the fold branch live. Any step whose prompt passed 60% of 1M would have thrown.

`main` @ 9f0d1d2 [2.23.0] already has it as `let` (line 558), and 2.23.0's
`compactTokens` (default 40000) means the fold branch now fires routinely rather
than only above 600k — so on v2.22.2 this would have gone from latent to
constant. **Working on `main` resolves it; do not go back to the detached
v2.22.2.**

---

## H-6 — The health check cannot fail for the reason turns fail

**Status:** open. Named separately from H-5 because it is what made H-5 take an
evening.

### What was seen

For hours, with every turn hanging, the panel reported the provider as fine.
Captured live, while `/chat/completions` was returning nothing but keep-alives:

```
GET /api/harness/status
{"provider":"DeepSeek4f","model":"deepseek-flash","ready":true,
 "reachable":true,"error":null,"baseUrl":"https://api.deepseek.com/v1","hasKey":true}
```

Four green signals and `error: null`, describing a provider that had not
completed a single request all day.

### Where in the code

`modules/harness/agent.js::status()`. It resolves the endpoint, sets
`ready = !!p.model`, and then:

```js
const r = await fetch(`${ep.baseUrl}/models`, { … signal: AbortSignal.timeout(4000) });
out.reachable = r.ok;
```

`/models` is a static list. It answered 200 in ~200 ms throughout. Nothing in
`status()` ever calls `/chat/completions`, so no fault in the completion path —
a stall, a model that 400s, a deployment that rejects one field — can move any
of these fields.

### Why this is its own entry

A health check that cannot fail for the reasons the thing actually fails is
worse than no health check. Not merely uninformative: **actively misleading**.
Green on the provider row is what sent the investigation towards duplicate
processes, the systemd unit and prompt assembly — three days' worth of
plausible stories — because the one component that could report itself was
reporting itself healthy. Absent a check, the provider would have been the first
suspect, not the last.

`ready`, `reachable` and `hasKey` are each individually true and individually
honest. The composite they present is not.

### Fix shape

Either of these; not both.

- **Make it prove what it claims.** A one-token completion (`max_tokens: 1`,
  one-word prompt) with a short deadline, reusing the H-5 guard. It costs
  fractions of a cent, it exercises the path that actually carries turns, and it
  would have caught this in the first minute. Report it as its own field
  (`answers: true|false|null`) so "I did not check" stays distinguishable from
  "it failed" — the same three-state honesty `/api/update-check` already has,
  and for the same reason.
- **Or rename it to what it proves.** `reachable` → `listsModels`, and the panel
  says "the provider is up; whether it will answer is untested". Cheaper, no
  tokens, and it stops the field claiming something it never established.

The first is better. The panel's whole promise is that it can tell you the state
of the thing it manages.

### How to close it

- With a provider stalling on `/chat/completions`, `/api/harness/status` does
  not show an unqualified healthy state.
- A test using the H-5 stall fixture asserts it: the stub serves `/models` 200
  and stalls `/chat/completions`, and `status()` must not report the provider
  as working.
- If the rename option is taken instead, no field in the response asserts
  anything about completions.

---

## H-7 — `POST …/proposals/:id/apply` is unauthenticated, and the agent has `http_fetch`

**Status:** open. Not caused by 2.23.0 — pre-existing, found while reviewing it.
This is the invariant a feature flag cannot roll back, and it does not hold.

### The invariant

The agent proposes; only a human click applies. Everything in the design rests
on it: `settings_propose` writes a file and nothing else,
`settings.apply()` re-runs `refuse()` on every key, `installs.apply()`
re-validates, `SETTABLE`/`FORBIDDEN` bound what may be pointed at, and
`registry.NEVER` strips `settings_propose`/`install_propose` from sub-agents so
proposals keep one owner.

All of that is intact and correct. It is also bypassable.

### What was seen

The apply routes have no authentication. Probed live with a non-existent id, so
nothing was written:

```
POST https://127.0.0.1:4242/api/harness/proposals/p_doesnotexist/apply
{"error":"Unknown proposal"}   HTTP 404

POST https://127.0.0.1:4242/api/harness/installs/i_doesnotexist/apply
{"error":"Unknown install proposal"}   HTTP 404
```

`404 Unknown proposal` means the handler ran. A `401` would have meant the
boundary exists. There is no auth middleware on legacy `/api/*` at all — only
`/api/v1` has one.

And the agent can reach it. `modules/harness/tools.js::http_fetch` takes any
absolute URL, any method and a body, with no host policy:

```js
run: async ({ url, method, body }) => {
  const r = await fetch(url, { method: (method || 'GET').toUpperCase(), body: body || undefined, … });
```

So `http_fetch({url: 'https://127.0.0.1:4242/api/harness/proposals/<own-id>/apply', method: 'POST'})`
applies the agent's own proposal in one tool call. `shell` has curl, which is
the same thing without the tool. Neither is a switch the ⚙ panel can close:
`disabledTools` filters the schema list, and TODO.md already records the agent
finding and using exactly this route around the tool layer on 2026-09-13.

### What TODO.md already says, and what it misses

TODO.md's *"A switched-off tool is not an unreachable one"* describes this shape
and concludes: *"Nothing was bypassed that the user had forbidden — the switches
are a context-window and tidiness feature, not a permission boundary."* True of
the tool switches.

It does not follow for `apply`. The tool switches were never a boundary; the
propose/click split **is** one, it is the load-bearing one, and the same hole
reaches it. That is the gap between what is written down and what is true.

### Not a 2.23.0 regression

Audited, and the answer is clean. 2.23.0 touches
`agent.js`, `budget.js`, `memory.js`, `providers.js`, `harness.js`,
`openapi.json`, `package.json` and one test file. It does **not** touch
`settings.js`, `installs.js`, `routes.js`, `tools.js`, `server.js` or
`api-v1/*`. The only occurrence of "propose" anywhere in the diff is prose
inside a prompt block. `settings.apply()` still re-runs `refuse()` per key
(`settings.js:278`); `installs.apply()` still re-validates (`installs.js:190`).
Session ids are server-generated (`newId('s')`), so 2.23.0's new
`spillTool()` write path cannot be steered outside
`harness/tool-results/<sessionId>/` by a request.

### Fix shape

The honest options, in order of how much they cost:

1. **A loopback guard on the apply routes only.** They are the two routes where
   "a click in a browser" is the entire security property. Require a header the
   browser sets and a tool call does not, or an origin check — small, and it
   restores the invariant without touching what the agent may do.
2. **A host policy on `http_fetch`** that refuses this panel's own origin, with
   a refusal that names why. Narrower than it sounds: the agent has legitimate
   reasons to fetch other local services, just not this one's control surface.
   Does nothing about `shell`.
3. **Authenticate legacy `/api/*`.** The real answer, already on TODO.md as the
   design question keeping the MCP registry out of `/api/v1`, and much larger
   than this entry.

(1) is worth doing now regardless of (3). Note that none of these can stop
`shell` — which is the argument TODO.md makes and it is correct. The point is
not to make the agent harmless; it is that the propose/click split should either
be a boundary or stop being described as one.

### How to close it

- An unauthenticated `POST /api/harness/proposals/:id/apply` from outside a
  browser does not apply a proposal.
- A test asserts it, alongside the existing one that a proposal writes nothing
  until applied.
- Whatever is decided, AGENTS.md and TODO.md say the same thing about it.
  Today AGENTS.md describes a click as the security property and TODO.md
  describes the route as reachable, and both are on the same page about the tool
  switches while neither mentions `apply`.

---

## H-8 — `npm test` cannot go green on this machine: node-pty aborts the process

**Status:** open, environmental. Not a code fault in this repo and not a 2.23.0
regression.

### What was seen

```
# tests 236     # pass 213     # fail 23
```

22 of the 23 are whole **files**, not assertions. Every subtest in them passes
and then the process dies:

```
not ok 1 - test/agents.test.js
  ---
  duration_ms: 1240.943678
  failureType: 'testCodeFailure'
  exitCode: ~
  signal: 'SIGABRT'
```

### Cause

```
$ node -e "require('node-pty'); console.log('pty ok')"
pty ok
Aborted (core dumped)      exit=134
```

`node-pty@1.1.0`'s native addon aborts at process exit under Node v22.22.2, with
no message on stderr. `modules/terminal.js:22` calls `getPty()` at module scope
(`if (!getPty()) {`), despite the lazy-load comment above it, so every file that
requires `server.js` loads the addon and inherits the abort. A trivial
`node --test` file with no repo imports exits 0.

### Also failing, separately

`not ok 237 - with no hypervisor installed the panel still answers, saying which
are missing` — the test asserts `hv.vms` is empty, and this machine has
`/usr/bin/virsh` installed with a qemu VM running. Environment-dependent test,
not a regression.

### Why it matters beyond the noise

`npm test` exits 1, but `npm test | tail -40` exits **0** — the pipeline's exit
code is the tail's. That is how a red suite reads as green in a terminal, and it
is worth knowing before trusting any "tests pass" in this repo's history.

### Fix shape

Upgrade or replace `node-pty` (1.1.0 is old for Node 22); or make `terminal.js`
honour its own comment and load the addon on first connection rather than at
module scope, which removes it from every test that never opens a terminal. The
second is one line and fixes the suite without a dependency decision.

### How to close it

- `npm test` exits 0 on this machine.
- The vms test either provisions its own expectation or skips when a hypervisor
  is present.

---
