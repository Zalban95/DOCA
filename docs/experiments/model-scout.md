# Experiment: a scout for better and new models

**Flag:** `experiments.modelScout` (Settings → Developer), off by default; the routine itself is `scout.enabled`, also off.
**TODO:** H10.4. **Since:** 2.213.0. **Where:** Settings → Harness → Scout; `modules/scout`; the `scout` tool.

## Hypothesis

Every function DOCA has is a model somebody chose once — speech to text, text to speech, the agent's model, the vision
reader, the embeddings, the guards — and each is a setting or a catalog row, so it can be swapped. What is missing is
noticing when to swap. Models that do a function clearly better, or something new, show up every week on Hugging Face
and in release notes, and the signal is cheap to read: trending lists per task, likes gained, new releases. A routine that
looks daily with no model, and asks the agent to read and judge only when something moved, should surface the few
changes worth making for a few cents a week — and a person accepting them into TODO, then handing them to an implementer
(DOCA's own agent or a CLI harness) closes the loop from "a better model exists" to "DOCA uses it", through the same dev
cycle every other change follows (skills/doca-dev-cycle).

## What happens when it is on

1. **A look, daily, no model** (`scout/signals.js`): Hugging Face's trending models for each task DOCA uses
   (`scout/roles.js` maps each function to its task and reads what it uses now), with likes and downloads kept from the
   last look, so "+N likes" is growth; new releases of the projects in `scout.watch` (GitHub Atom feeds); new titles in
   `scout.feeds`. Names, numbers and titles only.
2. **A brief**, every `scout.everyDays` or at once when a look finds something notable (a model that gained
   `scout.growthLikes` likes and is not in use here, or a release of a watched project): a turn in the conversation
   "Model scout", as the person who switched it on. The agent reads the look through the `scout` tool — framed as
   outside words — sends the scout specialist to read model cards and benchmarks (the airlock), and files at most five
   suggestions with `scout suggest`: the function, the candidate, what it replaces, why, the evidence, how to try it
   without breaking the current way. It changes no setting and installs nothing.
3. **A person decides** in Settings → Harness → Scout: *Accept* appends the suggestion to `TODO.md` of `scout.repo` (by
   default this install's own checkout, found through git even when a release worktree is running) under
   "## Scout suggestions"; *Decline* keeps the reason, which the next brief reads so it is not suggested again.
4. **Start the work** on an accepted one: `scout.implementer` `doca` opens a conversation of DOCA's agent with the task
   and the doca-dev-cycle skill (branch, change behind a setting or a row, tests, commit, and the owner's yes before
   merge, tag and push); a CLI harness id (`claude`, `codex`, …) asks that harness once, in the repository, its output
   kept in `DATA_DIR/scout/work-<id>.log`.

The agent can do any of this once without the routine: ask it to scout, and it uses the same tool.

## Measured

`npm run experiment -- model-scout` runs one look against the real Hugging Face and feeds (no model, nothing kept):
models seen per function, how many are growing fast, new releases and news, failures, and how long it took.

| Date | Functions | Models seen | Growing fast | New releases / news | Seconds |
|---|---|---|---|---|---|
| 2026-10-05 | 10 | 180 | first look (no baseline yet) | 0 / 0 (first look) | 7.4 |

What decides whether it graduates is the suggestions themselves: of those filed in a month, how many a person accepted,
and how many of those shipped.

## Cost

A look is ~15 small HTTP requests a day. A brief is one turn of the agent plus the scout specialist's reading — a few
tens of thousands of tokens, weekly, or when something moved.

## Risks

- **Outside words steering the agent**: model names, release titles and model cards are written by others. The look is
  framed as outside words, pages are read only by the scout specialist through the guards, and nothing the scout files
  acts: a person accepts, and the work asks before it ships.
- **Hype**: likes are popularity, not quality. The brief is told to want a model card and benchmarks, and a person
  decides.
- **A CLI implementer acts with its own permissions** in the repository: only a host starts it, on a suggestion a host
  accepted.

## Rollback

Switch `scout.enabled` off (the routine stops) or the experiment off (the tool, the card and the routine go). Suggestions
and the TODO lines stay where they are.
