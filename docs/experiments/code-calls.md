# Experiment: programmatic tool calls (`run_code`)

Flag `experiments.codeCalls` (Settings → Developer), off by default. Since 3.118.0. Code: `modules/harness/code-calls.js`
(the parent side), `code-calls-child.js` (the script's process), `toolbox/code.js` (the tool). Hermes Agent calls it
`execute_code`; the owner asked for Hermes's features to be integrated our way (2026-10-17).

## Hypothesis

A cheaper model spends one step — a whole request, the prompt sent again — on each tool call, even when the calls are a
plan it could write down at once: read twenty files and write a summary, run the level test over every level, apply one
edit across ten modules. On the Emberfall run (2026-10-17) a member made 95 calls in one turn, most of them reads. If
the agent can write that plan as a short script whose calls go through the same gates, those steps collapse into one:
fewer tokens and less time, and fewer chances to lose the thread.

## What happens when it is on

The agent holds `run_code` where it holds `shell` (same reach: a script could do what `node -e` does). It sends the
body of an async function; `await tools.read_file({ path })` and `await call(name, args)` return each tool's result
text. The script runs in a child Node process with a bare environment (no keys), in the conversation's folder, for at
most `timeoutSec` (120 by default, 5–600). Each call the script makes goes to the hub, which runs it through the turn's
own `runToolCalls` in a conversation of the script's own under the agent's — the mode, the person's level and grants,
the approval gate (Manual asks each call, Auto runs them), forced asks, the control plane, the charter's tool rules —
exactly as a recipe's steps run. At most 60 calls a script; `run_code` cannot call itself. The result is the script's
output (console.log), its returned value, how many calls it made and which failed, and where they are. It is absent in a
hosted hive, and in production a script naming DOCA's own code is refused as a shell line is.

## Measured

How: the same task twice on one model, with the flag off and on — a refactor across many files, a sweep of a game's
levels — counting steps, tokens and time per turn (Chronicle), and whether the result held its test.

| date | model | task | flag | steps | tokens | time | held | notes |
|---|---|---|---|---|---|---|---|---|

## Cost

None while off. On: one child process per script (a few MB, gone when it ends); the calls cost what they would.

## Risks

- A script is code the agent wrote, run on this machine — the same reach as `shell`, which is why it is held only
  where `shell` is, and Manual asks before it runs. Its inner calls are each gated again.
- A weak model may write a script that fails half-way: the result says how far it got and the calls made are in the
  script's conversation, so it can carry on by hand.

## Rollback

Switch the flag off: the tool is absent at the next step. Removing the experiment removes the three files and the lines
naming `run_code` in tools.js, kits.js, tool-shape.js, hosted.js, experiments.js and experiments-schema.js.
