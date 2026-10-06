# Experiment: the agent repairs a recipe that failed

**Flag:** `experiments.recipeRepair` (Settings → Developer), off by default. **TODO:** H3.4. **Since:** 2.176.0.

## Hypothesis

A recipe fails when the world it was recorded in changes — a path moved, a flag was renamed, a service answers
on another port. Today the run stops and says which step. If the agent is handed the failed run (the step, its
result, the recipe) it can find the change and propose a repaired revision, so recipes become *more* reliable
with use instead of going stale — the "repeatable without the thinking" question (hive.md §2.3), kept true over time.

## What happens when it is on

1. A recipe run fails a check.
2. The run's own conversation gets one more turn, as the person the run acted for: the recipe, the failed step and
   its result, and the instruction to investigate (read-only first), then propose a repaired revision with
   `recipe propose` — never `save`.
3. The proposal waits beside the recipe (Harness → Recipes: "r3 proposed"); a person reads the steps and accepts or
   discards it. Runs keep using the accepted revision until then.

## Measured

`npm run experiment -- recipe-repair` against the configured model: it makes recipes with one deliberate break
each (a moved file, a renamed command flag, a wrong expected text), runs them with the flag on, and reports how
many proposals, when accepted, then pass — with the tokens and seconds the repairs cost.

| Date | Model | Repaired and passing | Tokens per repair | Seconds per repair |
|---|---|---|---|---|
| — | — | not measured yet: needs a configured model on the machine running it | — | — |

## Cost

One agent turn per failed run (bounded by the turn's own step and token limits), only while the flag is on.

## Risks

- **A repair that passes the check but does the wrong thing.** That is why it is a proposal a person accepts, and
  why the run's checks matter: a recipe with weak checks gets weak repairs.
- **Loops**: a run that fails again after a repair does not start another repair for the same revision.
- **Cost on a schedule**: a scheduled recipe that keeps failing makes one repair turn per revision, not per run.

## Rollback

Switch the flag off: no repair turn starts. Proposed revisions stay until accepted or discarded; nothing else
is left behind.
