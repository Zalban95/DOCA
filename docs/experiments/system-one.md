# Experiment: a System 1 decision model

**Flag:** `experiments.systemOne` (Settings → Developer), off by default. The model is set up in Field → Models →
Decision models. **TODO:** H10.19. **Since:** 2.315.0. **Code:** `modules/system-one/` (the client, Laya's service,
the decisions, `computer_next`), hooks in `turn/triage.js` and `turn/front.js`.

Asked 2026-10-08: "I think LAYA would be way better for navigating and using the VMs, computers, vnc connections and so
on" — and consider Jev, its closed counterpart.

## What Laya and Jev are (from their cards, read 2026-10-08)

**Laya** (ConvAI Innovations, `huggingface.co/convaiinnovations/laya`, Apache 2.0; runtime `pip install laya`, 0.4.0
here). A non-autoregressive "System 1" decision model: a **state** (text or JSON) and **typed questions** in —
`choice` (options as `{key: description}` or a list), `score` (ordinal levels), `noul` (a yes/no probability) — and
calibrated probabilities out, every question in one forward pass, no text generated. One repository holds three
checkpoints: `english` (ModernBERT-large + a 2-layer decision head, 421M, 512 tokens of which 192 are the options'),
`multilingual` (mmBERT-base, 322M, 1,024 tokens, up to 8k) and `typed-decisions` (fine-tuned on that benchmark). Each
option is scored at its own `[MASK]` marker, so the answer space is given per request. Trained with RL against proper
scoring rules (RLCD). Its card is candid about the limits that matter here:

- the base checkpoints are **near chance zero-shot** on the typed-decisions benchmark (0.362 against a 0.461
  majority-class baseline); the 0.766 headline belongs to the checkpoint fine-tuned on that benchmark — "a fast base to
  specialise, not a zero-shot decision engine";
- options share ~190 tokens: many options get a few tokens each and blur (Banking77: 0.425 against Jev's 0.870);
- a `noul` question can follow its own labels rather than the text — ask a two-option `choice` instead;
- it ships over-confident; `answer_confidence` (the top choice's probability) is what its temperature scaling calibrates.

The package ships **`laya-serve`**: an HTTP server on TypeSafe's own `POST /v1/systemone` wire, so a Jev client works
against it unchanged. It binds every interface with no authentication by default (`LAYA_HOST`, `LAYA_API_KEY` change
that). Vision is not its job: it reads text.

**Jev** (TypeSafe AI, early access since 2026-09-15): the closed original. `POST https://api.typesafe.ai/v1/systemone`
with `Authorization: Bearer <key>` (keys at console.typesafe.ai), `model: jev-latest | jev-preview | jev-1.13.0`, the
same state and questions; $0.042 per million input tokens, 70–500 ms end to end. Its computer-use pattern is
`jev-use` (a Cua skill): the driver observes and acts, the application builds the candidate actions, Jev returns one
candidate id — the same shape as `computer_next` below. Several community MCP servers wrap it. Not measured here: no
key (early access).

## How it runs here

Field → Models → Decision models, as the other model types: **Laya** (install, start, stop, its state and the device
it computes on, the checkpoint, start with DOCA) beside **TypeSafe Jev** (the key for services it uses, and whether it
is there), the threshold, and a test box that asks the triage's and the call's questions about any request.

- **Laya is a managed Python process**, set up as the wake-word trainer is: uv makes a Python 3.11 environment under
  `systemOne.dir` (default the data folder's `system-one/`; 1–6 GB with PyTorch) and installs `laya[serve]==0.4.*` with
  `--torch-backend=auto` (the CUDA build where a driver answers, the Mac's, else CPU); `python -m laya.serve` is started
  by argv with `LAYA_HOST=127.0.0.1`, `systemOne.port` (8791), and a **bearer secret made at each start** and kept in
  memory, so another account on the machine cannot use it either. Weights (~0.8 GB for `english`) go to the Hugging Face
  cache the Models tab shows. Chosen over a container: one package, the same on Linux, Windows and macOS, and a
  container gets no GPU on a Mac. (`laya-ts`, an ONNX runtime inside Node, would avoid Python but adds a native
  dependency; not taken.)
- **Jev** is reached with a key for services (`systemOne.jevKey`, default `typesafe`), sent only to that key's own
  origin (`service-keys.apply`), from the hub — never from a computer.
- One client (`system-one/index.js decide()`) speaks the wire to either. An answer counts only when its **top
  probability** reaches `systemOne.threshold`; under it, on a timeout (3 s before a turn) or on any error, the caller
  does what it did before. None of the `systemOne` settings is proposable.

## What happens when it is on

1. **The triage** (needs `adaptiveLimits` on too): where the rules are unsure, Laya is asked
   `How big a job is this?` (small / medium / large) and the pace in the same pass, about `Someone asks their AI
   assistant: "<request>"`. Sure, it decides (`by: System 1: …` in the `triage` event and trace); unsure, assistant
   mode's quick model is asked as before, else the rules' medium stands.
2. **A call's front**: `Is this a quick request or a big job?` (now / later) about `Someone says to their voice
   assistant: "<request>"`. Sure, it decides answer-now or hand to a work chat in place of the size rule; an explicit
   "think harder" is the person's words and is never second-guessed.
3. **`computer_next {computer, goal}`** (kit computer; held only with the flag on): the computer's own
   `browser_snapshot` is read (through the MCP layer, so its holds apply), its numbered elements become options
   (`button "SETTINGS"`), and Laya answers which one serves `I want to <goal>. I am on the page "<title>".` — as a
   tournament (groups of ten in one forward pass, the best two of each in a second). The agent gets the top three with
   probabilities and whether the top one clears the threshold, framed as outside words (the labels are the page's). **It
   only proposes**: the agent acts with `browser_click` / `browser_type`, so every action still passes the tools, the
   approvals and the computer's own refusals. Only on a computer this conversation works in (`whose.ofConversation`).
   How to use the element comes from its kind (a field is typed into, the rest clicked): asked as a question of its own
   ("click, type, scroll or done") Laya was right 3 times in 33.
4. **A desktop or a VNC screen**: not Laya's — they are pixels, with no text state to read; `computer_look` (a vision
   reader) stays the tool. A desktop's accessibility tree (AT-SPI) would be a text state; the computer image does not
   expose one yet. The person's own browser (the browser extension) does have `browser_snapshot` — a later step.

## Measured

`npm run experiment -- system-one [--models provider/model,…|none] [--device cpu|cuda] [--dir …]`: labelled cases
(`bin/lib/system-one-cases.js`) — the 25 evaluation-set cases with a `difficulty`; 25 spoken requests labelled now
(13) or later (12); 33 goals on 8 pages of a throwaway panel, each labelled with the element that is the right next
step (`bin/lib/system-one-pages.json`, captured with `--capture` from the agents' computer's own snapshot script).
Each way of deciding is scored on the same cases; the time is the median per decision. Laya here: `english`, on an
RTX 5060 Ti (CUDA) and on 32 CPU threads. Wording and state were chosen on these same cases (see below), so the Laya
figures are optimistic; the rules and the models were not tuned on them.

Laya: `english` on CUDA (RTX 5060 Ti) unless marked CPU (32 threads). Models: DeepSeek4f / deepseek-flash (hosted)
and llamacpp / qwen3.8-27b IQ3_S (local, on this hub's GPUs), each one completion at temperature 0, thinking as the
provider does by default. Laya's per-threshold columns are "right / answered" for the answers at least that sure;
"combined" is the whole set when Laya decides at that threshold and today's way decides the rest.

| date | decision | way | cases | right | median time | notes |
|---|---|---|---|---|---|---|
| 2026-10-08 | triage size | rules alone (today, no quick model set) | 25 | 17/25 (68%) | 0 ms | the rules unsure on 10: medium stands |
| 2026-10-08 | triage size | rules, then Laya where unsure | 25 | 18/25 (72%) at ≥0.6 | 16 ms (CPU 173 ms) | combined ≥0.5: 18, ≥0.6: 18, ≥0.7: 17, ≥0.8: 17 |
| 2026-10-08 | triage size | Laya alone, every case | 25 | 14/25 (56%); CPU 15/25 | 16 ms | ≥0.5: 9/11, ≥0.6: 5/6, ≥0.7: 2/2, ≥0.8: 1/1 |
| 2026-10-08 | triage size | rules, then deepseek-flash where unsure (today with a quick model) | 25 | 17/25 (68%) | 2,330 ms | |
| 2026-10-08 | triage size | deepseek-flash alone | 25 | 19/25 (76%) | 1,806 ms | |
| 2026-10-08 | triage size | rules, then qwen3.8-27b where unsure | 25 | 16/25 (64%) | 7,044 ms | |
| 2026-10-08 | triage size | qwen3.8-27b alone | 25 | 17/25 (68%) | 6,629 ms | |
| 2026-10-08 | call route | rules (today: hand on when the size rules say large) | 25 | 14/25 (56%) | 0 ms | the rules miss 11 of the 12 big jobs |
| 2026-10-08 | call route | Laya where sure, else the rules | 25 | 19/25 (76%) at ≥0.6 | 12 ms (CPU 101 ms) | combined ≥0.5: 19, ≥0.6: 19 (CPU 20), ≥0.7: 16, ≥0.8: 14 |
| 2026-10-08 | call route | Laya alone | 25 | 19/25 (76%) | 12 ms | ≥0.5: 19/25, ≥0.6: 9/10, ≥0.7: 4/4, ≥0.8: 0/0 |
| 2026-10-08 | call route | deepseek-flash alone | 25 | 25/25 (100%) | 1,097 ms | |
| 2026-10-08 | call route | qwen3.8-27b alone | 25 | 24/25 (96%) | 4,903 ms | |
| 2026-10-08 | page next element | Laya, its top choice | 33 | 17/33 (52%) | 66 ms (CPU 1,292 ms) | in its top 3: 22/33; ≥0.5: 15/22, ≥0.6: 12/17, ≥0.7: 11/14, ≥0.8: 8/9, ≥0.9: 6/7 |
| 2026-10-08 | page how | from the chosen element's kind | 33 | 25/33 (76%) | 0 ms | Laya's own "click / type / scroll / done" question: 3/33 |
| 2026-10-08 | page next element | deepseek-flash, one step reading the snapshot | 33 | 32/33 (97%) | 1,023 ms | how right 31/33 |
| 2026-10-08 | page next element | qwen3.8-27b, one step reading the snapshot | 33 | 32/33 (97%) | 4,448 ms | how right 31/33 |

**How the wording was chosen** (on these cases, so the Laya rows above flatter it): the page as state — goal, title,
address and 600 characters of the page's text, as a JSON object — gave 4/33 on the page cases, Laya picking the first
option (the panel's logo link) almost every time; the goal alone as a sentence ("I want to … I am on the page …") gave
18/33. The call's question as "answer right away or a longer piece of work", with the request as a field, gave 15/25;
quoting the request as said to a voice assistant and asking "a quick request or a big job?" gave 19/25. The triage's
best wording reached 15/25. Laya's `confidence` field (normalised entropy) never reached 0.3 on a two-option question;
the threshold is on the top probability (`answer_confidence`) instead, and 0.6 is the default because it is where the
combined rows peak.

**What it says.** Laya answers 15 to 400 times sooner than a model completion (66 ms against 1 s on a page; 12 ms against 1–5 s on a sentence) and costs nothing per call, and it beats the
rules where the rules are weakest — a call's route, 56% → 76% at ≥0.6, in 12 ms where a model would add one to five
seconds before the first word. But zero-shot it is far behind a model: on the page, 52% against 97% for both an
inexpensive hosted model and the local 27B reading the same snapshot; on the triage it adds one case over the rules.
Its card says as much: the base checkpoints are a base to fine-tune. `computer_next` is therefore a weak hint today —
right about half the time, about three times in four when it says it is at least 0.7 sure — and an agent that reads the
snapshot itself does better in one step.

**Recommendation.** Keep the flag off for the agents' computers. The one place it pays as it is: a call's
answer-now-or-hand-on, where today only rules decide and latency matters — worth trying with the flag on and a week of
calls. The real gain would come from fine-tuning Laya on DOCA's own decisions (its notebook runs on two free T4s): these
83 labelled cases are the start of that set, and turns' traces (triage verdicts, which element an agent clicked after a
snapshot) would give thousands more. Jev was not measured (no key; early access) — the provider is wired, and its
published 0.727 against Laya's base 0.362 on typed-decisions suggests it would do better zero-shot.

## Cost

Laya: 1–6 GB of disk, ~1 GB of memory (GPU or RAM), a process while started. No tokens. Jev: $0.042 per million input
tokens and an outside call per decision. Off, nothing runs and nothing is asked.

## Risks

- **Wrong and sure.** Laya is over-confident out of the box; the threshold is on its top probability, and every use
  falls back to today's way under it. The triage still never lowers the step budget below `maxSteps`; a call's front
  still hands work on after two steps of real work.
- **Zero-shot.** These are the base checkpoints, not fine-tuned on DOCA's decisions; the card says fine-tuning is where
  accuracy comes from. The cases here are the start of such a set.
- **A page steering it.** The options are the page's own words; Laya cannot act, and its answer reaches the agent
  framed, but a page can still pull its choice. The agent decides.
- **A local service.** It listens on 127.0.0.1 behind a per-start secret; `laya-serve`'s own default (every interface,
  no key) is never used.

## Rollback

Switch the flag off: no decision is asked, the triage and the call decide as before, and `computer_next` leaves every
turn's tools at the next step. Stop Laya in Field → Models. Failing removes `modules/system-one/`, the
`systemOne` settings, the hooks in `triage.js`, `front.js` and `agent.js`, the tool, `decision-models.js`, and
`bin/experiments/system-one.js` with its `bin/lib/system-one-*` files.
