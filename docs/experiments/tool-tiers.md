# Experiment: send the core tools in full, the rest by name

**Flag:** `experiments.toolTiers` (Settings → Developer), off by default. **TODO:** B2 (audit 2026-10-06, aw 25,
coh F4). **Since:** 2.249.0.

## Hypothesis

Every step re-sends every tool schema the turn holds: on a bare install ≈11.7k tokens of the ≈17.9k a step costs the
Orchestrator, most of it for tools a turn never touches (`memory_rules_write` alone is ≈700), and a phone's hands add
2.5k more. A weaker or local model also chooses worse from 48 tools than from 30. Sending the core tools in full and
naming the rest on one line — loaded for the conversation when they are needed — should cut a step by a third with no
task left undoable, because what is *held* does not change.

## What happens when it is on

1. The Orchestrator and work chats are sent `turn/tool-tiers.js` `CORE` (34 tools: files, shell, git, project, memory
   search and write, skills, recipes, settings, devices, the web, delegation, `tools_more`) and every `connector_*`.
   Specialists are untouched: their lists are already short.
2. The rest — rare built-ins and each MCP server's tools — appear once in "Your tools": *More tools you hold, not
   loaded yet …* with built-ins by name and servers as `mcp:<id> (N tools)`.
3. A tool is loaded for the conversation (`session.toolsAttached`) when the person's message names it (or a server's
   id), when the agent calls it by name (it runs: it is held), when a skill or recipe the agent reads names it, or
   with `tools_more {names}`. From the next step it is sent in full.

## Measured

`npm run experiment -- tool-tiers`: per step, characters ÷ 4, on the sandbox's copy of this machine's settings.

| date | type | flag | tools sent / held | prompt | schemas | per step |
|---|---|---|---|---|---|---|
| 2026-10-06 | Orchestrator | off | 45 / 45 | 6195 | 11738 | 17933 |
| 2026-10-06 | work chat | off | 45 / 45 | 5968 | 11738 | 17706 |
| 2026-10-06 | Orchestrator | on | 29 / 46 | 5746 | 6837 | 12583 |
| 2026-10-06 | work chat | on | 29 / 46 | 5520 | 6837 | 12357 |

Not measured yet, and what decides it: whether a model finds and loads what it needs (an evaluation set of tasks that
need a rare tool — B7 — run with the flag off and on, on a small local model and a frontier one), and how often a
loaded tool breaks the provider's prefix cache (once per load, by design).

## Cost and risks

- A tool loaded mid-conversation changes the schemas sent, so the cached prefix breaks once at that step.
- A model may answer "I cannot" instead of loading a named tool. The line says how; the routing evals will show it.
- A tool called by name without its schema may be called with the wrong arguments once; the error and the loaded
  schema on the next step correct it.

## Rollback

Switch the flag off: everything is sent again on the next step. Failing, `turn/tool-tiers.js`, `tools_more` and the
two call sites (agent.js, prompt.js, tool-calls.js) go.
