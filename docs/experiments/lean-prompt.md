# Measurement: a leaner prompt (2026-10-09)

Asked by the owner on 2026-10-09 — "Measuring the prompt, you can start and optimize" — after a live reading of
`GET /api/harness/prompt` showed the Orchestrator sending ~30k tokens a step: ~10k of system prompt and ~20k of tool
schemas (81 tools: 56 built-ins, 25 from the desk's MCP server). Branch `lean-prompt`. Not an experiment with a flag:
a record of what was measured, what changed, and what it did.

## How it was measured

- **Without a model** — `npm run experiment -- tool-tiers` and `GET /api/harness/prompt`'s breakdown on a sandbox of
  the owner's settings (≈4 characters a token). The sandbox now carries the hive's licence (it ran `core` alone
  before: 45 tools instead of 56). Client-hosted MCP servers are left out of every sandbox, so the desk's 25 tools
  (≈3.4k) are not in these numbers: on the live hive they are named on one line now instead of sent in full.
- **With a model** — the shipped evaluation sets (`basics`, `routing`, `newcomer`) through `npm run eval`, on a
  sandbox of a copy of the owner's settings, once on DeepSeek (`DeepSeek4f / deepseek-flash`, the configured model)
  and once on the local Qwen 3.8 27B IQ3_S (`llamacpp / qwen3.8-27b-gsq-rco-iq3s`, its real 40,960-token window, no
  fallback chain so no case is answered by another model). Three cases that act on this machine outside the sandbox
  were skipped: `basics/refuses-destruction` (`rm -rf /`), `routing/skill-before-improvising` (builds and installs on
  the owner's phone), `newcomer/their-way-newcomer` (writes under /tmp). The owner's Home Assistant and Blender MCP
  servers were left out of the copy. The evaluation now records tokens sent, cached and written, the largest step,
  the time to the first output (a word, a thought or a tool call) and the work chats a case made.
- **Caveat on time:** the copy keeps the owner's approval mode (Manual, what matters). A call Manual asks about waits
  for its 5-minute timeout in an evaluation, so a case's time is dominated by that when it happens; tokens and the
  first output are the comparable numbers. One run per configuration: a single case flipping is within the noise.

## What changed (each its own commit)

1. **Tools sent by tier for everyone** — the `toolTiers` experiment graduated; the off switch is
   `harness.config.doca.toolsLoading: all`. The named tools are grouped by kit; MCP servers by id, count and machine.
   The charter and routing follow what is *held*. A conversation bound to a project gets its code kit in full. A list
   of skills no longer loads every tool it mentions (it broke the cached prefix between turns).
2. **The prompt breakdown counted "Your limits" twice** — it was never sent twice; the reading was wrong.
3. **A spoken turn's prompt describes its front kit**, not all 56 tools (it was sent 19 schemas and told about 56).
4. **The Orchestrator's hand-off follows the request's size** — triage's rules, no model: small up to 6 steps, large
   after 1, medium the setting (3).
5. **The charter's rules 2–4** are left out of a turn whose every tool only reads or coordinates (S11: shown to the
   owner before merge; nothing reworded).
6. **Found on the way: local models failed at step two.** llama.cpp's router drops the kept-alive connection a
   streamed answer came on; Node reused it and the second request of every turn on the local Qwen was lost ("socket
   hang up"). A request lost that way is sent again once on a fresh connection.

## Per step, without a model (tokens)

| date | type | before: prompt | schemas | per step | after: prompt | schemas | per step |
|---|---|---|---|---|---|---|---|
| 2026-10-09 | Orchestrator | 8,066 | 16,735 (56 tools) | 24,801 | 7,323 | 8,856 (31 sent / 57 held) | 16,179 |
| 2026-10-09 | work chat | 8,058 | 16,735 | 24,793 | 7,302 | 8,856 | 16,158 |
| 2026-10-09 | spoken front (a call) | 8,616 | 5,205 (19) | 13,821 | 6,983 | 5,205 (19) | 12,188 |
| 2026-10-09 | archivist, researcher, scout, tester (charter only) | 1,715 | | | 1,600 | | |

The breakdown (`GET /api/harness/prompt`) read 25,245 for the Orchestrator before (374 of them the double count) and
16,247 after; on the live hive with the desk connected, ≈30k → ≈17k, its 25 tools on one line.

## The charter, rule by rule

Every rule is sent word for word or not at all (`test/harness-awareness.test.js` holds the sent text byte-identical).

| rules | when a turn gets them | why it cannot break them otherwise |
|---|---|---|
| preamble, 1 (look before you touch) | always | — |
| 2 one change at a time, 3 follow what is there, 4 leave a way back | a turn holding any tool outside `providers.CHANGES_NOTHING` (an allowlist of tools that read, report or coordinate; a new tool counts as changing) | they are about making a change |
| 5–9 Safety (8: stay in the allowed roots, reading included) | always | — |
| 10–12 Honesty | always | — |
| 13–15 Reaching the user | always | asking well and speaking plainly apply to every answer |
| 16–23 Working on a repository | a turn holding `repo_rules`, `git`, `write_file`, `replace_in_files` or `shell` (unchanged since B8) | no tool that can touch a repository |
| 24–28 Understanding what is asked | always | — |

Who gets what: the Orchestrator, work chats, the coder, blender and the reporter get all 28; a spoken turn (front kit:
memory_write, settings_propose, tell_device, recipe…) gets all but 16–23; the archivist, researcher, scout and a
tester without a computer get all but 2–4 and 16–23.

## With a model

RESULTS
