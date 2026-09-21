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

**Status:** **partially closed 2026-09-17 on `dev/troubleshoot`, in `main` since
v2.28.0 (`1ee1f0d`) — and deliberately
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

*2026-09-20 follow-up:* v2.37.2 removed the eager `node-pty` import and made
the VM test tolerate installed hypervisors. The terminal regression mocks the
addon: it verifies lazy loading, not native compatibility. Separately, setting
`SNAPSHOT_DIR` in the parent environment reproduces **8 path tests / 6 pass /
2 fail**, both `env !== default`; this is unrelated to the addon. v2.43.1 isolates
all managed paths in the shared test helper and checks default resolution in a
separate process with that variable unset. With inherited snapshot/setup paths,
the full suite passes **348 / 348**, exit 0, on Windows with Node **v24.19.0**.
This does not establish the result of the Linux Node v22.22.1 full-suite run or
re-test the original native-addon failure on v22.22.2.

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

**Status:** fixed 2026-09-17 on `dev/troubleshoot`, **in `main` since v2.28.0**
(`a3a8ac1`). It was a
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

**Status:** fixed 2026-09-17 on `dev/troubleshoot`, **in `main` since v2.28.0**
(`56e4142` — found and fixed with H-9, and released with it). See *Fixed* below
for the before/after. The cause and the reasoning are kept because the
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

**Status:** fixed on `main`, 2026-09-20 — shape 1 below, the field carried back
to the provider that sent it. Reported from a live mission 2026-09-18; not caused
by any release here, since the field had never been handled and the provider
decides when it starts requiring it. The cause and the shapes are kept because
the distinction they draw — a request we malformed versus a request that was
refused — is the part that generalises. **What the live check did and did not
reproduce is written down under *Fixed*; read that before treating the `400` as
settled.**

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

### Fixed 2026-09-20 on `main`

Shape 1, and only as much of it as one field needs.

- **Read.** `streamOrRead` collects `reasoning_content` on both transports — the
  `delta` of a stream frame and the `message` of a plain completion — and never
  hands it to `onText`. It is the model thinking, not the answer, so it reaches
  no screen and no `content`.
- **Kept.** The assistant row stores it as `reasoning: { provider, text }`. The
  provider is the rung that **answered**, which after a hop is not the rung that
  was asked — `complete` now returns `provider` for exactly this, and the row
  would otherwise file the fallback's thought under the primary's name.
- **Returned.** `toApiMessages` puts `reasoning_content` back on an assistant
  message only when the row's own record names the provider the request is
  addressed to. Per provider, never per model: `providers.js` has no notion of a
  model family, and two provider ids pointing at the same endpoint are a normal
  configuration here (`ds`, `dsfb`).
- **Not carried across a hop.** The messages are built for the provider the turn
  starts on, and a stall hands them to another. `withoutEcho` strips the field
  when a rung's provider differs from the one the call was made for — the mirror
  of the rule above, because a field a strict endpoint never asked for is how
  this fails in the other direction.

**What the provider says.** `api-docs.deepseek.com/guides/thinking_mode`, read
2026-09-20: *"for requests carrying the `tools` parameter, the `reasoning_content`
must be fully passed back"*, in all subsequent requests, *"even for turns where
the model did not perform a tool call"*, and *"if your code does not correctly
pass back `reasoning_content`, the API will return a 400 error"*. Without
`tools` the field *"does not need to be passed back; even if passed to the API,
it will be ignored"* — which is why the echo is unconditional for the origin
provider rather than conditioned on the request carrying tools.

**What the live check showed, and what it did not.** Two small calls against
`ds` → `deepseek-v4-pro`, the thinking model this install runs:

| Sent | Result |
| --- | --- |
| turn 1, tools offered, plain question | `200`, `reasoning_content` returned, 132 chars |
| turn 2, tools offered, previous assistant message **without** the field | `200`, no 400 |
| turn 2, tools offered, previous assistant message **with** the field | `200` |

So the fault as recorded — the provider refusing the turn once the field is
missing — **did not reproduce** in a two-turn text conversation, and it is not
claimed to be fixed on the strength of this. What is verified is the half this
repo owns: the field is now read, kept, and put back for the provider that sent
it, and the requests we build carry what the provider's own documentation says
they must. The reported failure came from a mission, whose shape (a tool call
that was answered, then continued) was **not** reached: the second attempt in
that replay was refused before the conversation got there — see the next
subsection. Settling it end to end means two real turns against a thinking model
with a tool call in the first, which spends the user's key on every run, so it is
neither in this document nor in the suite; a scripted stub cannot answer it,
because the rule being tested is the provider's.

**Same session, a second finding: the tool check lied about thinking models.**
Probing the same model for tool support, `tool_choice: {type: "function", …}`
returns `400 Thinking mode does not support this tool_choice` — verbatim, from
the provider. The check asks twice (`auto`, then forced) and read that refusal as
a provider that will not carry tools, so a model that calls tools perfectly well
when one is merely offered was reported as **unable to call tools**. A refusal of
the *insistence* is not the model declining the *call*; the verdict is now `null`
with both facts, and only a refusal of the first attempt — the one that offers
tools rather than requiring them — is still a no. Shipped in 2.30.0, found and
fixed in the same session as this.

### Still open, and deliberately

- **The contract as data (shape 3).** The field name is still a literal in
  `streamOrRead` and `toApiMessages`. Two places, both named in comments, is the
  cheapest thing that works for one field; it is not the general answer, and
  `TODO.md` carries what that would take.
- **Repair once, then hop (shape 2).** Unchanged, and now less urgent: it exists
  to survive a `400` this fix prevents. It stays unbuilt because doing it badly
  hides real errors, and because the trigger is *our* malformed body rather than
  a provider fault — the two want different rules, and the rule has not been
  settled.
- **A conversation already broken by this.** Rows written before the fix have no
  `reasoning` and cannot be repaired — the text was never stored. Such a session
  is still refused by the provider. Starting a new conversation is the only way
  out, and nothing in the panel says so; a session whose rows predate the fix
  could be flagged, and is not.

---

## H-11 — The largest panel file was stored as a binary, so every search silently skipped it

**Status:** fixed on `main`, 2026-09-20. Found while tracing a provider field,
and it had already misled two searches that session.

### What was seen

Searches over the panel returned nothing for things that were there. `grep -n
fallback public/js/harness.js` printed no output at all; `grep -rn hcfg public/`
named one CSS file and no JavaScript. Both read as "this was never built".

The file held **one NUL byte**, at offset 47,306 of 87,816, inside a string used
as a sentinel for "no error to look for":

```js
const body = head && lines.some(l => l.includes(data.mission?.error || '\x00')) ? lines : [head, ...lines];
```

### Why nothing looked wrong

Git sniffs only the first 8 KB for a NUL to decide whether a blob is binary, and
this one sat at byte 47,306 — so `git diff`, `git show --stat`, the line counts
and the blame were all normal, and the file loaded and ran. Only two things
noticed, and both said nothing rather than complaining:

- `grep` classifies the **whole** file as binary and prints no matches for it. No
  warning; an empty result, indistinguishable from a real absence.
- `file` reports `data` instead of `JavaScript source, UTF-8 text`.

The cost is not the byte, it is the belief: **a search that returns nothing is
read as proof that nothing is there.** It was, twice.

### Fixed

The sentinel is a plain conditional — `data.mission?.error && lines.some(l =>
l.includes(data.mission.error))` — which is also what it meant. Behaviour is
identical, because `includes('')` is true of every string and that is the trap
the NUL existed to dodge.

Guarded by `test/status-lines.test.js`: *"no source file is stored as a binary"*
walks `public/js` and `modules` and fails on any file containing a NUL. Verified
by planting one: the test fails, and passes again without it.

### Not fixed, and deliberately

`public/js/harness.js` is the only file in the repo with CRLF line endings (1,879
lines; every sibling is LF). It is invisible here and breaks nothing the way the
NUL did — but the first edit that normalizes it will rewrite every line and cost
`git blame` for the file. Normalizing is a one-line decision someone has to make
on purpose, not a side effect of another change, so it is recorded rather than
done.

---

## H-12 — A specialist can read the Orchestrator's chat, and the inventory handed out every conversation

**Status:** fixed on `fix/audit-2.45.1`, 2026-09-20, **v2.46.0**. Found by the
`af416bd..origin/main` audit (`docs/audit-2.45.1.md`, finding F1). Minor rather
than patch because it deliberately changes what a level can see.

### What happens

Two operations in `work_chats` ran **above** the reporting-line gate:

```js
if (args.action === 'list') return list(args);          // no caller consulted
if (args.action === 'read') { … memory.messages(id) … } // no caller consulted
```

`list()` returned every conversation to every caller and named the main session
in `main`, so a specialist could discover the Orchestrator's id and then read its
history verbatim with `read`/`transcript:true`. `ALWAYS_FOR_SPECIALISTS`
(`modules/harness/agent.js:322`) force-grants `work_chats` to every specialist,
and `MAIN_TOOLS` gives it to the Orchestrator, so no caller was ever without it.

Driving the real tool layer in a throwaway data dir, on the pre-fix source:

```
list as specialist   -> sessions: 3 | Orchestrator, Errand, Work leader
READ SUCCEEDED (leak): [{"role":"user","content":"PRIVATE: my main-chat secret is hunter2."}]
tools.call work_chats read -> {"id":"s_…","title":"Orchestrator","kind":"orchestrator", …
```

The list was not reconnaissance only. Every row carries `brief` — up to 600
characters of that conversation's last answer (`short(value, 600)`,
`modules/harness/organization.js:8`, written after every turn at
`modules/harness/agent.js:955`) — so the unfiltered list was the same content
leak as `read`, in miniature, one row per conversation.

### Cause

The two read actions were written to return early, and the `canManage` gate that
`send`, `stop`, `archive` and `recall` all pass through sits below them. Every
action that *changes* something was guarded; the two that only *read* were not.
A specialist's own `send` to main was already refused by that gate — the
asymmetry was visible in the test immediately above the one added here.

### Fixed

**v2.46.0, `fix/audit-2.45.1`** (`modules/harness/organization.js`,
`modules/harness/tools.js`). One rule, the one the write actions already use:
`canManage(actor, target)`.

- `read` is refused with the existing `'This conversation is outside your
  reporting line.'` 403.
- `list` is **filtered**, inside `list()` and before its slice — not by
  discarding rows from the returned page, which would leave `total` and every
  `offset` wrong for a caller who pages. `viewer` is a new optional argument, so
  the direct `org.list(…)` calls in the tests keep the index they assert.
- The rule is `canManage` alone. Ancestors are deliberately **not** admitted:
  `ancestors()` always ends at the main session, so an ancestor clause would have
  re-admitted the Orchestrator to every specialist — the same fault, reopened.
- `block()`'s `'Full inventory and archives: work_chats list.'` became untrue for
  a leader the moment the list was filtered, so it now reads `'The inventory and
  archives: work_chats list.'`.

What each level sees: the Orchestrator, everything (unchanged); a work leader,
itself and its own line; a specialist, itself. A conversation always reads
itself, and `main` is still named in the response to every level, because it is
the id work is addressed with.

### Collateral, handled in the same commit

- **A leader no longer sees other leaders' chats.** That is a real change to a
  documented feature, and it is the intended cost of closing the `brief` leak
  rather than an accident of the filter. `README.md:189-192` stays true for the
  Orchestrator.
- **`GET /api/harness/environment` (`modules/harness/routes.js:249-250`) is
  deliberately untouched.** It calls `organization.block(id, …)` with the
  session the panel is showing, and its reader is the **user**, who sits above
  the organisation and is not a peer subject to `canManage`. A second gate there
  would break the panel for no one's benefit.
- **`test/harness.test.js:168-169` pins that a specialist is *offered*
  `work_chats`.** The fix changes what the tool returns, not what is offered, so
  that test stays green — and if it ever goes red, the fix took the wrong route
  (withdrawing the tool) instead of gating it.

### Verified

- `test/organization.test.js` — *"a conversation reads only what it manages, and
  the inventory is the same line"*: a specialist's `read` of main and of a
  sibling branch is refused; a leader does not read a sibling branch; a leader
  reads its own line's transcript in full; a conversation reads itself; the three
  levels' lists are each asserted by id; the Orchestrator's list is unchanged in
  size, and `main` is still named to every level. The secret brief and the
  private transcript of the other branch are asserted **absent from the whole
  serialised response**, not just from `sessions`.
- Mutation-checked: with `modules/harness/organization.js` and
  `modules/harness/tools.js` reverted the new test fails (`not ok 3`), and passes
  again with them restored. The suite is 365/365, exit 0, from a green 364/364
  baseline.
- End-to-end against the real tool layer in a throwaway `DOCA_DATA_DIR` with a
  throwaway `CONFIG_PATH` — the same probe, after the fix: a specialist's list is
  one row (itself), a leader's two, the Orchestrator's three, and both
  `organization.tool` and `tools.call('work_chats', …)` refuse the foreign read
  with status 403.

### Not fixed here

`agent_results` (`modules/harness/tools.js:557-585`) and `agent_resume`
(`:537-554`) are in the same class, and **unequally so** — the distinction was
nearly lost when this entry was first written, so it is stated exactly:

- `agent_results` **is** guarded, but only inside its wait branch. `wait:true`
  demands `org.canManage(ctx.sessionId, m.sessionId)`; the plain read of a
  finished mission's `result` has no check at all.
- `agent_resume` has **no** check anywhere: it resumes or drops any paused
  mission the caller names.

`registry.NEVER` keeps both out of specialists, so the exposure is a work leader
reaching another leader's mission. `agent_resume`'s openness is deliberate for
the Orchestrator; the question is whether `by` should gate the rest. That is a
separate decision about mission ownership, recorded as **H-17** rather than
folded into this entry.

---

## H-13 — A saved fallback's context window is deleted by opening the settings and pressing Save

**Status:** fixed on `fix/audit-2.45.1`, 2026-09-20, **v2.46.1**. Found by the
`af416bd..origin/main` audit (`docs/audit-2.45.1.md`, finding F2). Committed and
untagged: `public/js` needs a browser look before the tag (AGENTS.md:111).

### What happens

A fallback rung's served context window is one of the three things a chain entry
carries — `{ provider, model, contextWindow? }` (`modules/harness/providers.js:134`).
The settings form reads it and writes it correctly at both ends. The **mount in
the middle** rebuilt each rung from two fields:

```js
for (const e of saved) harnessFallbackAdd(id, { provider: e?.provider || '', model: e?.model || '' });
```

So a chain stored with a window of, say, 65536 reopened showing `0` in that box —
which the form draws for "unknown", and which is also what an untouched box
holds. Pressing Save then ran `_fallbacksRead`, whose rule is *omit the window
unless it is a positive number* (`public/js/harness.js:594-596`), and every rung
in the chain was written back without one.

The value was not merely displayed wrong. It was **deleted**, silently, by the
one action the form exists for, and the deletion persisted.

### Why nothing looked wrong

Every seam looked correct on its own:

- `_harnessRungHtml` renders the window (`:494-495`), so the field is there.
- `_fallbacksRead` returns it (`:594-596`), so the field is saved.
- The hint under the box (`:497-499`) states the rule the form is supposed to
  follow — *"0 means unknown; it never inherits the primary model's window"*.

Only the mount dropping it was wrong, and it was the one piece of the round trip
nothing exercised. The existing test extracted `_fallbacksRead` alone and drove it
with rungs it built itself, so it asserted the reader against its own inputs and
could not see what the mount had fed it.

### What it cost

`rungsFor` reads each chain entry's window on every turn
(`modules/harness/agent.js:633-634`, `contextWindow: budget.windowFor(c)`,
`windowSetting: harness.config.doca.fallbackChain[n].contextWindow`), and the
preflight enforces a window that is present (`budget.js:70-72`; `budget.windowFor`
returns 0 for anything not a positive number, and `preflight` returns `null` —
no check — when the window is 0). So a window the user set in the panel held only
until the next time the settings were opened and saved, and after that the rung
was checked against nothing.

### Fixed

**v2.46.1, `fix/audit-2.45.1`** (`public/js/harness.js:565-567`). The mount
forwards the window, and forwards it the way the reader carries it — present only
when it is a positive number — so **opening ⚙ and pressing Save is now a fixed
point on the stored chain** rather than a rewrite of it:

```js
for (const e of saved) harnessFallbackAdd(id, { provider: e?.provider || '', model: e?.model || '',
  ...(Number(e?.contextWindow) > 0 ? { contextWindow: e.contextWindow } : {}) });
```

Nothing else moved: the renderer, the reader, the cap, the duplicate-drop
(`provider`+`model` only) and `_harnessLoadModels`'s preselection are unchanged.

### Collateral

- **This does not start enforcing anything new.** The preflight already read and
  enforced a stored rung window; what changes is that declaring one now *lasts*.
  A window the user cleared to 0 stays cleared and stays unenforced — clearing
  the box was never the broken half. Stated because the opposite is the natural
  guess: a fix in a settings form looks like it could tighten a verdict.
- The sentence at `:497-499` (*"0 means unknown; it never inherits the primary
  model's window"*) becomes true of the form's own behaviour. Before this it was
  a claim the form did not honour, since a window it never restored was a window
  it could not keep.
- A saved **chain** is only ever written by the panel, so no other writer was
  working around the deletion.
- **The file itself.** `public/js/harness.js` is the only CRLF file in the repo
  and it is mixed (H-11). The first edit of the fix rewrote every line ending in
  the file — 176 lines nobody had touched — because the editor normalises the
  whole file. It was caught by comparing `git diff --stat` against the size of
  the intended change, and the patch was rebuilt byte-exactly from
  `git show <rev>:public/js/harness.js` with explicit `\r\n`. The committed diff
  is the 9 lines of the fix and nothing else. Anyone editing this file should
  check the same thing; the suite cannot see it.

### Verified

- `test/harness-awareness.test.js` — *"a saved fallback window survives being
  opened and saved again"*. The mount is **run**, not read: it draws into a stub
  box and calls two spied dependencies, `harnessFallbackAdd` (one call per saved
  rung) and `harnessRungProbe` (which the mount calls for every rung it finds and
  which would otherwise reach for the network). It asserts the presets the mount
  hands over equal the saved chain, that both rungs are still probed on open, and
  that the cap still trims.
- The other two legs are run for real rather than re-stubbed: the rung is rendered
  by the real `_harnessRungHtml`, the window is read out of the rendered
  `value="…"` attribute — which is what the browser does with it — and the result
  is fed to the real `_fallbacksRead`, which must return the chain it started
  from. No DOM behaviour is invented.
- Mutation-checked: with `public/js/harness.js` reverted the new test fails and
  passes again with it restored. Suite 366/366, exit 0.
- **Not yet seen in a browser.** A DOM stub is a claim about the browser and has
  been wrong in this repo before (AGENTS.md:111), so the panel check is handed
  over rather than assumed, and the tag waits on it.

---

## H-14 — The Orchestrator is never told a mission exists

**Status:** fixed on `fix/audit-2.45.1`, 2026-09-20, **v2.46.2**. Found by the
`af416bd..origin/main` audit (`docs/audit-2.45.1.md`, finding F3). Introduced by
`19c25eb` (2.45.0), which made `profileFor` the default for every non-specialist
session.

### What happens

The Orchestrator's prompt carried no `# Missions` section, so the one level that
dispatches missions was the one level never told about them. A mission that
finished, failed, or was cut off by a restart sat unannounced; the Orchestrator
could not ask the user whether to continue a paused one, because it did not know
one was waiting.

The README states the opposite in two places (`README.md:264-267`):

> Finished and failed missions appear in the originating conversation's next
> model request, in the panel readings after the transcript. […] Older missions
> **without a conversation recorded can notify the next orchestrator
> conversation.**

`missions.notices` admits exactly that case — `(!m.by || m.by === sessionId)`
(`modules/agents/missions.js:442`) — and the code path that would have consumed
it was skipped for the Orchestrator too, so the promise could not hold even by
accident.

### Cause

Three sites in the turn gated mission state on whether the session had a
**profile**:

```js
const completed = profile ? [] : missions.notices(session.id);
… profile ? '' : missions.block({ sessionId: session.id, completed })
… if (!profile) missions.acknowledgeNotices(completed);
```

The test was written for the specialist, and it reads as a fair one: a specialist
is inside a single errand, so the mission board is noise. But `profileFor`
synthesises an **Orchestrator** profile (`modules/harness/organization.js:175`,
`level: 'orchestrator'`), so "has a profile" is true of the Orchestrator as well.
The gate meant to exempt the narrow end excluded the broad one. A work leader has
no profile at all, which is why the fault looked like it only touched one level.

### Fixed

**v2.46.2, `fix/audit-2.45.1`** (`modules/harness/agent.js`,
`modules/harness/routes.js`). The question is asked once, of the profile's
`level`, in one place:

```js
function isMissionProfile(profile) { return !!profile && profile.level !== 'orchestrator'; }
```

and everything else goes through it — `turn()` at `:1141`, `:1145` and `:1194`,
`breakdown()` at `:1372`, and the panel's environment view through
`missionsFor()` (`:373`). This is the arrangement `disabledFor`'s own comment
argues for: two copies of a question let the prompt the panel reports and the
prompt the model receives disagree.

Only the Orchestrator's profile carries a `level` at all — a specialist's is
assembled from its definition (`agents/missions.js` `profileOf`) — so
`isMissionProfile` answers today's question for every other level and flips only
the Orchestrator. Every non-Orchestrator prompt is byte-identical to before this
commit; that is asserted by the existing mission-completion test, which runs a
profile-less work session and still passes.

### Collateral, handled in the same commit

- **`breakdown()` measured no mission section in either branch**, so the moment
  the block began to be sent the panel's size accounting would have under-reported
  the prompt by its size. A `missions` section is now measured in both branches
  (`:1378`, `:1394`); `measure` drops an empty one, so a specialist needs no
  branch of its own.
- **The panel's environment view now shows it.** `GET /api/harness/environment`
  (`modules/harness/routes.js:254`) builds `readings` from `organization.block`
  and previously omitted the mission block. Its stated purpose is to show the
  user what the agent was told, so it now appends `agent.missionsFor(id)` — the
  same helper the turn uses, which keeps the view honest for the levels that are
  told and silent for those that are not. This is the "decide either way" from the
  audit, decided yes.
- **The block stays in the after-history readings** and not in the cached prefix
  (ISSUES.md H-9). The new test asserts the notice is absent from `messages[0]`
  and present in the last message, which is the same shape the existing
  completion test pins.
- **Acknowledging for the Orchestrator is not a no-op, and is not described as
  one.** `missions.notices` also admits `!m.by`, covering rows written before
  `by` existed and any context-less dispatch, so the Orchestrator can now consume
  a notice a work leader would otherwise have received. Acknowledging exactly the
  snapshot that reached a successful reply is still the right behaviour; the
  corner is recorded rather than smoothed over.

### Verified

- `test/harness.test.js` — *"the Orchestrator is told about missions, and a
  specialist mid-errand is not"*: the Orchestrator's turn carries `msn_orch … NEW
  done` and `msn_paused … PAUSED` in its last message, **not** in `messages[0]`,
  and the notice is consumed; the specialist's turn carries no `# Missions` at all
  even with a paused mission seeded, which is the half of the gate that is
  deliberate and would otherwise be deleted by the next person to read it.
- *"the panel measures the mission block it is now sent"*: `breakdown()` reports a
  non-zero `missions` section for the Orchestrator and a work leader, none for a
  specialist, and `GET /api/harness/environment?sessionId=` shows the block to the
  first and not to the second.
- Mutation-checked both ways: with `modules/harness/agent.js` reverted both new
  tests fail; with the predicate forced to `false` (awareness for everyone) both
  fail again, the specialist one on its own message *"a specialist is not shown
  the mission board"*. So neither half of the gate can be removed unnoticed.
- Suite 368/368, exit 0.

### Not fixed here

`agent_results` and `agent_resume` still check no ownership — **H-17**.

---

## H-15 — A picture shown mid-turn splits the turn into two summary lines

**Status:** fixed on `fix/audit-2.45.1`, 2026-09-20, **v2.46.3** — and revised in
**v2.46.5**. Found by the `af416bd..origin/main` audit (`docs/audit-2.45.1.md`,
finding F4). **Both tagged and pushed 2026-09-21**, the tags applied
retroactively at the user's direction. One thing is still open on this entry: the
browser look (AGENTS.md:111) was **not** done, and the tags did not wait for it —
see the last bullet under **Verified**.

The first fix stopped the turn splitting in two and gave the picture a row of its
own, but it left the sentence that introduced the picture inside the summary —
so the picture had nothing left to sit beside, fell to the end of the turn, and
stacked against every other picture there. A turn that showed a picture under
"Here is the data you asked for:" drew the summary line, then the picture, then
the answer, with the sentence nowhere: the picture read as though it came last,
and two pictures in one turn came out adjacent. v2.46.5 gives the sentence back.
See **Shown, not summarised — and shown under its own sentence** below.

### What happens

One turn that shows a picture comes out as **two** finished-run lines instead of
one — "1 command", then "1 step" — for the same turn. It is not a live-only
artifact: the harness rebuilds the transcript at the end of a turn, so the reload
shape and the watched shape are both wrong, and they are wrong the same way.

Driven against the real `collapseFoldRuns` over the shape a picture actually
produces — user, tool call, picture, tool result, answer — before the fix:

```
assert.equal(box.querySelectorAll('.agent-working').length, 1, 'one turn, one summary line');
  expected: 1
  actual:   2
```

### Cause

`collapseFoldRuns` makes two separate decisions about every child, and a picture
got both wrong — in opposite directions:

```js
const isWorking = el => isRow(el) || (isBubble(el) && !isUser(el) && !el.classList.contains('agent-image'));
…
if (isWorking(child)) { run.push(child); continue; }
flush(true);                       // a user message, or a picture: the turn ended here
```

The `agent-image` clause in `isWorking` is **dead**: an image is not a bubble
(`isBubble` knows only `hc-msg`/`chat-msg`, `utils.js:659`), so the condition is
already false for it and the clause changes nothing. The comment on the `flush`
line is the live fault: a picture arrives *in the middle* of a turn — between a
tool call and its result — so treating it as a boundary ended the run early and
started a second one with the remainder. Two runs, two summaries, each counting
its own half of one turn.

### Why the obvious fix was not the fix

The audit recorded this as having no small collateral-free fix, having considered
only mounting the picture *into* the working block. That is genuinely defeated by
the CSS: a live block hides every row but the last
(`components.css:1087`, `.agent-working.live > .agent-working-items >
*:not(:last-child)`), so a picture inside it would be visible only until the next
row arrived — and once the block is done, the whole body is hidden (`:1089`), so
the picture would vanish entirely.

The mistake was in the search, not the CSS. The split is caused by the `flush`,
not by the picture's position: leaving the picture exactly where it is and letting
the run continue across it gives one block, inserted at the run's first row, with
the picture after the collapsed record and before the answer — which is where the
live path already puts it (`agentWorkingClose` lifts the answer past it). Live and
reload become identical, one line each, with no CSS change and no change to the
chat's structure.

### Fixed

**v2.46.3, `fix/audit-2.45.1`** (`public/js/utils.js`). A picture neither joins
the run nor ends it:

```js
if (isWorking(child)) { run.push(child); continue; }
if (isOutput(child)) continue;      // shown, not summarised, and not a boundary
flush(true);                        // a user message: the turn ended here
```

with `isOutput` as its own named predicate (`:615`) so the next reader can see
that a picture is a third kind of row rather than an exception to the second. The
dead `agent-image` clause is gone from `isWorking` (`:609`). In the same file:
`FOLD_RUN_KEEP` (`:586` before this commit) is deleted — declared, never read
anywhere in source, tests, CSS, HTML or docs, and its keep-3 behaviour no longer
exists — and the doc comment above `collapseFoldRuns` is rewritten, because it
still described "the last rows of a finished run stay … behind '…'", which stopped
being true when every run began collapsing to one row.

### Shown, not summarised — and shown under its own sentence (v2.46.5)

The v2.46.3 fix is necessary and was not sufficient. A picture kept its own row,
but the run continuing across it meant the *sentence* the picture was shown under
stayed in the summary — and a picture with nothing left to sit beside does not
stay put. It falls to the end of the turn, above the answer and below everything
else the turn drew, so a picture shown first thing reads as though it came last
and two pictures in a turn come out adjacent:

```
▸ Thought for 12s · 2 commands
[ picture 1 ]
[ picture 2 ]
And here is the picture explained.
```

The sentence that introduced each picture is nowhere in that rendering. The
answer already gets given back for exactly this reason — "the thing that was
being waited for is never inside the summary" — and a sentence framing something
the user is about to *look at* is not the account of the turn either.

The row to give back is the **last bubble in the run, not the trailing one**. The
call that showed the picture is drawn after the sentence and before the picture
(`agent.js:1256` emits `image` between `tool_call` and `tool_result`), so a rule
keyed on trailing bubbles finds the call and gives back nothing:

```js
if (isOutput(child)) {
  const at = _lastBubble(run);
  if (at >= 0) run = run.slice(0, at).concat(run.slice(at + 1));
  continue;
}
```

`_lastBubble` only ever finds a non-user bubble, because `isWorking` is what put
the row in the run and it excludes the user's own message. The row is dropped
from the run rather than moved: `_foldRunCollapse` *moves* every row it is given
into the block, so a row left out keeps its place in the transcript. That is what
makes a middle element givable-back at all.

The live path needs the same rule, and the live block is already built by then —
`collapseFoldRuns` skips it, because a `.agent-working` child ends the run. So
`agentWorkingGiveBack(container)` walks the open block from the end for its last
bubble, and both `_chatAppendImage` (`chat.js:202`) and `_hcAppendImage`
(`harness.js:1447`) call it **before** appending the picture — after would put
the picture above its own sentence. It is a no-op on a reload, which has no open
block, so the two reload paths still go through the walk.

`agentWorkingClose` now calls the same helper with `{trailing: true}` for the
answer instead of carrying its own copy of the loop. One implementation, because
a picture given back in the live chat and the same turn given back on a reload
must agree — which is the property `disabledFor` (`agent.js:325-332`) exists to
protect after the two copies of it disagreed once already.

Result, identical live and reloaded:

```
▸ Thought for 12s · 2 commands
Here is the data you asked for:
[ picture: test-render-2.png ]
And here is the picture explained.
```

### Collateral

- **No CSS changes, deliberately.** The picture is kept outside the block
  precisely so the two rules above cannot hide it. A future change that moves it
  inside must deal with both.
- **`isBubble` does not know `.agent-image`**, and that is now recorded beside it
  (`:659`) rather than left as a trap: `flush` gives back the run's trailing text
  bubbles so the answer is never hidden, and a picture is not text — so a picture
  as a run's *last* row would strand the answer inside the summary. Unreachable
  today, since a picture is only drawn between a call and its result and an answer
  ends the turn. The failure would have looked like a lost reply.
- **The live path and both reload paths converge**, which is the point:
  `closeFolds` (`utils.js:551-563`) runs this walk over the *live* DOM at end of
  turn, so there is one implementation rather than one per path.
- The alternative — replacing the block with a timestamp-derived span — was
  rejected because it would trade the live block's measured duration
  (`Date.now() - dataset.startedAt`) for a coarser estimate.
- **The voice loop has no `image` branch.** The typed path handles one
  (`public/js/chat.js:539`); the streaming loop inside `_callProcessAudio`
  (`:745-875`) chains `thinking`, `text`, `tool_call` and `tool_result` and stops
  there, so a picture shown during a voice call appears only on the next history
  load. Out of scope for this entry and not half-fixed — it is a separate
  question about what a voice call should *do* with a picture — and recorded in
  TODO.md instead.

### Verified

- `test/fold-runs.test.js` — *"a picture shown mid-turn does not split the turn
  into two summaries"*. The figure carries an `img` child **on purpose**: the
  empty-node sweep spares a node containing media, so a bare `.agent-image` would
  be removed and the test would pass while the browser did something else. That
  is how the audit's first probe of this went wrong, and it is why the stub
  models it. The test asserts one `.agent-working`, the picture surviving as its
  own row after the collapsed record, the answer last, and both of the turn's rows
  inside the one block. The existing ten tests in the file stay green.
- The failing assertion above was captured **before** the fix, against the real
  function — the executed evidence, not a reading.
- Suite 369/369, exit 0, at v2.46.3.
- v2.46.5 adds three, and the load-bearing one is the third:
  - *"a picture is shown under the sentence that introduced it, not at the end of
    the turn"* — the walk, over the real row order (sentence, call, picture,
    result, answer): one summary line, the sentence standing above the picture,
    the picture above the answer, and the block still down to three rows so the
    folds collapse. The figure carries an `img` child for the same reason as
    above.
  - *"the live chat gives a picture its sentence by the same rule"* — the open
    block, driven through `agentWorkingOpen`/`Mount`/`Close` and asserted to
    produce the identical shape.
  - *"both transcripts give the sentence back before they draw the picture"* —
    extracts `_chatAppendImage` and `_hcAppendImage` from `chat.js` and
    `harness.js` and asserts the **order** of the two calls. The helper working
    is not the picture using it, and neither the walk nor the helper test can see
    the wiring; this is the only test that can.
- Mutation-checked all four ways, each reddening exactly one test: the walk
  reverting to `if (isOutput(child)) continue`, the walk giving back trailing
  bubbles instead of the last one, `chat.js` dropping the call, and `harness.js`
  dropping it. Suite 375/375, exit 0.
- **Not yet seen in a browser — the one thing still open on this entry.** A DOM
  stub is a claim about the browser and has been wrong in this repo before
  (AGENTS.md:111). The tags were applied at the user's direction on 2026-09-21
  with this check outstanding, so it did not gate them. What to look at: a turn of
  text → `show_media` → text, in the Harness and in the floating chat — the
  picture under the sentence that introduced it, one summary line for the turn,
  the answer last. If the browser disagrees with the stub, this entry reopens; the
  tags stay where they are.

---

## H-16 — `reports` grow without bound, and every report rewrites the index per ancestor

**Status:** fixed on `fix/audit-2.45.1`, 2026-09-20, **v2.46.4**. Found by the
`af416bd..origin/main` audit (`docs/audit-2.45.1.md`, finding F5).

### What happens

Every work and specialist turn appends a report to the conversation's ancestors,
and nothing ever removes one. The Orchestrator therefore accumulates a `turn
completed` note from every conversation beneath it, forever, in a file that is
re-serialized whole on every write. Measured through the real `report()`:

```
after create:            sessions.json    1610 bytes |    1 reports on the Orchestrator
after  100 more turns:   sessions.json   61017 bytes |  101 reports
after 1000 more turns:   sessions.json  656797 bytes | 1101 reports
```

≈576 bytes per report, linear and uncapped. The size is only half of it: a
further 5000-turn batch did not finish inside 120 seconds, because the cost of
each write is proportional to the file the previous report grew.

### Cause

Two independent faults, which is why the fix has two parts.

```js
function report(id, type, text, by = 'agent') {
  for (const target of ancestors(id)) {
    const row = memory.getSession(target);
    memory.updateSession(target, { reports: [...(row.reports || []), note] });
  }
}
function acknowledge(id, notes) { … map(n => ids.has(n.id) ? { ...n, readAt: … } : n) }
```

`report()` appends and never trims; `acknowledge()` only stamps `readAt`, so an
acknowledged report is marked as seen and kept forever. And the fan-out loop
calls `updateSession` once per ancestor — `memory.updateSession` reads and
rewrites the entire index (`memory.js:167-174`) — so one report from a level-3
specialist cost two full rewrites of `sessions.json`.

### Fixed

**v2.46.4, `fix/audit-2.45.1`.**

**The bound** (`modules/harness/organization.js`, `REPORTS_KEEP = 50`). Applied
on both paths that write the array — `report()` and `acknowledge()` — through one
`trimReports()`:

```js
/**
 * Drop old read reports, keep every unread one, and preserve the order.
 */
function trimReports(list) {
  const read = list.filter(n => n.readAt);
  const excess = read.length - REPORTS_KEEP;
  if (excess <= 0) return list;
  const drop = new Set(read.slice(0, excess).map(n => n.id));
  return list.filter(n => !drop.has(n.id));
}
```

It filters rather than reorders, because `reports` reads oldest-first everywhere
it is shown and a trim that moved the unread ones to the front would make the
history jump about as things were read. It drops the *oldest* read reports, so
the recent history is what survives.

**The write** (`modules/harness/memory.js`, `updateSessions(ids, make)`). One
read, one write, one shared `updatedAt` for the whole fan-out, which is what a
fan-out is. An id that is not in the index is skipped rather than created; that
branch is unreachable from `ancestors()` — it guards the parent walk
(`organization.js:30`) and takes `main` from the index — and it is written that
way so a report can never *create* a conversation.

### No new field, so no read-side default

AGENTS.md:28 asks for a read-side default whenever something is added to a state
file. **Nothing was added.** The trim is a filter over an array that already
existed, and the field it keys on already existed: `readAt` has meant "read"
since it was introduced, and an entry without one has always been unread —
`notices()` is defined as exactly that filter (`organization.js:82`).

That makes an index written before this release correct as-is, and it is why
**an old report cannot be trimmed by the first run of the new code**: it has no
`readAt`, so it counts as unread, so it is kept. There is no migration to write
and none was written.

### Collateral

- **The report history is now finite, and that is the point.** `work_chats read`
  returns `reportTotal` and a page of the array (`organization.js:256`), so a
  conversation's report history stops at 50 read entries plus however many are
  unread. That is a deliberate reduction in what is kept, not a leak — the
  alternative was the measurement above.
- **The F3 interaction, checked rather than assumed.** The plan flagged that
  trimming on `readAt` is only safe if something can acknowledge what grows.
  `organization.acknowledge` is called unconditionally for every session kind at
  the end of a turn (`agent.js:1195`); F3's gate is on the line above
  (`missions.acknowledgeNotices`, `:1194`) and does not touch this one. So any
  conversation that runs a turn acknowledges the reports it was shown, and those
  become trimmable. A conversation that never runs again keeps its unread reports
  forever — and an unread report is never trimmed. **Nothing that no one can
  acknowledge is ever dropped.**
- **The per-ancestor loop is gone from `report()` only.** `create()`, `archive()`,
  `plan()` and the `brief` write in `tool()` still call `updateSession` once
  each, which is correct — each touches one session. `updateSessions` exists for
  the fan-out and is not a general replacement.
- **`updatedAt` for a fan-out is now one timestamp.** Previously each ancestor
  took its own `new Date()` a few milliseconds apart; now they share one. No
  reader orders by it (`list()` sorts by state, not time), and one moment is the
  more accurate description of a single report.

### Verified

- `test/organization.test.js` — *"reports stay bounded: read history is trimmed,
  unread is never"*, seeding 80 read reports plus one with no `readAt` (what an
  index written before this release holds) plus one unread, then reporting
  through the real `report()`: the read history lands on exactly 50, the three
  unread survive in their original order, and the newest read report is kept
  while the oldest is not.
- *"acknowledging bounds the array too, and keeps the most recent"* — 85 unread
  acknowledged at once leaves exactly `a35…a84`, and the unread count still
  reaches zero.
- *"one report is one index write, however many superiors it reaches"* — a
  specialist's report reaches two superiors and produces **one**
  `store.writeJson('harness/sessions', …)`, asserted by spying the store, with
  both superiors' arrays checked in that single document.
- Each of the three was mutation-checked against the real code: disabling the
  bound reddens the first two, trimming unread entries reddens the first,
  dropping the newest instead of the oldest reddens the first two, and restoring
  the per-ancestor loop reddens the third. Suite 372/372, exit 0.
- No browser check is owed: this entry changes no panel code and makes no claim
  about the DOM.

---

## H-17 — `agent_results` and `agent_resume` act on a mission by id, with no check on whose it is

**Status:** open, not fixed. Surfaced while fixing H-12 (the same class of fault:
a tool whose answer depends on the caller, with no caller in the condition) and
deliberately left out of that commit — it needs a decision about mission
ownership, and the entry below is that decision written down rather than taken.

### What happens

Two tools take a mission id and act on it:

- **`agent_results`** returns any mission's `result` to any caller holding the
  tool. `missions.get(mission)` (`tools.js:574`) looks a mission up by id with no
  caller in the question, and the finished branch returns `m.result` verbatim
  (`:588-589`).
- **`agent_resume`** resumes or drops **any** paused mission the caller names —
  `missions.resume(mission, { go })` (`tools.js:550`), and `resume()` itself takes
  the id and acts (`missions.js:373-386`).

Neither is reachable by a specialist: `registry.NEVER` (`registry.js:55`) keeps
both out of a definition's allowlist, it is subtracted again at turn time
(`agent.js:986`), and `agent_dispatch` goes with them while specialist agents are
switched off (`tools.js:861-864`). So the exposure is **one work leader reaching
another leader's mission**, or the Orchestrator reaching any — and for the
Orchestrator that is the intended behaviour, not a fault.

The two are not equally exposed, and the difference is the point of writing this
down separately from H-12:

- `agent_results` **does** check ownership in its `wait` branch
  (`tools.js:576-579`, via `organization.canManage`), so the bounded wait is
  already gated. What is ungated is the plain read of a mission that has already
  finished — the `result` itself, which is the mission's whole answer.
- `agent_resume` has **no** check anywhere, in the tool or in `missions.resume`.

### Why it is not simply "add `canManage`"

`canManage` answers "is this in my reporting line", which is the right question
for a conversation and only half the right question for a mission. A mission
carries `by` — the conversation that dispatched it (`missions.js:263-264` throws
for a specialist, so `by` is always a level that owns missions). Two rules are
available and they differ:

- gate on `by` — the dispatcher, and only the dispatcher, reads or resumes its
  own mission;
- gate on `canManage(caller, mission.by)` — anyone above the dispatcher as well,
  which is what lets the Orchestrator resume a paused mission the user has just
  been asked about, and is why `agent_resume` is open in the first place.

The second is the behaviour that exists today for the Orchestrator and is
probably the one to keep, made explicit rather than incidental. The first is
narrower and would break the paused-mission flow H-5's recovery path depends on.

### How to close it

- Decide which of the two rules above is the contract, and write it down — this
  is the part that is not mechanical.
- Apply it in one place: `agent_results`' read path and `agent_resume`'s `run`
  should call the same predicate, and the `wait` branch's existing check should
  move onto it rather than keeping a second copy of the rule. `disabledFor`'s
  note at `agent.js:325-332` is the precedent for why it must be one
  implementation: two copies is how the prompt the panel reports and the prompt
  the model gets came to disagree once already.
- Add the mirror tests — a leader reads its own mission, a leader is refused a
  sibling's, the Orchestrator is allowed — in `test/organization.test.js`, beside
  the existing `agent_results` test at `:133`.
- Bump and reference this entry. It is a behaviour change to a tool, so it is a
  **minor**, not a patch (AGENTS.md:28).

---

## H-18 — A turn led by the backup model because the main stalled a moment ago happens in silence

**Status:** fixed on `fix/audit-2.45.1`, 2026-09-20, **v2.46.6**. Found while
answering "is the fallback swapped with the main?" — the answer was *not yet,
except here*, and the exception was invisible.

### What happens

The chain is per model and the configured model leads it, by construction:
`rungsFor` puts the primary first (`agent.js:658`) and the configured order is
what a turn follows. It gives way on two declared things, both announced — a
declared window too small to fit the request (`budget.preflight`, a `context`
hop) and a first token that never arrives inside `failoverAfterMs`
(`firstTokenGuard`, a stall hop). A refusal does not move it: `if
(!guard.stalled) throw e` (`agent.js:867`) is what stops a 4xx from becoming a
quiet change of model.

There is a third way the lead moves, and it was not announced at all:

```js
const warm    = entries.filter(e => !isDegraded(e.ep, e.model));
const cold    = entries.filter(e =>  isDegraded(e.ep, e.model));
const ordered = [...warm, ...cold];                       // agent.js:679-681
```

A rung that stalled within `DEGRADED_MS` (5 minutes) is pushed to the back, so
the turns inside that window do not each pay the same stall again. When the rung
that stalled is the **configured model**, the fallback leads — and because the
rotation happens *before* the lead is compared with anything, nothing
downstream could see it. Measured on the real path, three consecutive turns
against a stub provider that accepts and never sends a token, one-entry chain:

```
turn 1  models asked, in order: ["stub-model","stub-mini"]
        failovers announced    : [{from:"stub-model", to:"stub-mini", step:1, seconds:1}]
turn 2  models asked, in order: ["stub-mini"]              ← the main was not asked
        failovers announced    : null
turn 3  models asked, in order: ["stub-model","stub-mini"]  ← clock moved past DEGRADED_MS
        failovers announced    : [{from:"stub-model", to:"stub-mini", ...}]
```

Turn 2 is the fault. No `failover` row in the console (`harness.js:1556` is the
only place one is drawn), no `warn` line in the log (`logs.js:143`, which only
ever renders `evt.text` from that event), and no `fallbacks` on the turn's
outcome (`agent.js:1243`) — which is the only thing a client that was asleep,
or a watch with no screen, gets to read. The answer arrived from `stub-mini`
and every surface a user reads said it came from `stub-model`. That is
precisely the failure the `onHop` comment two lines above it names: *"A
fallback that happens silently is a worse bug than the outage it hides."*

### Cause

The rotation is decided in `rungsFor`, which has no way to report anything; and
`complete` compared the lead against `candidates[0]` — the post-rotation list —
so a rotated chain compared equal to itself. What stood at the head of
`complete`:

```js
if (rungs[0].provider !== candidates[0].provider || rungs[0].model !== candidates[0].model)
  onHop?.({ …, reason: 'context', … });
```

That test can only ever see a rung the **preflight** dropped. It is structurally
blind to a reorder, and it was comparing against the wrong side: the question is
not "did the lead change between two lists", it is "is the model answering the
one the settings name".

### Why the defect survived

The test that should have caught it never exercised the reorder. It marked a
rung as stalled through a method that does not exist:

```js
const primary = agentMod.rungsFor({ ep, model: 'stub-model', p })[0];
agentMod._degradeForTest ? agentMod._degradeForTest(primary) : null;   // no-op
```

`_degradeForTest` has never been exported, so the optional call did nothing and
the test asserted the order of an untouched chain, twice — before and after a
`forgetDegraded()` that was clearing an empty map. It is named *"a rung that
stalled goes to the back, but is not written off"*; it was green for as long as
the reorder has existed, and it could not have failed if the rotation had been
deleted. The test is fixed in the same commit as this entry.

### Fixed

**v2.46.6, `fix/audit-2.45.1`.** Three parts, and the demotion itself is not
one of them — it is the reason the turns inside `DEGRADED_MS` are fast, and it
stays exactly as it was.

- **`stalledAgo(ep, model)`** (`agent.js:647`) replaces the boolean
  `isDegraded` at the bottom, and `rungsFor` carries the answer on the rung as
  `stalledMsAgo` (`agent.js:692`). The rotation happens before anything
  downstream can compare the order, so the fact has to travel *with* the rung or
  it does not travel at all.
- **`openingHop({ ep, model, candidates, rungs })`** (`agent.js:716`) — one
  pure function that answers "is the configured model the one that answered, and
  if not, which of the two mechanisms moved it". It compares against the model
  the settings name rather than against `candidates[0]`, which is what closes the
  blind spot, and it reports `reason: 'degraded'` with the stall's age rather
  than the `0` the old call would have put in `seconds`. Replaces the two-line
  check at the head of `complete` (`agent.js:840`).
- **`hopText(h)`** (`agent.js:741`) — the wording moved out of the `onHop`
  closure and given a third branch, so the console row and the log line stay one
  sentence rather than two copies that drift. The two existing sentences are
  byte-for-byte what they were; the new one reads:

  > `stub stopped answering 41s ago and is being passed over while it recovers;
  > continuing on stub2 / stub-mini. 1 more in the chain.`

### Collateral

- **`seconds` changes meaning on this one reason.** It was "how long the silent
  one was given before the hop"; for a rotation it is "how long ago it stalled".
  Both descriptions and the `from` field are widened in
  `modules/api-v1/openapi.js`, and `docs/api/openapi.json` is regenerated in the
  same commit. No field is added, so there is nothing for a reader to default.
- **The log line comes for free.** `logs.js:143` already prefers `evt.text` and
  falls back to its own wording only when it is absent; `say()` always sets it,
  so no logging code changed.
- **The console draws it with the row it already has.** `hc-msg hc-failover` and the
  `failover` branch at `public/js/harness.js:1556` are untouched — this adds a
  row where there was none, not a new kind of row. No CSS, no DOM, and
  therefore no browser check owed (AGENTS.md:111 is about claims a DOM stub
  makes, and this makes none).
- **`markDegraded` is now exported** (`agent.js:1531`), the inverse of the
  `forgetDegraded` that has been exported for tests all along. Without it there
  is no way to reach the rotation in a test except by waiting out a real stall.
- **Two announcements can now fire on one turn** in the rare case where the
  configured model was rotated *and* what took its place was then dropped by the
  preflight. Both are true and both are reported; when the configured model ends
  up answering after all, neither fires, which the unit test pins.
- **The last rung's deadline moves with the rotation.** If the configured model
  is rotated to the back, it is now the `last` rung and gets the full
  `firstTokenTimeoutMs` rather than the shorter `failoverAfterMs`. That is the
  intended reading of "the last one is never cut short", but it is a change in
  how long a demoted main model is given, so it is recorded rather than left to
  be discovered.

### Verified

- `test/harness.test.js` — *"a turn that starts on the backup, because the
  configured model stalled a moment ago, says so"*: two real turns over
  `/api/harness/chat` against two provider ids on one stub. The first stalls the
  configured model; the second asserts that `stub-model` is **not asked at all**
  (`seen` holds one request, for `stub-mini`) and that a `failover` event with
  `from: 'stub'`, `fromModel: 'stub-model'`, `toModel: 'stub-mini'`,
  `reason`-sentence, `frames: 0` and `remaining: 1` is emitted before it answers.
- *"a turn that will not run on the configured model says which way it was
  passed over"* — `openingHop` on its own, all four cases: the configured model
  answering (nothing to say), a rotation (`degraded`, with the stall's age), a
  preflight drop (`context`, `seconds: 0`), and a rotation that the preflight
  then undid (nothing to say, because the configured model answers).
- *"a rung that stalled goes to the back, but is not written off"* — rewritten.
  It now calls the exported `markDegraded`, asserts the rotated order
  `['ollama/qwen3', 'stub/stub-model']`, asserts the rung carries
  `stalledMsAgo`, asserts `forgetDegraded` restores the order, and — with the
  clock moved rather than waited out — asserts the rest period ends on its own.
  That last one is the half of the name the test never earned before: nothing
  proved the demotion was temporary rather than a blacklist in all the time it
  has been here.
- Mutation-checked seven ways against the real code, each reddening exactly
  what it should: removing the announcement from `complete` reddens the
  end-to-end test alone; dropping `stalledMsAgo` from the rung reddens the
  rewritten rotation test alone; removing the `degraded` branch from `hopText`
  reddens the end-to-end test; always reporting `context` reddens both; never
  rotating reddens the rotation and end-to-end tests; announcing when the
  configured model is answering reddens the unit test and the pre-existing
  context-hop test; and letting the rest period never expire reddens the
  rotation test. Suite 377/377, exit 0.

---

## H-19 — The agent can write the control plane it is forbidden to propose changes to

**Status:** found 2026-09-21 on v2.50.0 by audit, cause confirmed by reading
the code and by running `fmSafe` against the real paths. **Not fixed.**

### What is wrong

`modules/harness/settings.js` is careful about what the agent may change. A
proposal may only point into a `SETTABLE` prefix; `FORBIDDEN` refuses any dotted
path whose segment is `key`, `token`, `secret`, `password` or `credential`;
`mcpServers` and `harness.custom` are absent because each holds a command that
later gets spawned; `harness.approval` is refused outright by `NEVER_SETTABLE`;
and nothing is written until a click reaches `POST /api/harness/proposals/:id/apply`.
Charter rule 6 says it in words too: *"Never write the prefs file, `openclaw.json`
or a service unit yourself."*

**`write_file` walks around all of it.** `fmSafe()` (`modules/utils.js`) asks
one question — is the resolved path under an allowed root — and
`FM_ALLOWED_ROOTS` is `[HOME, /media, /mnt, /tmp]`. It has no concept of a
control plane, so every guarantee above is a prompt rule with no mechanism
under it.

### Evidence

Run against v2.50.0 on the dev host:

```
PREFS_FILE:  D:\doca\doca\.dashboard-prefs.json   fmSafe: false
DATA dir:    D:\doca\doca\.doca\harness           fmSafe: false
CONFIG_PATH: C:\Users\alban\.openclaw\openclaw.json  fmSafe: true   ← reachable
FM roots:    [ 'C:\Users\alban', '/media', '/mnt', '/tmp' ]
```

Two things follow, and the second is worse than the first.

1. **`openclaw.json` is readable and writable today.** It holds every provider
   API key in plaintext — `providers.js:152` parses it for exactly that. So
   `read_file ~/.openclaw/openclaw.json` hands the model the keys that
   `FORBIDDEN` exists to keep out of a tool call, and `write_file` can add a
   provider pointing anywhere.
2. **The prefs file and `.doca/` escape only by accident.** They are `false`
   above because this checkout sits on `D:` while `HOME` is on `C:`. On an
   ordinary install — cloned under `$HOME`, which is what `run.sh` and the
   README assume — both are inside an allowed root, and the agent can rewrite
   its own memory, its own approval allowlist, its own settings and its own
   default harness directly, with no proposal and no click.

This is the same class as H-7 (`proposals/:id/apply` being unauthenticated) and
should be read beside it: H-7 is about reaching the apply route, this is about
not needing it.

### Why it was not caught

Every test of the settings surface asserts that a **proposal** is refused.
Nothing asserts that the path is unreachable by other means, because the file
tools and the settings module are tested separately and neither owns the
question. The audit found it by asking what `fmSafe` actually checks.

### How to close it

- A deny-list that does not depend on where the repo was cloned: `PREFS_FILE`,
  `DOCA_DATA_DIR`, `CONFIG_PATH`, `CERTS_DIR` and any `.git` directory are
  control plane, refused by `fmSafe` (or by a check above it) for **write**, and
  `CONFIG_PATH` refused for **read** as well while it holds keys.
- The refusal must name the route that does work — `settings_propose` — or it
  teaches nothing.
- A test that asserts each of those paths is refused *through the tools*, with
  the repo placed inside `HOME` in the fixture, since that is the layout where
  it bites and the dev host's layout hides it.
- Longer term, keys do not belong in a plaintext file a tool can read at all;
  that is a larger change and is `TODO.md`'s business.

---

## H-20 — `contextWindow` is declared to DOCA and never to the runtime

**Status:** found 2026-09-21 on v2.50.0 by audit, confirmed by reading the
request path. **Not fixed.**

### What is wrong

`harness.config.doca.contextWindow` is the number the whole compaction system
reasons with: `compactAt` folds at a percentage of it, `budget.preflight()`
skips a rung against it, `budget.warning()` warns at `warnAt` percent of it, and
as of v2.47.0 the panel draws a ring of it in both chats.

Ollama is reached at `${ollamaBase()}/v1` (`providers.js:168`) — its
OpenAI-compatible shim — and **nothing in the request sets `num_ctx`.** The only
option DOCA sends is `stream_options` (`agent.js:1146`). Ollama therefore
applies the model's own default context, commonly 4096, and truncates
everything past it **without reporting anything**: no error, no warning, and a
`usage` frame describing the truncated request as if it were the whole one.

### Why it matters more than it looks

The failure is silent in both directions at once. Set `contextWindow: 32768`
against an Ollama model and:

- the ring, the warning and `compactAt` all describe a 32k window that is not
  in use;
- the preflight passes a request the runtime will quietly cut;
- the agent is told, in `budget.block()`, that it has room it does not have;
- and the first symptom is the model appearing to forget the beginning of its
  own turn, which reads as a model quality problem rather than a config one.

`budget.js`'s own rule — "a guess is never printed as a measurement" — is
broken here by a number that is neither: it is a *claim about someone else's
runtime* that nothing ever checked.

### How to close it

- Either send the window where the runtime takes it (Ollama: native
  `/api/chat` with `options.num_ctx`, or `num_ctx` through the shim where the
  version accepts it), or stop claiming a window we cannot set.
- If it cannot be set, say so at the point of setting: the ⚙ field should mark
  the value as advisory for that provider, and `budget.block()` should not
  state it as fact.
- A test that asserts the request carries the declared window for a provider
  that accepts one — the stub server can assert on the body, which is where
  this would have been caught.
