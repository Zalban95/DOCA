# ISSUES

Open faults with a named cause and the evidence for it. An entry stays here
until the "how to close it" line is true. Numbered `H-n` for harness faults.

---

## H-5 — A turn produces nothing because the provider streams keep-alives and never a token

**Status:** cause found, panel patched on `main`. The provider fault itself is
`deepseek-flash`'s and is not ours to fix — **the model must be changed to
`deepseek-v4-pro` for this install to work.** The panel's fault was that it
could not tell you any of this, and that part is fixed.

*Re-verified 2026-09-17 on v2.27.2 (`4177ad1`), fresh checkout.* All three
changes are present and pinned: `firstTokenTimeoutMs: 90000` at
`providers.js:124`, the guard at `agent.js:458`, `budget.stalled()` at
`budget.js:305`, the `HARNESS_PARAMS` row at `public/js/harness.js:262`, and
the stall tests at `test/harness.test.js:316` — whose fixture serves
`: keep-alive` frames and nothing else (`test/harness.test.js:63`), so the
deadline and the `waiting` event are both covered. **The "how to close it" list
below is satisfied; this entry can be closed** once the model is switched on the
live install.

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

*Re-verified 2026-09-17 on v2.27.2 (`4177ad1`).* Unchanged since it was
written: `agent.js:971` still defaults `reachable: false`, `agent.js:977` still
fetches `${ep.baseUrl}/models`, and `agent.js:981` still assigns
`out.reachable = r.ok`. Nothing calls `/chat/completions` from `status()`, and
there is no `answers` field. The gap between "the provider is up" and "the
provider will answer" is exactly as wide as it was.

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

**Status:** **partially closed on `dev/troubleshoot`, 2026-09-17 — and deliberately
not called closed.** Fix shape (1) is implemented: the two apply routes now
require a browser-set header, so the tool-layer path is shut. It is not a
security boundary and the code says so rather than implying otherwise — see
*What this does and does not stop* below. The entry stays open until `/api/*` is
authenticated, which is fix shape (3) and the only answer that is one.

Not caused by 2.23.0 — pre-existing, found while reviewing it.
This is the invariant a feature flag cannot roll back, and it does not hold.

### What this does and does not stop

`requireBrowser` in `server.js` requires `Sec-Fetch-Site` or a same-origin
`Origin` on `POST …/proposals/:id/apply` and `…/installs/:id/apply`.

- **Stops: `http_fetch`.** It takes any URL, any method and a body, and has no
  way to set a request header — so the one-tool-call bypass this entry is about
  is gone, and that was the path the agent actually found and used.
- **Does not stop: `shell`.** It has curl, and curl sets whatever header it
  likes. Nothing short of authenticating `/api/*` changes that, which is the
  point TODO.md already makes and is correct.
- **Does not stop: the panel's own settings routes, which is the wider hole and
  was not visible until it was probed.** `POST /api/harness/doca/config` writes
  **any harness setting directly** — no proposal, no click, no authentication.
  Verified 2026-09-18: `{"temperature": 0.9}` moved the setting from 0.3 to 0.9
  with a bare `curl`, and the agent has `http_fetch`. So the guard on the two
  `apply` routes closes one door while the room behind it has no wall on that
  side at all. The ⚙ panel uses this route to save what the user types, which
  is legitimate — the fault is that the same route is reachable by the agent.

  The full set that writes settings without the guard: `POST
  /api/harness/:id/config`, `/api/configs/:id`, `/api/config-favorites`,
  `/api/models/settings`, `/api/models/local/settings`, `/api/models/hf/settings`,
  `/api/models/tools/:id/config`, `/api/snapshots/settings`, `/api/vms/settings`,
  `/api/services/settings`.

  Extending `requireBrowser` to them would close the `http_fetch` path for all
  of them and the dashboard sends the header automatically — but it would also
  break any script or CLI a user has pointed at those routes, which is a
  decision rather than a patch. Not made unilaterally.

  **The honest summary: the invariant "the agent proposes, only a human click
  applies" holds against `settings_propose` and does not hold against the
  panel's direct-write routes.** Fix shape (3), authenticating `/api/*`, closes
  both at once, which is another reason it is the answer.

So the honest description of the click is now **a convention with a speed bump,
not a gate**: the bypass requires deliberate header forgery spelled out in a
shell command rather than being the accidental first thing an agent reaches
for. That is worth having, and it is not the same thing as a boundary. AGENTS.md
and TODO.md should say it that way; today AGENTS.md describes a click as the
security property and this entry describes the route as reachable, and after
this change neither sentence is quite right.

*Re-verified 2026-09-17 on v2.27.2 (`4177ad1`).* Still unauthenticated. The
routes are registered bare at `server.js:191` and `server.js:201`; the only
middleware above them is `app.use('/api/v1', apiV1.router)` at `server.js:58`,
so legacy `/api/*` has no auth in front of it. `handleProposalApply`
(`routes.js:227`) and `handleInstallApply` (`routes.js:262`) call straight into
`settings.apply()` / `installs.apply()` with nothing between them and the
request. `http_fetch` (`tools.js:600`) still takes any absolute URL, any method
and a body, with no host policy — so fix shape (2) is untouched as well.

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

*Re-tested 2026-09-17 on a clean checkout (v2.27.2, `4177ad1`) — **it does not
reproduce**.* `node_modules/node-pty` is still `1.1.0` and
`node -e "require('node-pty')"` prints `pty ok` **and exits 0**; `npm test`
reports `# tests 239 / # pass 239 / # fail 0` with a real exit code of `0`
(measured without the `| tail` pipe this entry warns about). Both of this
entry's inputs differ from the machine it was written on, and each explains one
of the two failures:

- **Node patch version.** It reproduced on **v22.22.2**; this machine is
  **v22.22.1**. The abort is therefore specific to that patch, not to Node 22 as
  a class — which also means the lazy-load fix in `terminal.js:22` is still
  worth making, since it removes the addon from every test that never opens a
  terminal regardless of which Node is installed.
- **Hypervisor.** The one non-SIGABRT failure ("with no hypervisor installed the
  panel still answers, saying which are missing") was environment-dependent:
  that machine had `/usr/bin/virsh` and a qemu VM running, this one has neither
  `virsh` nor `VBoxManage`, so the test's assumption holds and it passes.

So the `# fail 23` in this entry is *not* a property of the code at `4177ad1` —
it needs those two conditions to be present. Confirm on the original machine
before closing this outright.

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

## H-9 — The prompt prefix changes on every step, so the provider's cache never warms

**Status:** fixed on `dev/troubleshoot`, 2026-09-17 — awaiting merge. It was a
per-step cost on every turn and it was invisible in the panel. See *Fixed* below
for the before/after; the cause and the diff that found it are kept because the
reasoning is the part that generalises.

### What was seen

Reported 2026-09-17 from the live install. Against a provider with prefix
caching, the per-step cache hit rate sits at **6–7%** and does not climb. The
`in` counter on each step grows by very nearly the whole context (~23K), which
is the signature of a prefix that matched almost nothing: the provider re-bills
the context on every step instead of serving it from cache.

The shape of the fault is fixed by what a prefix cache *is*. It matches the
longest byte-identical run from the start of the request. Given a stable head,
the first step misses and every step after it hits, so the rate should climb
towards ~90% — not sit flat at 6%. A rate pinned near zero means the prefix is
being rewritten on every call, and the repair is to find the first byte that
differs and move whatever precedes it out of the changing region.

### Cause, confirmed by diff — 2026-09-17

Reproduced on a clean checkout at `4177ad1`, provider `ds` → DeepSeek
`deepseek-flash`. A four-step turn (two `shell` calls) gave a per-step cache
read that is its own diagnosis, once the cumulative ledger is differenced:

| Step | prompt (Δ) | cached (Δ) | per-step |
| --- | --- | --- | --- |
| 1 | 6,482 | 1,152 | 17.8% |
| 2 | 6,952 | **1,152** | 16.6% |
| 3 | 7,024 | **1,152** | 16.4% |
| 4 | 7,370 | **1,152** | 15.6% |

The cached count is **exactly 1,152 tokens on every step and never grows.**
History is appended, so each step's prompt begins with the whole of the
previous step's prompt; a stable head makes the cached region *grow* every
step. A constant means the first differing byte sits at a **fixed offset**, and
nothing past it can ever be cached.

The raw bodies were then captured by wrapping `global.fetch` from outside the
process — `node --require /tmp/dump-fetch.js server.js`, no repo source touched —
and the two consecutive `/chat/completions` bodies differenced:

```
first differing byte offset: 5779  (20.9% of body)

  ## Right now
  time: 2026-09-17T16:42:0[6.022Z]   ← step 1
  time: 2026-09-17T16:42:0[8.431Z]   ← step 2
```

**5,779 bytes ÷ 1,152 tokens ≈ 5.0 bytes/token.** The stable prefix and the
cached prefix are the same region: the provider caches exactly as far as the
clock.

Clustering every differing byte (gaps > 300 identical bytes separate clusters)
leaves exactly **two** volatile regions in the whole 27,687-byte body:

| Span | What |
| --- | --- |
| `5779..5784` (5 bytes) | `time:` in `## Right now` — `environment.block()` |
| `8616..end` | `this turn so far: N model calls…` in `# Your limits` — `budget.block()`, then the expected history growth |

So both volatile writers are *in the system prompt, ahead of the history* —
`environment.js:200` and the ledger line in `budget.block()`. No third cause
exists; the earlier list of candidates was right about the shape and wrong
about the ranking.

### Fixed 2026-09-17 on `dev/troubleshoot`

Both volatile writers were moved after the history: `environment.block()` lost
its `## Right now` section to a new `environment.live()`, and `budget.block()`
lost its running ledger to `budget.live()`. `agent.js::turn()` assembles the
request as **stable system message → history → readings**, the readings
travelling as a trailing `system` message that is generated per step and never
persisted. Behaviour is unchanged: every fact the model was given before, it is
given again, in the same words, as the last thing it reads. `breakdown()` gained
a `readings` row so the token accounting still adds up.

Same task, same provider, six-step turn, measured the same way:

| Step | prompt Δ | cached Δ | per-step | *was* |
| --- | --- | --- | --- | --- |
| 1 | 5,748 | 5,376 | **93.5%** | 17.8% |
| 2 | 6,001 | 5,632 | **93.9%** | 16.6% |
| 3 | 6,073 | 5,888 | **97.0%** | 16.4% |
| 4 | 6,134 | 5,888 | **96.0%** | 15.6% |
| 5 | 6,222 | 6,016 | **96.7%** | — |
| 6 | 6,396 | 6,016 | **94.1%** | — |

The signature to read is the *shape*, not the percentage: the cached count now
**grows every step** (5,376 → 5,632 → 5,888 → 6,016), which is what a stable
prefix looks like. Before, it was pinned at exactly 1,152 forever. Average is
≈95%, against 6–7% reported.

The first differing byte in two consecutive bodies moved from offset 5,779
(20.9%) to 8,068 (35.5%), and it is now the natural boundary — step 1's
readings block against step 2's history growth — rather than a clock.

### What the test should have caught, and now does

The old test was green throughout. It checked `environment.block()`'s head
against its own `## Right now` marker — the mitigation validated at the scale it
was written at, not the scale it had to hold at. Three tests replace it:
`environment.block()` must be byte-identical across two calls a second apart;
`agent.preview()` must be byte-identical the same way; and a turn's request must
carry the readings as its last message with the system prompt free of them. The
second is the one that would have caught this on the day it shipped.

### H-9b — the same fault, still live: tool results are rewritten between steps

**Status:** fixed on `dev/troubleshoot`, 2026-09-17 — awaiting merge. See *Fixed*
below for the before/after. The cause and the reasoning are kept because the
lesson is the part that generalises: **a verification workload that cannot
trigger the fault is not a verification.**

Found 2026-09-17 by measuring a *realistic* turn rather than a convenient one.
H-9 above is fixed and its numbers hold; this is a second, independent
prefix-breaker that the H-9 verification failed to exercise, and it is the
larger of the two on real workloads.

#### Fixed

`clipToolContent()` is now a function of the row and nothing else. A result
over `TOOL_MAX_CHARS` (16,000) becomes a 12,000-character head, a 3,000-char
tail and a spill path — *on the step that produced it*, not retrospectively —
and the backward character-budget walk that decided `keepFull` is gone. The
message array is append-only again, so a row's serialization cannot change once
it has been sent.

The cap is now per row rather than shared across rows, so the prompt is
**larger** than the old budget made it. That is the deliberate half of the
trade: what a provider bills is the miss, not the prompt, so a bigger prompt at
~99% cached costs far less than a smaller one at 55%.

Same four-step workload (`seq 1 3000` ×4), large outputs, measured the same way:

| Step | prompt Δ | cached Δ | per-step | *was* |
| --- | --- | --- | --- | --- |
| 2 | 10,796 | 5,760 | 53.4% | 52.2% |
| 3 | 15,693 | 10,496 | **66.9%** | 55.1% |
| 4 | 20,656 | 15,360 | **74.4%** | 57.3% |
| 5 | 25,288 | 20,352 | **80.5%** | 60.3% |

The decisive column is `cached Δ` against the previous step's whole prompt:
10,496 against 10,596, 15,360 against 15,493, 20,352 against 20,456. The cache
now captures ~99% of everything that existed before the current step; the
remaining miss is only the new output that step just produced, which no prefix
cache can match by definition. So the rate reads 80% rather than 95% because
each step genuinely appends ~15,000 characters, not because the prefix breaks.

In the bytes, the common prefix between consecutive bodies now grows by ~9,900
bytes a step and extends past the whole transcript:

```
step1→2:  9,488 bytes      step3→4: 29,543 bytes
step2→3: 19,625 bytes      step4→5: 39,461 bytes
```

`test/harness.test.js` pins it directly: a result sent once must still be the
same string after two more results arrive, and a clipped row must clip to the
same length whether or not other rows are present. The old suite used `ls` and
`date`, whose output fits the old budget — which is exactly why it never caught
this.

#### Why the H-9 verification missed it

The six-step turn used to prove H-9 ran `ls`, `date`, `pwd`, `whoami`,
`uname -a` — outputs of a few hundred characters each, all of which fit inside
`TOOL_KEEP_CHARS` (12,000). Nothing ever aged out of the verbatim window, so
nothing was ever rewritten and the cache measured 93.5–97%. The fix was real;
the test was too easy. A turn with large tool outputs measures **52–60%**, which
is the number the live install had been reporting all along.

#### Cause

`agent.js::toApiMessages()` recomputes which tool results travel verbatim on
every call, by walking backward from the newest until 12,000 characters are
spent:

```js
for (let i = rows.length - 1; i >= 0; i--) {
  if (rows[i].role !== 'tool') continue;
  if (!keepFull.size || used + len <= TOOL_KEEP_CHARS) { keepFull.add(i); used += len; }
}
```

`!keepFull.size` means the newest result is *always* kept whole whatever its
size; everything older has to fit the remaining budget. So as results arrive,
older ones fall out of the window and their serialization **changes** — from
verbatim to a 600-character head, a 200-character tail and a spill path. The
message array is not append-only, and a prefix cache stops at the first byte
that differs.

Measured directly, three rounds of 30,000-character results:

```
step 1: [30000]
step 2: [916, 30000]
step 3: [916, 916, 30000]
result #1 as sent at step 1: 30000 chars
result #1 as sent at step 3:   916 chars
```

Confirmed in two real request bodies as well. Step 3 truncates step 2's result
at byte 10,529 of the body:

```
step 2:  "…185\n186\n187\n188\n189\n1…"            ← verbatim
step 3:  "…173\n174\n175\n1\n… [full output: …]"   ← clipped
```

#### Why it is expensive out of proportion to its size

The break anchors at the **oldest** result to age out, and that result sits
immediately after the system prompt. So the cacheable prefix is cut back to
roughly the system prompt and stays there for the rest of the turn — every
subsequent step re-bills the whole transcript. It is not a small tail loss; it
is the entire history.

Live four-step turn, large outputs (`seq 1 3000` ×4):

| Step | prompt Δ | cached Δ | per-step | ideal |
| --- | --- | --- | --- | --- |
| 2 | 11,044 | 5,760 | 52.2% | ~96% |
| 3 | 12,076 | 6,656 | 55.1% | ~91% |
| 4 | 12,730 | 7,296 | 57.3% | ~95% |
| 5 | 13,159 | 7,936 | 60.3% | ~95% |

The tell is the cached delta: ~640–900 tokens per step while the prompt grows
by ~12,000. 640 tokens is the clipped form. Only the *already clipped* text is
ever cacheable — each step's freshly-added verbatim result is rewritten at the
next step, so it can never be matched.

#### The design question, which is not mine to settle

Within a turn the message array has to be **append-only**, and any rule that
shrinks the prompt over time breaks that somewhere. So the real choice is
*where* to break, and every option trades behaviour against cache:

1. **Clip by row size, uniformly, from the first appearance.** Each row's
   serialization becomes a pure function of the row, so the prefix is stable
   forever. Costs the model the full text of its *own most recent* output — it
   gets a head, a tail and a `read_file` path instead. This is the only option
   that makes the prefix fully stable, and it is a real behavioural change.
2. **Do not clip during a turn; clip at turn boundaries.** Preserves behaviour
   exactly within a turn, and the prompt grows. Fatal for the case that
   motivated clipping: the live run included a 2.4 MB and a 6.9 MB tool result,
   which the current rule sends whole on the step that produced them and clips
   after — under this option they would be re-sent whole on every remaining
   step of the turn.
3. **Raise the threshold and apply it uniformly.** Most results are far under
   12,000 characters and would never be touched, so behaviour is preserved for
   the common case and only pathological output is clipped — stably. Does not
   bound total prompt size, which is what the budget was for.

A version of (3) — a generous per-row cap, applied uniformly, with the existing
spill file as the escape hatch — looks like the right shape, but it changes what
the model sees on its own output, so it wants a decision rather than a patch.

#### Two more writers of the same shape, not yet addressed

- **`memory_write` rewrites the system prompt.** `memoryBlock()` sits inside it,
  so a memory write changes the head and the next step misses essentially
  everything: the live run's step 27→28 measured 8% (4,321 cached of a 53,214
  prompt), and steps 5 and 27 both wrote memory. Less frequent than the clipping
  fault and more expensive per occurrence.
- **Compaction**, by design, rewrites the transcript. One-off and expected
  (step 22→23 measured 9%), but it means the step after a compact should not be
  read as a regression.

### Layout, for whoever implements the fix

```
byte     0 ..   128   {model, stream, temperature, …, max_tokens}
byte   128 .. 13177   "messages": [ system(8,521 chars), …16 history rows ]
byte 13177 .. 27687   "tools": 19 schemas, 14,410 bytes, serialized LAST
```

Within the system message, by character offset: `# Safety` 859, `## Right now`
**5,489**, `# Who is asking` 5,627, `# Your limits` 7,758.

Worth noting separately: the tool schemas are ~14 KB of *stable* content and
they are serialized **after** the history, so they can never be inside a cached
prefix — every step's history growth moves them. That is a second, larger
saving than the clock, and it is the same fix: stable bytes first.

### The first suspect, from reading the code

`modules/harness/environment.js:200`:

```js
out.push('', '## Right now',
  `time: ${new Date().toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
```

This is computed **fresh on every `block()` call**, and `block()` is called per
step (`agent.js:254`). `snapshot()` is TTL-cached for 5 s (`environment.js:24`),
which is what keeps the *other* volatile readings — free memory, load, uptime —
mostly stable inside a fast tool loop. The clock is deliberately outside that
cache, so it advances on every step regardless.

The author knew about this class of bug — `environment.js:133-140` says so in as
many words:

> **Everything that changes by the second lives at the bottom, under "Right
> now".** … a clock or a free-RAM figure near the top changes the first bytes of
> the prompt each time — which is exactly the prefix a provider's cache, and a
> local runtime's prefill, match on.

The mitigation is correct and it is scoped too narrowly. It keeps the volatile
lines at the bottom of *the environment block*, but that block is only **#3 of
thirteen** in `systemPrompt()` (`agent.js:251-265`). Everything after it —
`clientBlock`, `placeBlock`, `rulesBlock`, `memoryBlock`, `budget.block`,
`settings.block`, `installs.block`, `agents.block`, `missions.block`, `summary`
— sits *downstream* of a byte that changes every step, so none of it can ever be
cacheable. The invariant that matters is not "volatile last within a block" but
"volatile last within the **request**".

### Other candidates, not yet excluded

- **`memoryBlock(userText, …)`** (`agent.js:258`) selects memory using the
  current user message, so it moves between turns — and it sits at position 7,
  ahead of the budget, settings, installs, agents and missions blocks.
- **`budget.block(p, ledger)`** (`agent.js:259`) renders the running ledger.
- **Tool schemas** (`agent.js:735, 758`) are rebuilt per step from a live
  registry read. If their order is not stable, the serialized `tools` array
  changes as well — and it travels in the same request.

These are suspects, not findings. Reading the code tells you what *can* change;
only the bytes tell you what *did*, and there may be a fourth cause that reading
has not suggested.

### Fix shape

The stable parts — charter, the user's system prompt, the environment's facts —
stay byte-identical and first. Anything that changes per step moves after the
history. This is **ordering and serialization only**: no content is added,
removed or reworded, and what the agent is told does not change.

The constraint that makes it safe to ship: behaviour must be identical. If a
change to save tokens also changes an answer, it is not this fix.

### How to close it

- Log the raw request body for two consecutive steps of one turn and diff them.
  The first differing byte names the cause; quote it here.
- The same task rerun, with the per-step cached % shown **before and after**.
- `npm test` stays green.
- Verified on a branch first. Since this is shipped code, it is tagged for
  production only once the before/after is in hand.

---

## H-10 — A thinking model's `reasoning_content` is read, dropped, and then demanded back

**Status:** open, reported from a live mission 2026-09-18. Not caused by any
release here: the field has never been handled, and the provider decides when it
starts requiring it.

### What happens

DeepSeek's thinking-mode endpoint answers with `reasoning_content` beside
`content`, and on a later turn it expects that field sent back on the previous
assistant message. This panel never stores it and never sends it, so once the
endpoint wants it, every later request in that conversation is malformed by the
provider's rules and comes back `400`. The mission is over. Nothing on the host
caused it and no setting here changes it.

### Where it is lost, both times

- **On the way in.** The stream reader takes `delta.content` and
  `delta.tool_calls` from each frame and nothing else, so the field is gone
  before anything could store it.
- **On the way out.** `agent.js::toApiMessages` rebuilds every assistant row as
  exactly `{ role, content, tool_calls }` (`:476-477`). Even a stored field
  would not travel.
- `grep -rn reasoning_content modules public` finds nothing at all.

### Why it kills the turn rather than annoying it

The fallback chain hops on a first-token stall and deliberately on nothing else
— *"a refusal or a bad request is an answer about this request, and moving on
would hide it"*. That is right for a refusal, and wrong here: a `400` caused by
**our** message shape is not an answer about the request, it is the same
malformed request that every rung would receive. So nothing else was tried.

### Shapes of fix, in the order they stand up

1. **Carry what the provider sent back to it.** Keep unknown-but-echoed fields
   on the stored assistant row and put them back on the wire for that provider.
   The rule is per provider, not per model, and it is data rather than code:
   which fields a provider expects returned.
2. **Repair once, then hop.** A `400` whose body names a field or a message
   shape is a repairable request: drop or restore the field and retry once on
   the same rung; if it fails again, treat it as a dead rung and hop, rather
   than ending the turn. Keep the existing rule for `401`, `403`, `429` and a
   genuine content refusal, which are answers about this request.
3. **Say which provider contract is in play.** The panel knows the provider by
   id and applies one request shape to all of them. Whatever carries the
   per-provider rules (settings, a profile, a shipped file the harness can
   update) has to be visible, because the failure it prevents is invisible.

Until one of them lands, a thinking-mode endpoint that requires the field back
cannot be used for anything longer than the turn before it asks.
