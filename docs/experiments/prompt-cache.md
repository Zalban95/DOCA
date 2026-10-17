# Experiment: cache breakpoints for models that cache only when asked

Flag `experiments.promptCache` (Settings → Developer), off by default. Since 3.110.0. Code:
`modules/harness/turn/prompt-cache.js`, applied in `turn/transport.js` `post()` after the request is shaped.

## Hypothesis

Every step re-sends the whole prompt — the charter, the tool definitions, the readings — because the owner wants the
first answer to already know everything the agent can do (2026-10-17: "the base token payload is high because I value
the user experience"). That payload is about 18–20k tokens a step on a bare install, and a long turn re-sends it tens of
times. Most providers cache the repeated prefix on their own and bill a re-read at a fraction (DeepSeek read 80–95% of
a turn's prompt from cache on the basics and routing sets), but Anthropic's models cache only at breakpoints the request
marks: through OpenRouter, Opus 5.5 read **0** cached tokens on every step of the basics set. Two breakpoints should let
it read the repeated part at a tenth of the price, with no word of the prompt changed.

## What happens when it is on

For a model whose name contains `anthropic/` or `claude`, or a provider at `anthropic.com`:

- the system prompt's content becomes one text part with `cache_control: {type: "ephemeral"}` — Anthropic caches in the
  order tools, system, messages, so this breakpoint covers the tool definitions too;
- the newest message (the person's, or a tool result mid-turn) gets the same mark on its last text part, so the next
  step's prefix — this one plus a little — is read back from the cache.

Every other model is sent the body as it was. Nothing is removed from the prompt.

## Measured

How: `npm run eval -- basics --models openrouter/anthropic/<model> --judge <one judge> --flag promptCache`, and compare the
cached share of the prompt (`tokensCached / tokensIn`) and the provider's cost for the same cases, off and on.

| date | model | flag | cases | prompt tokens | cached | notes |
|---|---|---|---|---|---|---|
| 2026-10-17 | openrouter/anthropic/claude-haiku-5.5 | off | basics 9/9 | 521647 | 0 (0%) | every step re-read at full price |
| 2026-10-17 | openrouter/anthropic/claude-haiku-5.5 | on | basics 9/9 | 492685 | 251950 (51%) | same answers; each case is a fresh sandbox, so its first step writes and one-step cases never read back — a long turn reads back on every step |

## Cost

A cache write is billed at 1.25× an uncached read for the 5-minute cache; every later read in that window at 0.1×. A
turn of more than one step pays the write once and reads it back on each step after.

## Risks

- A provider that rejects content in parts on a `system` or `tool` message would refuse the request; only Anthropic's
  models get the parts, and OpenRouter documents them for those.
- A breakpoint on a prefix shorter than the model's minimum (1024 tokens on most) is simply not cached.

## Rollback

Switch the flag off: the request is sent exactly as before.
