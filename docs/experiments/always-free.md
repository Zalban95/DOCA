# Experiment: always free — the main chat answers at once, the work happens behind

Flag `experiments.alwaysFree` (Settings → Developer), off by default; like every experiment it needs developer mode.
Design: "Always free: the front answers in seconds, the work happens behind" (2026-10-12) — this is its **phase 1**
plus the defects §6.1–6.3. Code: `modules/harness/turn/route.js` (where a request goes), `turn/handoff.js` (the
safety net and the one quick action), `harness/fork.js` (what a job carries), `harness/living-plan.js` (the plan the
person and the worker share), `harness/background.js` (the `background` tool and the "In the background" block),
`harness/work-cap.js` (`work.parallel`), `modules/evals/follow.js` (`--follow`). Without the flag every one of these
returns today's path (CONSTITUTION W14): `front.planned`, `handoff.limitFor`, the old hand-off bodies.

## The owner's answers (2026-10-12)

1. **What stays in the main chat** — "as you suggest": talk, quick look-ups, settings the person asked for, and one
   quick visible action (a reminder, a device or home tool, a recipe of a step or two). Everything else goes behind.
2. **A plan changed while it runs** — "just flag a changed plan; the agent can adapt to fulfil the new contract if
   inherent, otherwise deploy a separate agent and a new plan if necessary." A person's addition goes straight into the
   running plan, flagged as theirs (who, when, what — the plan's `edits`), with no new approval; the worker is told
   before its next step and either fits it in (`work_plan change` / `add`) or moves it to a work chat of its own
   (`work_plan split`), saying so.
3. **How many at once** — "no limits by default, possibility to set them; mine is just one of the possible setups."
   `work.parallel` is 0 (no limit) unless the owner sets it; `work.localSlots` (one fewer job than a local server's
   slots) is opt-in. Nothing is tuned to one machine.

## Hypothesis

Today the Orchestrator decides who works only after its own model has spent a step choosing a tool, and a short
request ("can you clean up the old docker images?") is rated small and gets up to six work steps in its own turn. On a
local 27B that is 30 s to 3 minutes in which the main chat is busy, a message written meanwhile waits for the step in
progress, and a phone call says "still working on it in the background" while the work still blocks the conversation.
If clear jobs leave **before any model is asked**, any other real work leaves at its **first** call, and the person
steers a running job through the main chat, then:

- the main chat's first word comes within one front step — a fixed line (no model) for a clear job;
- the main chat is busy far less per request (target: −70% against the flag off);
- the total tokens, front plus work behind, stay within +25%;
- the lane the front takes (talk, look, do-now, job, amend) is right at least 85% of the time with System 1 on (rules
  alone recorded as the baseline);
- the quick cases (reminders, lights, a setting asked for) stay in front: no work chat.

## What happens when it is on

**Before any model** (`turn/route.js`), on every turn of the Orchestrator's conversation — typed or spoken — and on
every call, whatever `assistant.calls` says: a request is a clear job when the person asks to think harder / take
their time with a request beside it (`front.DEEP`), when the triage's rules rate it large (a build verb on a whole
thing, a list of three steps, a long message), or when the System 1 model (experiment `systemOne`) is sure it is
"later". A clear job is forked at once and the main chat says one fixed line naming it, e.g. *"On it — **Clean up the
old docker images** is running in the background, in a work chat of its own. Ask me anything meanwhile; DOCA tells you
here when it reports."* (the product's name from `branding.js`; a call hears a short spoken version). No quick model is
asked here: on a local model that would cost seconds before the first word.

**The safety net** (`turn/handoff.js`): a turn that is not a clear job runs as ever, but its first call that is real
work (anything `isWork`: not reading, memory, coordinating, the day or a web search) moves the job to a work chat, with
what the turn had already read — except **one** step of quick visible actions (`handoff.isQuick`: `remind`, a recipe of
one or two steps or marked `quick`, an MCP tool that is not an agents' computer). `orchestratorWorkSteps` is not used:
0 still means off without the flag. A call that is not a job is a front turn (the short kit, `front.FRONT`) under the
same rule.

**The fork** (`harness/fork.js`) carries the request word for word **with its files** (attachments), the last eight
lines of the conversation and its summary of earlier decisions (≤ 1.5k characters), the conversation's **project**
(`projectId`), what the main chat had done this turn (safety net), and a **seed plan** — one step, the request — in
state `living` (its go-ahead is the request: no approval asked). The work chat is the person's (`session-access`),
and `job.origin` says where it came from.

**The living plan** (`harness/living-plan.js`): steps are only appended, never reordered; each has `from` (person,
worker, orchestrator); every write bumps `version`; `edits` logs who changed what and when, and a person's edit the
worker has not read is the plan's flagged change. The worker grows its plan with `work_plan add` (with a contract),
`change` (a step not started), `cancel {why}`, `split {why}` (a step that is not this job's becomes its own work chat
under the main chat, for the same person). A `draft` over a plan with unread changes from the person is refused unless
it names `basedOn: <version>`, listing them. A cancelled step no longer counts as open, and done-plus-cancelled is
fulfilled.

**`background {status | add | cancel | stop}`** — the main chat's one place to look at and steer a job (only the
Orchestrator holds it; in `registry.NEVER`). `add` writes the step into the plan flagged as the person's and hands the
worker a `[plan] …` message read before its next step (the inbox), or starts a turn when it is between turns (a job
that ended under 30 minutes ago reopens; one a person stopped is refused). `cancel` drops a queued step at once and
asks about one the worker is on. `stop` ends the job (restart or drop later). At most five edits a minute per job. The
words it returns are rendered from the plan ("Added to **Landing page** as step 6. It's on step 3 now and will pick that
up after its current step.").

**What the Orchestrator sees** (`harness/background.js`): its readings carry `# In the background (2 working, 1
finished unread)` — per job the step in progress ("step 3 of 6 running: …"), what the person added that it has not read
yet, how long it has run, or how it ended — in place of the one-line briefs. The Harness console's fold beside the main
chat lists the same jobs (refreshed every 5 s while one works), and a work chat's fold marks the steps "added by you",
cancelled steps struck through, and the change not read yet.

**How many** (`harness/work-cap.js`): with `work.parallel` set, a person's job past it is lined up (`job.state:
queued`, said so) and starts when one of theirs ends.

## How the owner turns it on and measures it with DeepSeek (no tokens are spent by anything else)

1. Settings → Developer: switch **Developer mode** on, then **Always free** on. (Optional: experiment **System 1**
   for the measured routing; `work.parallel` / `work.localSlots` under its Advanced fold.)
2. Make sure the DOCA harness's model is DeepSeek (⚙ on "DOCA's own agent"), e.g. `deepseek/deepseek-chat`.
3. In a terminal in the install's folder, the new set, flag off and on, following each hand-off:
   `npm run eval -- front --orchestrator --follow --flag alwaysFree`
   — or the table for this write-up in one go: `npm run experiment -- always-free` (set `front` by default; add
   `--models deepseek/deepseek-chat,<local provider>/<model>` to compare models, `--follow 900` to wait longer per case).
4. The guards that must not regress, each off vs on:
   `npm run eval -- routing --orchestrator --follow --flag alwaysFree`,
   `npm run eval -- newcomer --orchestrator --follow --flag alwaysFree`,
   `npm run eval -- reaches-frameworks --orchestrator --follow --flag alwaysFree`.
5. The local model: the same commands with `--models <provider>/<the local model>`; also once with
   `work.localSlots` on, to see the front's first word with workers running.
6. Paste the printed rows into the table below (the date at the start of a row is what Settings → Developer reads as
   "measured").

What to look for: `lanes right` ≥ 85% of labelled cases (System 1 on), `first word (median)` under 3 s on DeepSeek and
under 20 s locally, fork lines under 200 ms (`firstMs` of the job cases), `front busy` down ≥ 70%, `tokens front +
behind` within +25%, and in the guard sets passes at least the off run minus one, with lights-off / heating /
door-locked / remind-* staying in front (0 work chats).

`--follow` (`modules/evals/follow.js`) waits — 600 s per case at most — for every work chat a case started, stops any
still working at the deadline (`followed: timed out`), and counts their tools, steps and tokens with the case's
(`childTools`, `childSteps`, `childTokens`; tool checks read `allTools`). Each case records `firstMs` (the first word,
thought or call), `resultMs` (when the last work chat ended) and `lane`; checks `lane`, `minChildren`, `maxChildren`,
`maxFirstMs` are new.

## Measured

Only against the scripted stub so far (`test/always-free.test.js`, `test/evals-follow.test.js`): a clear job forks with
no model request and its line within the turn; the safety net hands on at the first work call with what was read; one
reminder stays in front and a second hands on; a call is a front turn with `assistant.calls` off; an addition is in the
plan flagged, read by the worker before its next step, and shown in the block; work.parallel lines up and releases a
job. No real-model numbers yet — the rows below are the owner's to add (steps above).

| date | model | set | flag | passed | lanes right | first word (median) | front busy (all cases) | result (median) | tokens front | tokens behind | work chats |
|---|---|---|---|---|---|---|---|---|---|---|---|

## Cost

Each job re-sends a work chat's own prefix (≈12k tokens) on every step; on a cloud provider most of it is a cache hit
from the second fork on. Against today's in-line small job the estimate is ±0 to +30k tokens per job; forking before
the model removes the Orchestrator's wasted step, and the worker's "check what was done" step is gone for clear jobs.
On a local server the cost is time — one cold prefill of the worker's prompt (≈13–15 s on the owner's 27B) — and GPU
contention, not money. The routing itself is free (rules) or ≈12–100 ms (System 1).

## Risks

- **Wrong routing.** The rules miss big jobs (56% on calls); the safety net catches a missed one after one front step.
  A small request wrongly forked costs a work chat and maybe 15 s on a local model — visible, and the cheaper mistake.
- **A one-slot local server.** "Always free" holds there only with the fixed line (a clear job) or a front on another
  model; the foreground lane and two speeds are phase 2.
- **Two jobs on one thing.** More forks make it likelier; phase 1 leaves it to the plan's amend path and the person.
- **Plan churn.** A model adding steps on every message: at most five edits a minute per job, all logged in `edits`.
- **Results still cost an Orchestrator step to relay** (the supervisor's "work reported back"): mechanical result
  cards and spoken gists are phase 2.

## Not in phase 1 (and the owner's questions left open)

- `background` is **not** in `approval.FREE` (an S11 file): in Manual mode the person is asked about it like any tool.
  Whether status/add/cancel should pass unasked is the owner's call; riding `work_chats` (already FREE) would widen what
  a FREE tool writes, so it was not done either.
- The worker still acts as "Delegated by the Orchestrator": a setting the person asked for inside a forked job is a
  proposal, not a change (carrying `byPerson` into the fork widens who acts as the person — S11, not done).
- Phase 2: deterministic stop/status by words, System 1 `which` for amend, result cards and the call relay
  (`work.retell`), the foreground lane on local servers, a worker's approvals voiced in the call, the panel's background
  strip. Phase 3: stable step ids and reordering, team `add_task`, the exact-prefix fork.

## Rollback

Switch the flag off (or developer mode). Every path returns to today's: no fork before the model, `orchestratorWorkSteps`
decides the hand-off, no `background` tool, the per-row briefs in the readings, nothing lined up by `work.parallel`. Plans
written while it was on keep their extra fields (`from`, `version`, `edits`, state `living`), which today's readers
ignore; a `living` plan reads as a plan that needs no approval. A job lined up when it is switched off still starts when
one of its person's jobs ends.
