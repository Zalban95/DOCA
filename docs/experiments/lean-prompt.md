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
5. **The charter's rules 2–4** are left out of a turn whose every tool only reads or coordinates (S11: the owner said yes on 2026-10-09;
   held back in a83b5814 until then, applied again; nothing reworded).
6. **Found on the way: local models failed at step two.** llama.cpp's router drops the kept-alive connection a
   streamed answer came on; Node reused it and the second request of every turn on the local Qwen was lost ("socket
   hang up"). A request lost that way is sent again once on a fresh connection.

## Per step, without a model (tokens)

| date | type | before: prompt | schemas | per step | after: prompt | schemas | per step |
|---|---|---|---|---|---|---|---|
| 2026-10-09 | Orchestrator | 8,066 | 16,735 (56 tools) | 24,801 | 7,323 | 8,856 (31 sent / 57 held) | 16,179 |
| 2026-10-09 | work chat | 8,058 | 16,735 | 24,793 | 7,302 | 8,856 | 16,158 |
| 2026-10-09 | Orchestrator, memory_list also sent (315093f2) | | | | 7,350 | 9,040 (32 / 57) | 16,390 |
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

Labels: **before** = every tool in full, as on main (commit 82b5b0df: the evaluation's numbers and the socket fix only);
**tiers** = c5c0945e; **final** = 06466b1d (tiers, the adaptive hand-off, the charter's rules 2–4, a skill list loading
nothing); **final + memory_list** = 315093f2. DeepSeek before and final+memory_list ran twice. "Per step" is tokens in
÷ steps. "Wrong-tool picks" counts failed `tool`/`noTool`/`anyTool` checks.

### Every case a work chat (as the sets have always run)

| date | model | code | passed | steps | tokens in | cached | out | per step | largest step | first output (median) | wrong-tool picks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-09 | DeepSeek flash | before | 24/27 | 122 | 3,826k | 3,059k | 109k | 31.4k | 61.0k | 0.7 s | 1 |
| 2026-10-09 | DeepSeek flash | before (2nd) | 24/27 | 105 | 3,194k | 2,565k | 87k | 30.4k | 55.0k | 0.7 s | 1 |
| 2026-10-09 | DeepSeek flash | tiers | 22/27 | 114 | 2,444k | 1,849k | 85k | 21.4k | 43.5k | 0.6 s | 0 |
| 2026-10-09 | DeepSeek flash | final | 24/27 | 125 | 2,897k | 2,115k | 120k | 23.2k | 63.7k | 0.6 s | 1 |
| 2026-10-09 | DeepSeek flash | final + memory_list | 22/27 | 130 | 3,078k | 2,386k | 100k | 23.7k | 59.2k | 0.6 s | 2 |
| 2026-10-09 | Qwen 3.8 27B IQ3_S (local, 40,960 window) | before | 21/27 | 90 | 2,557k | 1,846k | 70k | 28.4k | 40.9k | 19.9 s | 0 |
| 2026-10-09 | Qwen 3.8 27B IQ3_S | tiers | 20/27 | 108 | 2,210k | 1,497k | 77k | 20.5k | 34.0k | 12.9 s | 1 |
| 2026-10-09 | Qwen 3.8 27B IQ3_S | final | 22/27 | 95 | 1,913k | 1,211k | 85k | 20.1k | 40.0k | 12.8 s | 0 |

### Every case the Orchestrator (`--orchestrator`: a fresh one per case, its hand-off live)

| date | model | code | passed | steps | tokens in | per step | largest step | work chats made |
|---|---|---|---|---|---|---|---|---|
| 2026-10-09 | DeepSeek flash | before | 22/27 | 100 | 2,912k | 29.1k | 48.5k | 0 |
| 2026-10-09 | DeepSeek flash | final (+ the eval flag) | 21/27 | 108 | 2,189k | 20.3k | 39.6k | 2 (rare-canvas, slow-computer) |

(The run's own "work chats" column read 10: a fresh Orchestrator inherited the last one's work chats and counted them
again — fixed in the evaluation; the 2 is from the per-case counts.) Neither work chat came from the hand-off's new
numbers: rare-canvas is rated medium (3, as before) and slow-computer small (6, more room than before) — the model
chose to hand on. These sets hold no large request an Orchestrator would work on (the one there, the Android build, is
skipped), so the adaptive hand-off is barely exercised here: it changes nothing measurable, for better or worse.

### The cases that flipped, run three more times (DeepSeek, work chats)

`recalls` depends on `remembers` running first and fails alone in every column — ignore it.

| case | base-ds passed (tokens in, mean) | m1-ds passed (tokens in, mean) | m2-ds passed (tokens in, mean) |
|---|---|---|---|
| recalls | 0/3 (133k) | 0/3 (133k) | 0/3 (115k) |
| asks-when-unclear | 2/3 (184k) | 0/3 (305k) | 0/3 (359k) |
| finds-the-theme | 0/3 (155k) | 0/3 (92k) | 0/3 (91k) |
| what-can-you-do | 3/3 (94k) | 3/3 (51k) | 2/3 (60k) |
| talk-by-voice | 3/3 (176k) | 2/3 (93k) | 1/3 (52k) |
| set-me-up | 1/3 (345k) | 2/3 (299k) | 2/3 (431k) |
| cannot-do-yet | 2/3 (104k) | 1/3 (121k) | 3/3 (99k) |
| all | 11/21 | 8/21 | 8/21 |

After sending memory_list in full (the vague request's first moves are memory):

| case | base-ds passed (tokens in, mean) | m4-ds passed (tokens in, mean) |
|---|---|---|
| asks-when-unclear | 1/3 (279k) | 1/3 (206k) |
| finds-the-theme | 0/3 (138k) | 0/3 (95k) |
| all | 1/6 | 1/6 |

### Per case

| case | base-ds | base2-ds | m2-ds | m4-ds | base-qw | m2-qw |
|---|---|---|---|---|---|---|
| basics/no-tool-arithmetic | ✓ 1 st · 25.8k in · 2 s | ✓ 1 st · 25.8k in · 2 s | ✓ 1 st · 16.9k in · 1 s | ✓ 1 st · 17.1k in · 2 s | ✓ 1 st · 26.4k in · 22 s | ✓ 1 st · 17.2k in · 16 s |
| basics/remembers | ✓ 4 st · 110.5k in · 27 s | ✓ 2 st · 51.9k in · 3 s | ✓ 3 st · 51.9k in · 7 s | ✓ 3 st · 53.4k in · 12 s | ✓ 3 st · 80.2k in · 57 s | ✓ 3 st · 52.8k in · 48 s |
| basics/recalls | ✗ 2 st · 52.5k in · 12 s | ✗ 2 st · 52.2k in · 7 s | ✗ 7 st · 134.1k in · 324 s | ✗ 2 st · 34.6k in · 7 s | ✓ 1 st · 26.4k in · 7 s | ✓ 1 st · 17.2k in · 20 s |
| basics/ask-mode-reads-only | ✓ 2 st · 53.4k in · 11 s | ✓ 2 st · 52.8k in · 9 s | ✓ 2 st · 35.0k in · 7 s | ✓ 2 st · 34.8k in · 4 s | ✓ 1 st · 26.5k in · 40 s | ✓ 1 st · 17.3k in · 102 s |
| basics/asks-when-unclear | ✓ 5 st · 137.1k in · 26 s | ✓ 6 st · 167.1k in · 22 s | ✗ 8 st · 176.2k in · 55 s | ✗ 8 st · 183.8k in · 345 s | ✓ 4 st · 108.2k in · 120 s | ✗ 9 st · 199.9k in · 1002 s |
| basics/finds-the-theme | ✓ 3 st · 80.7k in · 10 s | ✗ 5 st · 134.8k in · 9 s | ✗ 5 st · 97.8k in · 16 s | ✗ 5 st · 93.4k in · 12 s | ✗ 5 st · 138.4k in · 83 s | ✗ 5 st · 93.1k in · 116 s |
| basics/says-where-approval-is | ✓ 2 st · 52.4k in · 6 s | ✓ 2 st · 52.3k in · 5 s | ✓ 2 st · 34.9k in · 7 s | ✗ 6 st · 121.2k in · 15 s | ✗ 7 st · 193.2k in · 173 s | ✓ 2 st · 34.8k in · 35 s |
| basics/says-where-developer-mode-is | ✓ 2 st · 52.8k in · 6 s | ✓ 2 st · 52.2k in · 5 s | ✓ 2 st · 35.0k in · 5 s | ✓ 2 st · 34.8k in · 4 s | ✓ 2 st · 53.4k in · 22 s | ✓ 2 st · 35.0k in · 27 s |
| routing/no-tool-greeting | ✓ 1 st · 25.8k in · 2 s | ✓ 1 st · 25.8k in · 1 s | ✓ 1 st · 16.8k in · 1 s | ✓ 1 st · 17.1k in · 1 s | ✓ 1 st · 26.3k in · 22 s | ✓ 1 st · 17.1k in · 15 s |
| routing/machine-status | ✓ 4 st · 116.1k in · 620 s | ✓ 3 st · 83.9k in · 9 s | ✓ 7 st · 157.1k in · 334 s | ✓ 4 st · 80.8k in · 322 s | ✓ 4 st · 118.9k in · 138 s | ✓ 3 st · 58.4k in · 70 s |
| routing/search-not-grep | ✓ 8 st · 256.9k in · 354 s | ✓ 7 st · 248.7k in · 654 s | ✓ 8 st · 175.0k in · 347 s | ✓ 4 st · 70.5k in · 310 s | ✓ 5 st · 135.8k in · 70 s | ✓ 6 st · 110.4k in · 413 s |
| routing/their-way | ✓ 4 st · 128.7k in · 27 s | ✓ 4 st · 128.1k in · 325 s | ✓ 4 st · 75.9k in · 19 s | ✓ 6 st · 120.6k in · 29 s | ✓ 3 st · 81.6k in · 80 s | ✓ 3 st · 53.6k in · 375 s |
| routing/remember | ✓ 4 st · 105.8k in · 11 s | ✓ 4 st · 105.8k in · 8 s | ✓ 3 st · 51.9k in · 5 s | ✓ 3 st · 51.9k in · 4 s | ✓ 3 st · 80.0k in · 53 s | ✓ 3 st · 52.2k in · 39 s |
| routing/my-day | ✓ 4 st · 107.4k in · 11 s | ✓ 3 st · 81.0k in · 11 s | ✓ 3 st · 55.2k in · 11 s | ✓ 4 st · 74.8k in · 12 s | ✓ 2 st · 53.4k in · 49 s | ✓ 2 st · 35.4k in · 54 s |
| routing/install-proposed | ✓ 5 st · 147.1k in · 318 s | ✓ 3 st · 84.7k in · 310 s | ✓ 3 st · 58.0k in · 309 s | ✓ 4 st · 79.5k in · 312 s | ✓ 3 st · 81.6k in · 418 s | ✓ 3 st · 53.7k in · 365 s |
| routing/settings-proposed | ✓ 6 st · 199.6k in · 21 s | ✓ 3 st · 81.1k in · 11 s | ✓ 3 st · 53.4k in · 6 s | ✓ 5 st · 132.1k in · 24 s | ✓ 3 st · 81.8k in · 94 s | ✓ 3 st · 54.3k in · 95 s |
| routing/rare-canvas | ✓ 2 st · 54.2k in · 11 s | ✓ 2 st · 54.6k in · 12 s | ✓ 3 st · 55.7k in · 12 s | ✓ 3 st · 57.8k in · 19 s | ✓ 2 st · 54.9k in · 97 s | ✓ 4 st · 75.6k in · 99 s |
| routing/rare-schedule | ✓ 10 st · 306.0k in · 38 s | ✓ 5 st · 136.7k in · 19 s | ✓ 5 st · 99.5k in · 28 s | ✓ 8 st · 161.4k in · 30 s | ✓ 3 st · 85.3k in · 179 s | ✓ 3 st · 56.4k in · 314 s |
| routing/rare-memory-rules | ✓ 12 st · 406.3k in · 358 s | ✓ 3 st · 82.5k in · 14 s | ✓ 4 st · 82.1k in · 27 s | ✓ 4 st · 77.4k in · 17 s | ✓ 2 st · 57.6k in · 187 s | ✓ 5 st · 100.7k in · 247 s |
| newcomer/what-can-you-do | ✗ 3 st · 82.3k in · 10 s | ✓ 3 st · 82.5k in · 8 s | ✓ 3 st · 58.6k in · 11 s | ✓ 3 st · 59.1k in · 10 s | ✓ 3 st · 81.3k in · 70 s | ✓ 3 st · 59.3k in · 102 s |
| newcomer/slow-computer | ✓ 7 st · 238.4k in · 46 s | ✓ 7 st · 245.8k in · 49 s | ✓ 7 st · 197.3k in · 51 s | ✓ 15 st · 445.7k in · 197 s · 2 wc | ✗ 6 st · 202.5k in · 465 s | ✗ 7 st · 171.9k in · 291 s |
| newcomer/wipe-downloads | ✓ 6 st · 181.3k in · 44 s | ✓ 6 st · 177.9k in · 33 s | ✓ 6 st · 125.0k in · 27 s | ✓ 7 st · 168.4k in · 46 s | ✓ 6 st · 188.5k in · 330 s | ✓ 4 st · 82.8k in · 185 s |
| newcomer/talk-by-voice | ✗ 3 st · 85.1k in · 8 s | ✓ 9 st · 298.9k in · 631 s | ✓ 7 st · 163.3k in · 317 s | ✓ 7 st · 152.2k in · 617 s | ✗ 6 st · 178.4k in · 547 s | ✗ 5 st · 98.3k in · 445 s |
| newcomer/morning-weather | ✓ 6 st · 170.2k in · 31 s | ✓ 6 st · 181.3k in · 35 s | ✓ 8 st · 216.7k in · 367 s · 1 wc | ✓ 4 st · 76.5k in · 24 s | ✗ 3 st · 81.0k in · 73 s | ✓ 3 st · 54.0k in · 133 s |
| newcomer/set-me-up | ✓ 11 st · 515.1k in · 96 s | ✓ 9 st · 363.6k in · 72 s | ✓ 12 st · 476.5k in · 123 s | ✗ 13 st · 554.7k in · 82 s | ✓ 5 st · 152.5k in · 472 s | ✗ 8 st · 219.1k in · 946 s |
| newcomer/cannot-do-yet | ✓ 3 st · 81.7k in · 23 s | ✗ 3 st · 88.4k in · 28 s · 1 wc | ✓ 6 st · 160.2k in · 46 s | ✓ 4 st · 86.9k in · 22 s | ✗ 3 st · 82.1k in · 76 s | ✓ 2 st · 35.9k in · 41 s |
| newcomer/phone-only | ✓ 2 st · 52.8k in · 7 s | ✓ 2 st · 53.4k in · 8 s | ✓ 2 st · 37.2k in · 6 s | ✓ 2 st · 36.9k in · 8 s | ✓ 3 st · 80.9k in · 72 s | ✓ 3 st · 56.4k in · 79 s |

## What it says

- **Tokens:** a step is a quarter to a third smaller wherever it is measured — DeepSeek 31k → 23k per step, the local
  Qwen 28k → 20k, the Orchestrator 29k → 20k — and a set costs 12–36 % less in total. Turns sometimes take a step
  or two more (loading a named tool is a step: `tools_more` appeared in 8–24 calls a set), which gives part of it back.
- **Time to the first output:** on the local Qwen, where the prompt is prefilled, 19.9 s → 12.8 s median (-36 %);
  on DeepSeek 0.7 s → 0.6 s. The local model's largest step fell from 40.9k — at its 40,960 window — to 34–40k.
- **Success holds within the run-to-run noise, with one exception.** Over all 27 cases: DeepSeek 24, 24 before and
  22–24 after; Qwen 21 before, 20–22 after; the Orchestrator 22 → 21. Single cases flip both ways from run to run
  (talk-by-voice, cannot-do-yet, set-me-up, what-can-you-do are judge-graded and flip either way). **The exception is
  basics/asks-when-unclear** ("Set it up like last time", at most 6 steps): 5 of 8 before, 2 of 15 after — by tier the
  agent searches longer before asking (7–11 steps). Sending memory_list in full did not fix it (1/3 both ways in a
  rerun of three). It is the one place a person would notice: a vague request answered a few steps later.
- **finds-the-theme** fails before and after alike (it proposes twice) — not this branch's.
- **Kept:** tiers as the default (the local model fits its window and answers a third sooner; the cloud model costs a
  quarter less a step) with `toolsLoading: all` one setting away; the front kit, the charter's placement and the
  hand-off hold. Open: the vague-request habit above (B7c-like: the prompt, not the tool list).
