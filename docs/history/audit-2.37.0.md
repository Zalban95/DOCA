# audit.md — DOCA, read from the inside

**Author:** the resident DOCA harness agent on `al-Office-desk` (the built-in agent in
`modules/harness/agent.js`, not a human reviewer).
**Date:** 2026-09-20. **Version audited:** 2.37.0, commit `25161d6`, branch `main`.
**Scope:** what stands between this panel and a *natural* working rhythm — for the
person driving it and for the agent living in it.
**Method:** reading the source I run on, plus first-hand evidence from my own
operating session on this host. Every code claim carries a `file:line`. Every
behaviour claim carries the command or observation that produced it.

I made **no changes** to this repo. Nothing here is applied.

---

## How this relates to ISSUES.md and TODO.md

Both files are thorough and this audit deliberately does not repeat them.

- `ISSUES.md` (1162 lines, H-5 … H-11) holds defects with a named cause and a stated
  way to close them.
- `TODO.md` holds decisions and deferred work, including the 2026-09-20 PRIORITY
  entry on the three levels (chat / conversation / mission).

**Nothing below is in either file.** I checked. Where a finding touches an existing
entry I say so and do not re-diagnose it — H-8 in particular (see finding 11).

What I can add that a code reviewer cannot is the *inside* view: this prompt, this
tool list, this memory, these missions. Most findings below are things I hit while
doing ordinary work — a mockup of a telescope mount and an audit of this repo —
within the last two hours.

---

## Findings, ranked by cost to the workflow

| # | Finding | Area | Severity | Effort |
|---|---|---|---|---|
| 1 | A specialist's real turn never gets the narrowed prompt | harness/agents | high | one line |
| 2 | Nothing preflights a model against the prompt we will send it | harness/budget | high | small |
| 3 | Compaction is nominal: first fold at 500 000 tokens | harness/budget | medium | one proposal |
| 4 | A finished mission is pull-only — the orchestrator is never told | agents/missions | medium | small |
| 5 | MCP "running" means the process spawned, not that the backend answers | mcp | medium | small |
| 6 | The agent has no first-class view of MCP servers | harness/tools | medium | small |
| 7 | Two classes of setting: proposable, and reachable only by raw API | harness/settings | medium | one line |
| 8 | The agent cannot enumerate its own memory | harness/tools | low | small |
| 9 | HTTPS-only panel; a plain-HTTP call returns an empty body that reads as success | server | low | small |
| 10 | Working tree carries untracked logs and a modified lockfile | repo hygiene | low | trivial |
| 11 | `npm test` cannot go green on this machine (known: H-8) | test | blocking | already logged |

---

## 1. A specialist's real turn never gets the narrowed prompt

**Seen.** `systemPrompt()` takes a `profile` and has a dedicated branch for it
(`modules/harness/agent.js:230`). The two call sites disagree:

- `agent.js:988` — the one that builds the message actually sent to the provider
  inside `turn()` — passes `p, userText, summary, client, toolCount, disabledCount`.
  **No `profile`.**
- `agent.js:1187` — `preview()` — passes `profile`.

**Where.** `modules/harness/agent.js:988` vs `:1187`.

**Why it costs the workflow.** The narrowing is the entire economic reason
specialists exist: a mission is supposed to receive a charter, a short role, the
environment and nothing else. On the wire it receives the orchestrator's full
prompt — measured earlier at ~7.6 k characters against ~3.9 k for the narrowed
form, including the memory rules, the settings-proposal block and the dispatch
block for tools a specialist does not have. It is also an authority smell: the
agent is handed rules about tools it cannot call.

**Smallest fix.** Add `profile,` to the object at `agent.js:988`.

**How to verify.** The test that exists (`test/agents.test.js`, "a specialist
prompt is smaller than the orchestrator prompt") asserts against `preview()`, so it
is green while the wire is wrong — the same failure mode `AGENTS.md` warns about for
the DOM stub. A real test captures the `messages[0].content` that arrives at the
scripted stub provider in `test/fixtures` and asserts on that. Wire-level, not
preview-level.

**Risk of the fix.** Low. One call site, `preview()` already proves the shape is
valid.

---

## 2. Nothing preflights a model against the prompt we are about to send it

**Seen.** On this host (read via `settings_read`, 2026-09-20):
`contextWindow = 1000000`, `compactTokens = 500000`, `compactAt = 60`,
`fallbackChain = [DeepSeek4f/deepseek-v4-pro, llamacpp/qwen3.8-27b]`.
The panel's own readings during this session report a last prompt of **114 222
tokens**.

The second rung of that chain is `llamacpp/qwen3.8-27b`, whose served context is
**40 960** tokens. A request of that size to it is not a slow success — it is a
hard `HTTP 400 exceed_context_size_error`, measured on 2026-09-19 with a 66 719
token request.

**Where.** The decision to try a rung lives in the fallback path around
`agent.js`'s post loop; nothing anywhere compares an estimated prompt size with the
target model's declared window.

**Why it costs the workflow.** The failure is structurally invisible: the *primary*
model works, so nothing surfaces until the primary fails, at which point the
fallback is guaranteed to fail too and the user learns "the agent stopped
answering" with a provider-side 400 buried in a log. The same shape applies to
missions dispatched to a small local model: they are born dead and report a generic
error several steps later.

**Smallest fix.** One preflight used by both `turn()` and `agent_dispatch`:
`estimate(prompt) + reserve > window(model)` → refuse with a sentence naming the
model, its window and the estimate, before the request is made. Additionally, mark
a chain rung as unusable when the current prompt cannot fit it, and say so in the
readings rather than trying it.

**How to verify.** A test that sets a 40 960-window stub provider as the only rung
and sends a 50 000-token conversation; expect a named refusal, not a provider error.

---

## 3. Compaction is nominal: the first fold happens at 500 000 tokens

**Seen.** `budget.js:81` `compactReason()` tests `compactTokens` **first** and only
falls through to `compactAt` as a percentage of the window:

```
const budgetTok = compactTokensFor(p);
if (budgetTok && prompt >= budgetTok) return { setting: 'compactTokens', at: budgetTok };
const pctAt = Math.max(1, Number(p.compactAt) || 60);
if (window && prompt >= window * pctAt / 100) return { setting: 'compactAt', ... };
```

With `compactTokens = 500000`, the 60 % of a 1 M window (600 000) never applies.
Measured cost of that setting today: **one turn, six model calls, 642 889 provider
tokens**, 82–96 % of it served from cache — so the *money* is mostly fine, but the
prompt grows without bound and every step pays the latency of shipping ~115 k
tokens, and the fallback problem in finding 2 gets worse with every turn.

**Where.** `modules/harness/budget.js:81-88`; the values at
`harness.config.doca.compactTokens` / `.compactAt`.

**Why it costs the workflow.** Not a defect — every value is individually
reasonable. It is a *composition* problem: the three settings multiply out to
"compact only at half a million tokens", which on this workload means "never". The
panel already measures the honest trigger; the settings describe a different one.

**Smallest fix.** A proposal for a coherent pair (for example `compactTokens` back
to ~120 000 with `contextWindow` untouched), or, better, a warning in `settings_read`
when `compactTokens > contextWindow * compactAt / 100` — the settings would then
explain themselves instead of contradicting each other. **This one is the user's
call and I have not proposed it: it changes how much of their conversation survives
a fold.**

**How to verify.** Set the numbers, run a long turn, watch `compactReason` fire at
the intended prompt size instead of at the window percentage.

---

## 4. A finished mission is pull-only — the orchestrator is never told

**Seen.** This session: I dispatched `msn_64b38f851274`, then called
`agent_results` four times — three returning "still running" — and only learned it
had finished because the user asked "what's the state of the last work".

`AGENTS.md` records that `missions.announce()` publishes `agent.mission` to every
**device** with `harness:chat` so a phone can learn that work it started has
finished. The agent that *dispatched* the mission gets no such event; it has to
poll.

**Where.** `modules/agents/missions.js` (`announce`), and the absence of anything
mission-shaped in the per-turn panel readings.

**Why it costs the workflow.** Dispatching is the one action that is explicitly
"fire and forget" — "you are not blocked: the answer arrives later" — and the
orchestrator is then the only participant who cannot be told when later is. In
practice it means the agent either polls (wasting a call and the user's wait) or
forgets, and the user becomes the notification channel.

**Smallest fix.** A one-line addition to the per-turn readings — the mechanism
already exists, since 2.32.3 rides readings as a user row: `missions: msn_x
finished 3m ago, unread`. One line, no new route, no new push channel, and it lands
exactly where the agent already reads its own state.

**How to verify.** Dispatch any short mission, wait, take one unrelated turn: the
line should appear once and then not nag.

---

## 5. MCP "running" means the process spawned, not that the backend answers

**Seen.** In this session `GET /api/mcp` reported `blender` as `state: running`
with 31 tools listed, while `127.0.0.1:9876` refused the connection outright — no
GUI Blender existed, so every one of those 31 tools was dead. The state field is
`c?.state || 'stopped'` (`modules/mcp/registry.js:257`), where `c.state` is set when
the transport is spawned and changes only on a transport-level error.

The converse is already in my memory as a known trap: `portal` (a `client`-origin
server) reads `stopped` while the client's own server is genuinely up and listening,
because the panel's client is not connected.

**Where.** `modules/mcp/registry.js:242-258`.

**Why it costs the workflow.** The panel states a fact it has not established.
"Running" for a stdio server asserts something about a *different process* — the
addon or daemon on the far end of the transport — which the panel never asks. This
session it cost me a start, a re-list and a wasted dispatch before I read the
specialist's report and found the true cause. The honest states are three, not two:
**process up / backend answering / backend unreachable**.

**Smallest fix.** Keep `state` as it is and add a second field for stdio servers: a
cheap liveness probe (an `initialize` round-trip with a short timeout, or the
addon's own socket) shown as `backend: ok | unreachable | unknown`, refreshed on
`refresh` and on first use, not on every poll.

**How to verify.** Stop Blender but leave the MCP process running: the panel should
read `running / backend unreachable`, not `running`.

---

## 6. The agent has no first-class view of MCP servers

**Seen.** `modules/harness/tools.js` registers 24 tools. They cover the filesystem,
memory, settings, installs, missions, the system, **devices** (`doca_clients`),
media, devices again (`ask_device` / `tell_device`), docs and fetch. None touches
`/api/mcp`.

Everything I learned about `blender` this session I learned by hand-rolling
`curl -sk https://localhost:4242/api/mcp` and a raw POST to
`/api/mcp/blender/action` from `shell`.

**Where.** `modules/harness/tools.js`; compare `doca_clients`, which exists
precisely so the agent does not answer "who is connected" from `ss`.

**Why it costs the workflow.** Managing MCP servers is a core competence of this
panel — the agent's own prompt lists them, with their state, every turn — and the
agent can act on them only through bespoke curl. That is exactly the situation
`doca_clients` was written to fix on the device side.

**Smallest fix, and the honest caveat.** A read-only `mcp_status` is unambiguously
right and adds no authority. A write action (`start` / `stop`) is a real increase:
it lets the agent spawn a process it then calls tools on, which is the class of
thing the panel deliberately keeps out of `SETTABLE`. My recommendation is
`mcp_status` now, and a `start` proposal — announced, not silent — only if the user
wants it. I am not asking for the write.

**How to verify.** With `mcp_status` in the tool list, ask the agent what the
portal's state is, on a machine where the client is up.

---

## 7. Two classes of setting: proposable, and reachable only by raw API

**Seen.** `settings_read` offers `harness.config.doca.*` and `paths.*`. I can
propose a temperature change. `agents.enabled` — the switch that decides whether
this agent has specialists at all — is **not** in `modules/harness/settings.js` and
does not appear in `settings_read`; enabling it needs
`POST /api/harness/agents/enable`.

**Where.** `modules/harness/settings.js` (`SETTABLE`); `modules/agents/registry.js`.

**Why it costs the workflow.** The distinction the panel draws is sound — things
whose value is a command that would later be spawned (`mcpServers`,
`harness.custom`) are deliberately out, and the agent should not be able to widen
its own authority. But `agents.enabled` is a *boolean gate on the agent's own
capability*, which makes it the single setting most in need of the
propose-and-click ritual rather than the one exemption from it. As it stands, the
agent must either stay silent about a capability it knows is off, or reach around
the settings system with a raw API call — and the second is precisely what the
safety charter forbids.

**Smallest fix.** Add `agents.enabled` to `SETTABLE`. It spawns nothing; it flips a
feature the user already has to click to accept.

**How to verify.** `settings_read` filtered on `agents` should return the flag, and
a declined proposal should be remembered (it already is — see the positives below).

---

## 8. The agent cannot enumerate its own memory

**Seen.** `modules/harness/memory.js:502` defines `memList()`. The tool surface
exposes `memory_write`, `memory_search`, `memory_forget`, `memory_flag` — there is
no `memory_list`.

**Why it costs the workflow.** My own rules tell me to "update the existing key
instead of adding a near-duplicate" and warn that "two versions of one fact are
worse than none". I cannot check that without reading
`DOCA_DATA_DIR/harness/memory.json` through `shell`. This session I found a stale
figure in my memory (a compaction trigger) only because a `settings_read` happened
to contradict it — not because I could inspect it. Search finds a fact when you
already know what to call it; that is not the same as an inventory.

**Smallest fix.** A `memory_list` tool: key, category, pinned/locked flag, and the
first line of the value. Read-only, no new authority, and it makes the rule in my
prompt checkable instead of aspirational.

**How to verify.** Ask the agent for the keys in one category; compare with the
file.

---

## 9. HTTPS-only panel; a plain-HTTP call returns an empty body that reads as success

**Seen.** `curl -s http://localhost:4242/api/mcp` printed **nothing at all** and
the shell line reported exit 0. `curl -sk https://localhost:4242/api/mcp` returned
the server list immediately. `AGENTS.md` says the server "serves HTTPS with a
self-signed cert …, falling back to HTTP only if cert generation fails" — so the
fallback is a boot-time branch, not a listener that redirects.

**Why it costs the workflow.** An empty body with no message is the most expensive
kind of failure to debug: it reads as "the endpoint returned nothing", which sends
you looking at the endpoint. Two of my own earlier findings in this session started
as this. Part of this is my own `-s` suppressing curl's "Empty reply from server" —
but the panel's documentation invites plain-HTTP examples and nothing corrects them
at runtime.

**Smallest fix.** Either a plain-HTTP listener that answers 308 to the `https://`
URL, or one line in `AGENTS.md` and the API docs stating that every example needs
`-k https://`. The first is more useful, the second is free.

**How to verify.** `curl -sS http://localhost:4242/api/mcp` should print a message
naming HTTPS, not nothing.

---

## 10. Working tree carries untracked logs and a modified lockfile

**Seen.**

```
 M package-lock.json
?? .aider.chat.history.md
?? dashboard.log
?? debug-e82941.log
```

**Why it costs the workflow.** Small, but it is the difference between a clean
`git status` and one where a real change is invisible among noise — and this repo
has a strict habit (`AGENTS.md`) that version discipline is the point. `H-11` is
the same family of problem: something that quietly is not what it looks like.

**Smallest fix.** `.gitignore` entries for the logs and the aider history; decide
whether the lockfile change is intended and commit or revert it. **I have deleted
nothing and reverted nothing.**

---

## 11. `npm test` cannot go green on this machine — known, not re-diagnosed

`ISSUES.md` H-8 records that `node-pty` aborts the process on this host (236 tests,
213 pass, 23 fail, then abort). I did **not** re-run it, so I am not claiming to
have a new opinion on it.

It is listed here because it is the reason findings 1–9 cannot be verified by the
suite as it stands, including finding 1 — whose existing test passes for the wrong
reason. Any fix cycle on this repo starts by making the suite trustworthy on this
host, or by accepting that each fix needs a hand-written wire-level test.

---

## What works, and should not be "simplified" away

An audit that only lists faults misleads. Four things here are better than the
equivalent in most agent systems, and I checked each against the code:

- **The standing charter is in code** (`providers.js`, `SAFETY_CHARTER`) and not in
  prefs, so the agent it restrains cannot propose it away. Confirmed by reading it
  out of the source that builds my own prompt.
- **A declined proposal is remembered.** `settings.js:292-310` rejects *and*
  records, with the comment that "an agent that cannot see it was declined proposes
  the same thing again next turn, which is how a helpful feature becomes nagging".
  That is the exact failure mode I would otherwise have reported as a finding.
- **Provenance is never concatenated onto the user's words.** `clientBlock()` rides
  the system prompt and the transcript row carries `from`; a client cannot describe
  itself per message. My own prompt demonstrates it.
- **The `research_docs` quarantine is real.** One completion, no tools, no memory,
  no environment, no transcript. Reading this repo's own docs through it, and then
  through `http_fetch`, is a visibly different experience — the quarantined reader
  reported "not stated in these pages" five times rather than inventing printer
  specs, which is the behaviour you want.

---

## What I did not check

- The test suite was not run (H-8).
- The three client repos (`DocaDesk`, `DocaMobile`, `DocaWear`) were out of scope.
- `public/` frontend behaviour was not audited; every finding above is harness,
  agents, MCP or server.
- Findings 2 and 3 quantify this host's configuration, not every deployment's.
- I did not read `CAMPAIGN.md` or `PROTOCOL.md` end to end.
- No changes were made to any file in this repo except adding this one.

## Suggested order

1. **Finding 1** — one line, removes a live cost, and its existing test needs
   fixing anyway.
2. **Finding 2** — turns an invisible mode of failure into a sentence.
3. **Finding 4** — one line in the readings; it changes how the agent behaves
   without changing what it may do.
4. **Finding 5** — makes the panel's own claims true.
5. **Finding 6** (`mcp_status`, read-only) and **finding 7** (`agents.enabled` into
   `SETTABLE`) — small, and both are about the agent knowing and managing itself.
6. **Findings 8, 9, 10** — cheap quality-of-life.
7. **Finding 11** — unblock the suite before doing any of the above at speed.
