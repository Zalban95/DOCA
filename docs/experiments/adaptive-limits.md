# Experiment: limits that follow the work

Flag `experiments.adaptiveLimits` (Settings → Developer), off by default. Code: `modules/harness/turn/triage.js` (the
verdict before a turn), `modules/harness/turn/extend.js` (carrying on past the step budget), called from `agent.js`.
TODO H10.6, CONSTITUTION P20 ("the mission over tokens; limits that name themselves").

## Hypothesis

Today every turn gets the same limits: `harness.config.doca.maxSteps` (8) tool steps, and whatever thinking the model
does by default. A one-line question pays for thinking it does not need, and a build request is stopped at step 8 while
it is still getting somewhere — the person then says "go on" and the turn starts again with a cold prompt. If a cheap
look at the request sets the turn's thinking effort and step budget, and a turn that is still advancing at its last
step is allowed to carry on, then:

- small requests answer faster (less thinking), at the same success;
- large requests finish in one turn more often (fewer "Stopped after N tool steps"), at the same or better success;
- the total tokens of a set do not grow much, because the extra steps go only to turns that were advancing.

## What happens when it is on

**Before the turn, a triage** (`triage.js`). Rules first, all of them deterministic:

| Signal | Leans |
|---|---|
| a short message (under 60 characters), or a question under 160 (ends in `?`, or opens with what / who / is / can …) | small |
| "quick", "quickly", "just", "briefly", "in a word", "tl;dr", "asap" | small, and quick |
| a call (assistant mode or the chat's 🎙) or a watch | small, and quick |
| a build verb (build, implement, refactor, migrate, set up, debug, deploy, write a script …) | large |
| a whole thing (an app, a project, from scratch, end to end, every, all the …) | large |
| a long message (over 400 characters; over 1000 counts twice) | large |
| a list of three or more steps in the message | large (twice) |
| the conversation's plan has open steps | large |

The rules give a score; clearly small or clearly large is decided there. In between (medium, or signals that cancel out)
the rules are unsure, and **only then**, when the owner set a quick model for assistant mode (`assistant.model`), that
model is asked once — no tools, no memory, a one-line answer: `small|medium|large quick|normal`. Without one, or when it
does not answer, the rules' medium stands.

The verdict sets:

- **Thinking effort** (`turn/effort.js` levels): quick or small → `low`, medium → `medium`, large → `high`. A level the
  person set for this conversation (`session.effort`, the `effort` tool) still wins; the triage takes the place of
  assistant mode's and the harness's default.
- **Step budget**: small → today's `maxSteps`, medium → twice it, large → four times it, never above the ceiling
  `limits.maxStepsCeiling` (64 by default; not proposable — the owner's). **Never below today's `maxSteps`**: the owner
  asked for limits that follow the work, not limits lowered to save tokens (P20). A specialist's own `maxSteps` is its
  base, the same way.

The agent's `# Your limits` names the budget, where it came from and the ceiling. The verdict is a `triage` event and a
span in the turn's trace (difficulty, urgency, by rules or model, the reasons, effort and steps).

**At the last step, an extension** (`extend.js`). A turn that reaches its budget with a tool step just run is given
another `maxSteps` steps, up to the ceiling, when it is still advancing:

- no call failed the same way three times this turn (`turn/failures.js`, the supervisor's failure loop), and
- either a step of the conversation's plan closed during this turn, or the last two steps' tool calls all succeeded and
  were not the same calls repeated (a poll going round is not progress).

Each extension is a `warning` of kind `extended` naming why and the new budget, and a span in the trace. A turn that
stops at the ceiling says so, naming `limits.maxStepsCeiling`.

**Off, nothing of this runs**: no triage, no event, no change to effort, steps, the limits block or the step-limit note.

## Measured

How: `npm run experiment -- adaptive-limits [set] [--models provider/model]` runs an evaluation set (default `routing`)
with the flag off and on, each in its own throwaway sandbox (`bin/doca-eval.js --flag adaptiveLimits`), and prints
success, tokens, steps and time per run and per difficulty. Cases carry `difficulty` (`small`, `medium`, `large`), which
the checks ignore; a case without one is counted as "untagged". Real model, real tokens — nothing runs it by itself.

| date | model | set | flag | passed | tokens | steps | time | small / medium / large passed | notes |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-07 | DeepSeek4f / deepseek-flash | newcomer | off | 6/9 | 1,554,687 | 50 | 264.9 s | 2/2 / 3/4 / 0/1 | 2 untagged |
| 2026-10-07 | DeepSeek4f / deepseek-flash | newcomer | on | 7/9 | 907,874 | 30 | 117.6 s | 1/2 / 4/4 / 1/1 | 2 untagged |

One run each, so a hint rather than a verdict: with the flag on the same set passed one more case for 42% fewer
tokens and 56% less time — the quick, low-effort turns were the saving, and the large case (`set-me-up`) passed with
its budget raised. The small case lost (`what-can-you-do`, judged on wording) is the set's usual run-to-run variance
(docs/audits/2026-10-07-newcomer.md). Next: the routing set, and a second run of both.

## Cost and risks

- **Tokens.** A large verdict and every extension allow more steps; each step re-sends the prompt (most of it cached).
  The extension asks for evidence of progress, so a confused turn still stops at its budget. The owner's stated
  priority is finishing the work over spend (P20); the measurement shows what it costs.
- **A model call before the turn**, only when the rules are unsure and a quick model is set: one short completion,
  bounded by a 20-second wait. Not counted in the turn's ledger.
- **Wrong verdicts.** A small verdict on real work lowers the thinking effort (the step budget never drops below today's,
  and the extension still applies); a large verdict on a question raises the effort. The per-difficulty columns are
  how this is seen.
- **The cached prefix.** `# Your limits` names the turn's budget, so it differs between a small and a large turn of the
  same conversation; it is stable within a turn.

## Rollback

Switch the flag off. Failing removes `turn/triage.js`, `turn/extend.js`, the `limits` settings section, their lines in
`agent.js`, `budget.js`, `step-limit.js` and `trace.js`, and `bin/experiments/adaptive-limits.js`.
