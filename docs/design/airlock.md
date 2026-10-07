# The airlock — full reach, but outside text never reaches the agents that act

**Built in 2.104.0 (guards), 2.105.0 (Guards section), 2.106.0 (the airlock).**

Decided with Al, 2026-09-27. The agents keep every tool and act without a person
in the loop; what is controlled is **what they read**.

1. **Only airlock agents read the web** — the scout and the researcher. Every
   other agent (the Orchestrator, work chats, the coder) keeps shell, network,
   MCP and the rest, but not `http_fetch` / `research_docs`: to read a page it
   sends the scout. (`AIRLOCK_ONLY` in `modules/agents/registry.js`.)
2. **The scout writes only its report** — facts, sources, instructions found in
   the content, what failed. A fully hijacked scout can only write a bad report.
3. **Guards screen both directions** — every page or file chunk the scout reads
   (*in*), and its report before the Orchestrator reads it (*out*). Several
   guards run at once; a piece is **clean only if every guard says so**:
   *blocked* (withheld, replaced by a note, logged) when any guard reaches its
   `blockAt`, *suspicious* (passed on with a label) when any reaches its
   `suspectAt`. A guard that fails to answer counts as suspicious. Nobody is
   asked: blocked text goes to `harness/guard-log.jsonl`.
4. **The "ask again after outside text" rule (2.103.0) is the safety net** for
   raw outside text that reaches an acting agent another way (an MCP tool).

## Guards (`modules/harness/guard/`)

| Kind | What | Cost |
|---|---|---|
| `rules` | patterns (`rules.js`) — always there | microseconds, no download |
| `model` | a Hugging Face ONNX classifier, run by transformers.js in its own process (`runtime.js`, `worker.mjs`) | runtime ~740 MB once, into the data folder; model 72–713 MB; ~10–25 ms a chunk on CPU |
| `endpoint` | a configured provider's model, asked for a probability | one model call a chunk |

Managed in Harness settings → Guards: install the runtime, add a preset or a
custom one, download, switch on, set thresholds, test on text, read the log.

## Measured on this machine (2026-09-27, `npm run guard-eval`)

12 clean texts (API docs, errors, a changelog, a privacy policy, an article
*about* prompt injection…) and 10 injected ones (direct, hidden, social,
"system override", memory poisoning, exfiltration).

| Guard | Caught | Blocked | False alarms |
|---|---|---|---|
| rules | 70% | 60% | 8% |
| Prompt Guard 2 22M (q8) | 40% | 20% | 8% |
| ProtectAI DeBERTa v2 (suspect 0.98, block 0.99) | 100% | 100% | 8% |
| **All three (the airlock)** | **100%** | **100%** | **8%** |

The one false alarm is the article that explains prompt injection by quoting
one — every guard blocks it, and that is the right side to err on. ProtectAI's
other false alarms scored 0.74 ("Rate limit exceeded") and 0.97 (a privacy
policy); every injection scored ≥ 0.991, which is where its preset thresholds
come from. The set is small; grow `test/fixtures/guard/` whenever a real page is
misjudged, and re-run `npm run guard-eval`.

## With specialists off (2.290.0, TODO A2)

There is no scout to send, so the agents that work hold `http_fetch` themselves. S6 still holds: a page on the open
web reaches them as the report of the toolless reader `research_docs` uses (`research.js`) — asked what the agent said
it needs (`want`), screened by the guards when there are any — never as the page. The owner's own addresses (this
machine, the LAN, the tailnet) are read as they are, framed as outside words like every tool result; a HEAD and a
`save_as` download read no page. An airlock specialist still reads the page itself, behind the guards.

## Limits

- A classifier misses things; the design does not rest on it — a missed
  injection lands in a scout that can only write a report.
- A report can still carry a wrong *fact*: a quality risk, not a takeover. The
  report's sources let the Orchestrator check.
- MCP browser tools cannot be classified generically; their results are
  labelled and the "ask again" net applies.
