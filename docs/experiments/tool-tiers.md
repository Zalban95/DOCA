# Experiment: send the core tools in full, the rest by name

**Graduated 2026-10-09** (branch lean-prompt, docs/experiments/lean-prompt.md): on for everyone, the flag removed
(migration `3.4-tool-tiers-graduated`). The off switch is the setting `harness.config.doca.toolsLoading: all` (⚙ →
Advanced → How tools are sent), kept as the alternative `tools-all`. **Was:** `experiments.toolTiers`. **TODO:** B2
(audit 2026-10-06, aw 25, coh F4). **Since:** 2.249.0.

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

**With a model** (`npm run eval -- routing --models llamacpp/qwen3.8-27b --flag toolTiers`, the local Qwen 3.8 27B with
a 40,960-token context; the first seven of the eleven routing cases — the run ended during the eighth, see below):

| date | model | flag | passed | tokens per case (1 · 2 · 4 · 5, passed both ways) | failures |
|---|---|---|---|---|---|
| 2026-10-06 | llamacpp / qwen3.8-27b | off | 4/7 | 19.1k · 88.5k · 58.4k · 126.8k | grep through shell; two turns over the 40,960 context (43,262 tokens) |
| 2026-10-07 | llamacpp / qwen3.8-27b | on | 5/7 | 13.7k · 69.8k · 58.1k · 62.3k | grep through shell; "get whisper running" by hand in 12 steps (255k tokens), never install_propose |

On a local model with a 40k window the flag decides whether a turn fits at all: off, two of seven turns were refused by
the server; on, none was. Where both passed it cost 4–51 % fewer tokens. Two habits survive either way — grep through
`shell`, and installing by hand — and are for the prompt and the routing table, not the tool list. The run ended
cleanly during case 8 ("build and install the Android app"): no result was saved and the sandbox was gone, so what the
turn did is unknown — TODO B7b.

**All eleven cases, each combination in a fresh sandbox** (2.257.2; DeepSeek's flash model, 128k context):

| date | model | flag | passed | tokens | steps | failures |
|---|---|---|---|---|---|---|
| 2026-10-07 | DeepSeek4f / deepseek-flash | off | 9/11 | 2,531k | 74 | `remember`: said "written to memory" without calling `memory_write`; `skill-before-improvising`: read the skill, then improvised Gradle and adb (1.0M tokens, 21 steps) |
| 2026-10-07 | DeepSeek4f / deepseek-flash | on | 10/11 | 1,857k | 73 | `skill-before-improvising` as above (0.84M tokens, 23 steps) |
| 2026-10-07 | llamacpp / qwen3.8-27b-gsq-rco-iq3s (40,960 context) | off | 11/11 | 1,780k | 68 | — (the Android case in 34 steps, 1.02M tokens) |
| 2026-10-07 | llamacpp / qwen3.8-27b-gsq-rco-iq3s (40,960 context) | on | 11/11 | 1,153k | 59 | — (the Android case in 22 steps, 0.54M tokens) |

On a frontier-class model with room to spare the flag costs nothing in passes (one more, the `remember` case) and
saves 27 % of the tokens over the set. The local IQ3_S quantisation of Qwen 3.8 27B — the only local model now kept —
passes all eleven both ways, with the flag 35 % fewer tokens and the Android build in 22 steps instead of 34; the grep
and install-by-hand habits the Q6 run showed (B7b) did not appear. The one failure both ways is a habit, not a missing tool: the skill was read and
not followed — TODO B7c.

Not measured yet, and what decides it: whether a model finds and loads what it needs (an evaluation set of tasks that
need a rare tool — B7 — run with the flag off and on, on a small local model and a frontier one), and how often a
loaded tool breaks the provider's prefix cache (once per load, by design).

## Cost and risks

- A tool loaded mid-conversation changes the schemas sent, so the cached prefix breaks once at that step.
- A model may answer "I cannot" instead of loading a named tool. The line says how; the routing evals will show it.
- A tool called by name without its schema may be called with the wrong arguments once; the error and the loaded
  schema on the next step correct it.

## Rollback

`harness.config.doca.toolsLoading: all`: everything is sent again on the next step.
