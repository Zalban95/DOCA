# TODO — done

These are sections of TODO.md that were finished, moved here verbatim on 2026-10-07 and kept as the record of what was decided and why.

## Compaction folds earlier turns only, and that is deliberate

Not a defect and not an open question — a decision that reads like a bug, which
is exactly why it needs writing down. Found 2026-09-18 while testing compaction
by lowering `compactTokens` and watching a turn run past it without folding.

The first attempt looked like a failure: prompts reached 20,368 tokens against a
threshold of 9,000 and nothing compacted. It was the guard working. Under token
pressure `memory.pendingFold(…, { force: true })` folds **only turns that have
already finished**, never the turn in progress:

> folding "the older half" then meant summarising the turn in progress — the code
> the agent is iterating on, clipped into 250 words — and doing it again on the
> next step, because the fold barely shrank the prompt. Under pressure, fold only
> earlier turns; when there are none, there is nothing to fold and no model call
> is made.

So in a **first** turn there is nothing to fold, however large the prompt gets,
and no `compacted` event is emitted. That is correct, and it is worth knowing
before someone reads a long single-turn session as a compaction bug — the fix
would be to "make it fold" and the result would be worse than the problem.

Confirmed working on a session with a prior turn: it fired exactly at the
threshold, and the summary kept `HALCYON` and `8443` verbatim, which is what the
summariser prompt asks for ("keep names, paths and numbers verbatim").

Related: a fold rewrites the transcript, so the step after one always shows a
cache collapse — measured at 16% on the step following, recovering to 77% and
81% after. Expected, one-off, and not a regression; see the cache section above.

## Settings consistency

**All three done** (checked 2026-09-26; the entries had gone stale): status
lines follow one rule in `setStatus()` — success fades, errors stay
(`test/status-lines.test.js`); two restart phrases, "restart DOCA" and "restart
OpenClaw", each meaning one thing; and the Config tab lists exactly the Setup
panel's four scripts (`paths.SCRIPT_CONFIG`). **Changed in 2.65.1:** saving an
API key said "restart OpenClaw to apply" to everyone, but DOCA's own harness
reads the key on every call — it now says DOCA uses it at once, and mentions
restarting OpenClaw only when OpenClaw is installed.

## Errors that surface as the wrong thing

- ~~**`modules/files.js:79`** a moved or deleted favourite answered 500.~~
  Already fixed (`files.fsStatus`: ENOENT/ENOTDIR → 404, EACCES/EPERM → 403);
  the entry was stale, checked 2026-09-26.

- ~~**Device rotate/revoke and skill toggles report failures through
  `appAlert()` only.**~~ Already done (checked 2026-09-26): both use the card's
  status line, `appAlert` only as a fallback when there is none.
