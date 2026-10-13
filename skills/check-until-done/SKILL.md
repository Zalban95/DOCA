---
name: check-until-done
description: Keep going until the work is really done — build, grade it against what "done" means here (the plan step's contract, the project's own tests, the page as it renders), fix what fails, and repeat; stop when every check holds, or after three rounds without progress, and say plainly what still fails. Attached in Agent mode in project conversations.
attach-modes: [agent]
attach-where: project
triggers: [until it works, until done, make the tests pass, keep fixing, verify, check it works, "is it done", finché funziona, fino a che passa, verifica, controlla che funzioni, fai passare i test]
---

# Check until done

How to write the code is `write-good-code`; how to agree what "done" means is `plan-well`; how to find one bug is
`debug-method`. This is the loop around them: after building, prove the work against what "done" means, fix what does
not hold, and know when to stop.

## Before the first round: what "done" means here

Write the list of checks down once, in this order, and keep it for every round:

1. **The plan's contracts.** `work_plan` with `read`: each step's contract is its "done when …" and maybe a check
   (`{file}`, `{file, contains}`, `{url}`, `{page, contains, selector, noErrors}`, `{absent}`, `{free: port}`). Marking a
   step done with `work_plan` `progress` runs its check — a check that fails keeps the step open and says why.
2. **The project's own tests.** `project` with `info` names its commands; run them by name with `project` `run`
   (`test`, `build`, `lint` — whatever this project has), never a command you made up. A long one comes back as a
   background job: follow it with `shell_job`.
3. **The page, when there is one.** A front-end change is checked as it renders: a `{page, …, noErrors: true}`
   contract, or the page opened for the person with `canvas` preview. "The tests pass" says nothing about a page
   nobody opened.
4. **What the person asked for, in their words.** Reread the request: a check list that passes while the request is
   unmet is the wrong list.

If there is no plan and no tests, say so, and name the one check you will use instead (a command's output, a file's
content, a page) before building.

## A round

1. **Build** the next change (small; `write-good-code`).
2. **Grade**: run every check on the list, not only the one you just worked on — a fix often breaks a neighbour.
   Write down the result of each: passes, or fails with the first line of why.
3. **Fix** the first failure by its cause (`debug-method`), then start the next round.

A project keeps a checkpoint before each of your turns; when a round made things worse, `project` `changes` shows
what differs and `restore` takes it back — then try another way rather than piling fixes on a wrong start.

## When to stop

- **Every check holds** → mark the plan's steps done (`work_plan` `progress`, which runs their checks once more) and
  report what you ran and what it printed.
- **Three rounds in a row with no progress** — the same checks failing, or one fixed and another broken — stop. Do not
  try a fourth variation of the same idea, and never weaken a check (skip a test, loosen an assertion, delete a
  contract) to make it pass.

Then say it plainly:

- what holds, with the evidence;
- what still fails — the check, its last output, and your best understanding of why;
- what you tried, in one line per round;
- what would unblock it: a decision, an access, a different approach — one question when the person's answer is what
  is missing.

"Done" is a claim the checks make, never the agent alone.
