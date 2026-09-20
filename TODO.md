# TODO

Known rough edges, deliberately deferred, and features wanted but not built.
Every entry here is a **decision**, with its reason — that is what separates this
file from `ISSUES.md`, which holds defects nobody chose. "Known since day one"
does not put something here; only *somebody decided* does.

When a deferred item turns out to bite someone, promote it to `ISSUES.md`. When
an issue turns out to have been a decision, move it back here with the reason.
Do not silently drop either.

**Broadened 2026-09-18.** This file is now also where **requirements for the
final product** are collected, decided or not, while solutions are prototyped on
`dev/troubleshoot`. Two consequences worth stating rather than leaving implicit:

- An entry may now be a **defect nobody chose** — the markdown entry below is
  one — which by the rule above would belong in `ISSUES.md`. The distinction
  still holds and is still useful: `ISSUES.md` is for faults with a named cause
  and a stated way to close them; this file is for what the finished product
  should do. Where an item is both, it lives here while it is a requirement and
  moves to `ISSUES.md` when somebody is assigned to fix it.
- An entry may be **undecided**, and says so in as many words. The section
  *"Memory that does not interrupt the agent doing the work"* is written as
  settled-versus-open deliberately, and the markdown entry names its own open
  questions. An entry that hides which half is which is worse than no entry,
  because it reads as a plan.

Nothing on `dev/troubleshoot` is merged. What works there is prototype evidence
for these requirements, not a change to the product.

## PRIORITY — three levels, and which one the user is talking to

**Decided 2026-09-20, and the shape everything else here should be built
against.** The panel has grown three ways to talk to an agent — the floating
chat, a harness conversation, a dispatched mission — and nothing says how they
relate, so each has been extended on its own terms. They are not three features.
They are three levels of one thing, and the level decides what carries context,
what carries authority, and who manages whom.

- **First level: the chat is the user's interface, across devices, always in
  sync.** It is where a person arrives, on a phone, a watch or the panel, and it
  is the same conversation in each. It does not hold the full context of every
  piece of work — it holds what the user needs to be told and what the user
  asked for. It can *show* what a mission or a harness conversation produced
  without carrying that work's transcript, which is the whole point: a result is
  small, the working that produced it is not.
- **Second level: the harness conversations are where work is organised.**
  Managed by the chat and by the user directly, not by whoever wandered into
  them. A harness conversation owns its own context and its own history and is
  free to be long, because it is not the thing a phone is drawing.
- **Third level: the agents running are managed by their harness conversation.**
  The chat reaches down to them only when purpose has drifted — when what is
  being done no longer matches what was asked — and that exception is the whole
  of the chat's authority over a running mission.

**Delivered in v2.44.0–v2.45.0:** the floating chat has a separate persistent
Orchestrator; work leaders own detailed chats and delegate to narrow specialists.
The Harness exposes every level, upward intervention/result reports, revisioned
plan review and progress, and archive/recall. `work_chats` and `work_plan` provide
on-demand access without copying transcripts into the main prompt. Reports wait
for the superior's next turn rather than starting paid model calls automatically.
See [the Harness guide](README.md#the-built-in-doca-harness).

The requirements below are retained as design history and further direction:

- **The chat must know what the harness conversations and missions are doing,
  without holding them.** A summary line, a result, a plan and its progress —
  addressable by id, fetched when needed, not pasted into the chat's own
  context. `GET /harness/sessions` and `GET /harness/missions` are the material;
  `work_chats` now supplies the agent-side ownership and retrieval.
- **Sync across devices is a property of the first level only.** The chat is one
  conversation wherever it is opened, so a message sent from a watch and read on
  the panel is the same row. The harness conversations are not synchronised in
  that sense — they are opened deliberately, on a screen big enough for them.
- **Authority runs downward and reporting runs upward.** The chat may dispatch
  and may interrupt; a harness conversation may dispatch and may interrupt its
  own missions; a mission reports and asks, and nothing below the first level
  asks the user anything except through the level above it (which is already
  true: `ask_device` is in `registry.NEVER`).
- **Memory remains shared in v2.45.0.** If the chat is the first-level
  interface then its durable memory is the user's memory rather than a
  conversation's, and today `memory.*` is one store shared by everything. Decide
  whether the levels share one memory (probably) and what each may write to it
  (specialists still opt in through their profile). Reports and plans are stored
  on their conversations, not automatically promoted into durable memory.

## A plan is shown, not buried: the window a plan.md opens in

**Wanted 2026-09-20, across all three clients, and the panel first.** When the
agent writes or revises a plan — a `plan.md`, a mission's plan, a proposal for
what it is about to do — it has nowhere to put it that a person reads. Today it
either pastes it into the chat, where it scrolls away, or writes a file nobody
opens.

- **The panel (and DocaDesk, which is the panel in a window):** a window that
  opens with the plan in it, rendered as markdown, while the conversation
  carries on underneath. `public/js/markdown.js` renders it already; the missing
  half is the surface and the tool that opens it.
- **The phone:** a notification that offers the choice rather than taking it —
  open the plan, or carry on in the chat and evaluate it there. The point is
  that a plan on a phone is something you *decide about*, so the decision is
  what the notification carries.
- **The watch:** never the document. The watch gets the message back, or a
  notification when the run is long and the phone has not been touched for a
  while. A plan is not a wrist artefact; the fact that one is waiting is.
- **When nobody is at a screen, say so on the devices.** A long mission that
  finishes while the clients have been idle should reach the phone and the watch
  (`tell_device` already does this, durably) *and* answer in the chat. The rule
  worth stating: the chat is always told; the devices are told when the chat is
  not being read. The hub already knows the difference — `doca_clients` carries
  `lastSeen` and `bus.isOnline` — and nothing uses it to decide.

## MCP and VMs, deliberately left out of the first pass

- **No embedded VNC console.** The VMs tab shows the display address to paste
  into your own viewer. Doing it in-page needs a websockify-style proxy plus a
  JS VNC client, which is a feature of its own rather than a detail of this one.

- **No VM creation.** Management only. A create wizard would have to mask
  `virt-install` / `VBoxManage createvm` and their disk, ISO and network
  arguments — worth doing, but not while the panel could not yet start a VM.

- **MCP HTTP transport does not hold a stream open.** `modules/mcp/client.js`
  answers the request/reply half of streamable HTTP — a POST returning JSON or a
  single SSE frame, echoing `Mcp-Session-Id` — and that path is now covered by
  `test/fixtures/mcp-http-server.js` in both framings. What is still missing is a
  long-lived event stream, so a server that pushes notifications
  (`notifications/tools/list_changed`, sampling requests) will not be heard;
  `↺ Tools` is the manual stand-in.

- **The MCP registry is still panel-only.** A client can now read, re-address and
  offer *its own* server (`GET`/`PATCH /api/v1/mcp/self`, `POST /api/v1/mcp/offer`,
  scope `mcp:self`, PROTOCOL §22), but nobody can list, create, delete or start a
  definition over `/api/v1` — including the ones a phone might reasonably want to
  see. That is deliberate, not an oversight: `POST /api/mcp` is unauthenticated to
  any tailnet peer and `mcpServers` holds a command that gets spawned, so the
  authorisation has to be designed before the surface is widened. The self-only
  routes are the shape that was safe to add, because `origin.deviceId` already
  records a human's decision about which machine owns the row.

- **A client that proxies its own servers can shadow a tool name.** DocaDesk
  presents its local servers' tools as `<serverId>__<tool>` truncated to 40
  characters (`LocalMcpRegistry.ProxiedName`, no de-duplication), and DOCA then
  prefixes `mcp__<client>__`. With Blender's official MCP server behind it, five
  name pairs collide — `get_blendfile_summary_of_linked_libraries` and its
  `_for_cli` twin share more than 40 characters, so no server id is short enough
  to separate them. DOCA's `mcp/tools.js::available()` de-duplicates the names it
  *exposes* (`…_2`), so the agent sees 26 distinct tools and no tool shadows
  another in its list — but both entries carry the same truncated upstream name,
  so `callTool` hands DocaDesk a name it resolves to whichever of the pair it
  matches first, and the twin is unreachable. The fix belongs in DocaDesk
  (dedupe in `LocalMcpRegistry.ProxiedName` the way `mcp/tools.js` does, plus a
  test), not here. Observed, not theoretical.

- **The MCP add-server form still has no `headers` field.** `registry.normalize()`
  accepts `headers`, `client.js` sends them, and a client can now set its own
  through `offer` / `PATCH /mcp/self` — but there is no way to type one in the
  dashboard, so a server the *user* adds by hand still cannot be given an
  `Authorization` header. One textarea in the http section of the form fixes it.

- **`origin` names the machine, it does not reach it.** A definition carries
  `origin: { kind, deviceId }`, the agent is told per tool which machine a call
  lands on, and the dashboard can ask a client to start its listener
  (`mcp.listener`). But nothing verifies that the URL actually belongs to that
  device, and revoking the device does not stop the server — the row just starts
  saying "(revoked)", and `mcp:self` keeps working until the token dies. Fine
  while this is a label plus a convenience; not fine if `origin` ever becomes a
  permission boundary.

- **`/api/mcp` still has no authentication.** Values are masked now, so a
  tailnet peer can no longer read a bearer token or a stdio server's env out of
  the listing — but it can still read every definition's id, label, transport,
  URL, command and args, and `POST /api/mcp` still creates a definition holding
  a command this host will later spawn. Masking bought time; it is not the
  authorisation this surface needs, and that is the same design question that
  keeps the MCP registry out of `/api/v1`.

- **A switched-off tool is not an unreachable one.** `disabledTools` filters the
  schemas the model is shown and `tools.call()` refuses a disabled name — but
  `http_fetch` takes any absolute URL with any method and a JSON body, and
  `shell` has curl. An agent that knows a client's MCP listener address can
  speak JSON-RPC to it directly, which is a documented workaround the built-in
  agent has already found and used on its own (observed 2026-09-13, reaching a
  DocaDesk-hosted Blender server whose tools were not in that turn's tool list,
  because the list is a snapshot taken before the loop starts). Nothing was
  bypassed that the user had forbidden — the switches are a context-window and
  tidiness feature, not a permission boundary, and the client's own consent
  gates still applied. But they read like a boundary in the ⚙ panel, and the
  three-gate consent story in the hub proposal assumes tool calls go through the
  tool layer. Either say plainly that the switches are advisory, or give
  `http_fetch` a host policy — and if it becomes a boundary, the same question
  applies to `shell`, which ends the argument.

- **`mcp.listener` is fire-and-forget.** The dashboard says "asked", and it means
  it: there is no reply, no ack and no timeout, so a client that refuses on
  consent grounds is indistinguishable from one that never received the event.
  Reporting back would want the prompt machinery rather than a bare event.

- **VMs are local-only, and client-hosted VMs are deferred.** `modules/vms.js`
  shells out to `virsh` and `VBoxManage` on this host, with one global
  `vms.libvirtUri` as the only remote-ish knob. There is no per-machine origin
  the way MCP servers now have one, so a VM running on a Windows client cannot
  be listed or controlled from the panel. Doing it properly means a
  `HYPERVISORS` entry whose transport is a client rather than a local binary,
  which is a larger change than the MCP case: the parsers are fed real CLI
  output, and a client would have to either ship that CLI's output format or a
  translation of it.

- **Settings proposals are panel-only too.** A pending change is drawn in the
  Harness console and nowhere else, so a proposal made while you are on your
  phone waits until you open the dashboard. The `/api/v1` prompt machinery
  (`modules/api-v1/prompts.js`) is the natural home for it.

- **A proposal is not tied to the conversation that made it.**
  `settings.propose()` accepts a `sessionId` but the tool has no way to pass one,
  so the card is not filed against the transcript it came from. Harmless with one
  conversation open, confusing with several.

## Memory, limits and context: what was deliberately left

The harness now counts tokens, names the limit that stopped it, and protects
locked and disputed memory entries. Four things around that are still open, and
none of them block anything today.

- **`contextWindow` has to be typed in by hand.** It defaults to 0, meaning
  "nobody has said", and everything percentage-based (`compactAt`, `warnAt`,
  the context line in `# Your limits`) is skipped while it is. There is no
  reliable way to discover it: `/v1/models` does not report it, and a local
  runtime's window is whatever `--ctx-size` said. A table of known windows per
  model name would cover the common cases and be wrong for the rest, which is
  why there isn't one. Setting it per harness is a one-line proposal the agent
  can make itself.

- **Nothing searches across conversations.** Each session carries a title and a
  rolling summary and nothing ever reads another session's. So a conversation
  about the Blender bridge cannot reach the one from three weeks ago that solved
  it, and the durable memory entries are the only cross-session channel. The
  narrow version is a `recall_conversations` tool over session titles and
  summaries plus a `topics` field on the session index — a tool the agent calls
  when the subject is relevant, *not* an index injected into every prompt, which
  would spend the window it is meant to protect. Do not add a second summariser
  for it: the rolling summary is already the per-topic artefact, it just is not
  indexed.

- **Keyword search will not scale to that.** `memSearch` is word overlap on
  purpose — no model call, no index to keep warm — and it is right for a few
  hundred hand-written entries. Cross-session recall over months is where it
  starts missing things. Decide embeddings-or-not deliberately when that happens
  rather than drifting into it.

- **The usage ledger has no page and no prices.** Every model call the built-in
  harness makes (steps, summaries, `agent.ask`) is now one row in
  `harness/usage/YYYY-MM.jsonl`, summed by `GET /api/harness/usage?days=&by=`
  and shown as one "24h" line in the console. Deliberately not done: a table or
  chart of the breakdown, money (prices move and differ by cache hit, so store
  tokens and apply a price list when reading), and the OpenClaw gateway and CLI
  harnesses, which bill somewhere this panel cannot see. The session's own
  `tokens` still only adds a turn that ended cleanly; the ledger is the number
  to trust.

## The shape of the request, and what a prefix cache can see

H-9 moved the clock and the running ledger after the history. Measured locally
on a six-step turn, the per-step cached share went from 15.6–17.8% to 93.5–97%
(≈95% average) — the 6–7% in the report was the same fault measured on the live
install. What matters is the shape: the cached count went from pinned at exactly
1,152 tokens to **growing every step**, which is what a stable prefix looks like.

**That was one of three, and not the largest on a real workload.** A later
measurement on large tool outputs (the H-9b section of ISSUES.md) found the
verification turn had been too easy: `ls` and `date` fit inside the 12,000-char
verbatim window, so nothing ever aged out and nothing was rewritten. Real output
does age out, and `toApiMessages()` rewrites it — which is worth more than the
clock ever was, because the break anchors at the oldest aged result, right after
the system prompt, and cuts the cacheable prefix back to roughly the system
prompt for the rest of the turn. **The priority now is H-9b, not the two items
below.** They remain open and are the same idea — stable bytes first — applied
to parts of the request neither fix reached.

- ~~**The tool schemas are serialized last, so they can never be cached.**~~
  **Measured 2026-09-17 — the premise is false, and no change was made.** The
  entry assumed a provider's cache follows the *serialized* byte order. It does
  not, at least not for DeepSeek: the schemas are already inside the cached
  prefix even though they are serialized after `messages`.

  The measurement, on the same four-step large-output turn H-9b was verified
  with, with ~14,410 bytes of schema JSON (≈3,603 tokens by the 4-bytes/token
  rule):

  | step | prompt(prev) | cached Δ | gap |
  | --- | --- | --- | --- |
  | 2 | 6,072 | 5,760 | 312 |
  | 3 | 10,796 | 10,496 | 300 |
  | 4 | 15,693 | 15,360 | 333 |
  | 5 | 20,656 | 20,352 | 304 |

  The gap is the readings block, consistently ~300 tokens. Had the schemas been
  outside the prefix the gap would be ~3,900. So the provider builds its token
  sequence as `[tools][system][messages]` — tools hoisted to the front, as most
  OpenAI-compatible implementations do — and the JSON key order in the body is
  not what the cache sees.

  Moving tools ahead of `messages` in the body would therefore have been a
  no-op. Recorded as a measurement rather than deleted, because the *shape* of
  the reasoning is the trap: the 1,152-token ceiling in H-9 matched a body
  offset exactly, which is real evidence, and it still did not generalise to
  this. **A byte offset matching a cache boundary once is not a rule about how
  caches work.** The instruction to measure before changing it was right and is
  what prevented a pointless edit.

- **The panel reports cache cumulatively, so the number that matters is
  invisible.** `budget.report()` sums `cachedTokens` and `promptTokens` across
  every step of a turn and divides once, so the console shows a running turn
  average. A cumulative figure is dragged down by step 1's unavoidable miss and
  hides the trend: it reads ~17% whether the prefix is pinned at 1,152 tokens or
  growing by thousands. Every step-level number in H-9 had to be differenced out
  of the event stream by hand to see the fault at all. The provider sends
  per-call figures and `record()` already reads them — this is a field on the
  `usage` event and a column in the console, not new plumbing. **The signature
  worth drawing is whether the cached region is growing**, because that is the
  difference between a warm cache and a broken prefix, and the percentage alone
  does not show it.

Two smaller things noticed while measuring, neither yet a decision:

- **`firstTokenTimeoutMs` and the tool count interact.** A turn that adds an MCP
  server mid-flight changes the schema list, which changes the tools block, which
  invalidates the cached prefix for that step — once per server start, not once
  per step. Probably not worth avoiding; worth knowing when reading a dip.

- **Sessions share a cached prefix.** Step 1 of a *fresh session* measured 93.5%
  because the stable head — charter, system prompt, environment, limits — is
  identical across sessions on one install. Anything that makes that head vary
  per session (a session id in the system prompt, a per-conversation timestamp)
  would cost every conversation its first step. Keep it that way deliberately.

## Compaction folds earlier turns only, and that is deliberate

Not a defect and not an open question — a decision that reads like a bug, which
is exactly why it needs writing down. Found 2026-09-18 while testing compaction
by lowering `compactTokens` and watching a turn run past it without folding.

The first attempt looked like a failure: prompts reached 20,368 tokens against a
threshold of 9,000 and nothing compacted. It was the guard working. Under token
pressure `memory.pendingFold(…, { force: true })` folds **only turns that have
already finished**, never the turn in progress:

> folding "the older half" then meant summarising the turn in progress — the code
> the agent is iterating on, clipped into 250 words — and doing it again on the
> next step, because the fold barely shrank the prompt. Under pressure, fold only
> earlier turns; when there are none, there is nothing to fold and no model call
> is made.

So in a **first** turn there is nothing to fold, however large the prompt gets,
and no `compacted` event is emitted. That is correct, and it is worth knowing
before someone reads a long single-turn session as a compaction bug — the fix
would be to "make it fold" and the result would be worse than the problem.

Confirmed working on a session with a prior turn: it fired exactly at the
threshold, and the summary kept `HALCYON` and `8443` verbatim, which is what the
summariser prompt asks for ("keep names, paths and numbers verbatim").

Related: a fold rewrites the transcript, so the step after one always shows a
cache collapse — measured at 16% on the step following, recovering to 77% and
81% after. Expected, one-off, and not a regression; see the cache section above.

## Two layers of learned knowledge, and the road between them

Decided in discussion, not yet built. Written down because it is expensive to
re-derive and the constraints are easier to honour before there is code.

**Layer 1 — tool notes, local.** What this install learned about its own tools:
that `execute_blender_code` returns `result` *and* `stdout`, that a window
capture taken right after a screen change can be a stale frame and wants a
retry. The agent proposes a note, the user accepts, and accepted notes append to
that tool's `description` in `mcp/tools.js::schemas()` — the text the model
reads at the moment it picks a function, so it costs tokens only for tools a
running server is actually offering. Proposal and click rather than a free
write, for the same reason settings work that way: a tool description is an
instruction the model follows, and an agent that could rewrite its own
descriptions could rewrite what it believes a dangerous tool does. Keyed by
server id plus upstream tool name, bounded per tool, and stamped with the
server's `serverInfo.version` so a note about a tool that has since changed
reads as stale instead of as fact.

**Layer 2 — skills, shipped.** "How to file an expense in Zucchetti" is not a
fact about this machine; it is a fact about Zucchetti, and every install
relearning it is waste. These ship with DOCA, curated, and reach the prompt as a
**manifest**: name plus a one-line trigger always resident, body loaded only when
the trigger matches — tens of tokens each instead of thousands. A cheap model
pre-reading the tool list to brief the main one is a later optimisation, not a
prerequisite; the manifest gets most of it for nothing.

**The road between them is an opt-in report, and the report is the leak.** The
agent learns TeamSystem invoicing while making a real invoice for a real client:
the transcript holds their name, their VAT number, the amount, a URL with a
tenant id, screenshots of a page full of somebody else's data. So the design
does not rest on an agent redacting its own context:

- What travels is a **typed procedure**, not prose — tool names, ordered steps,
  preconditions, failure modes, placeholders where values go. A form has nowhere
  for a client name to sit; free text has nothing else.
- It is reviewed by the **quarantined reader** (`agent.ask()`, no tools, no
  memory, no charter, no transcript) asked one question: does this name a
  person, a company or a document? That is `research_docs` run backwards —
  there, isolation keeps attacker text away from the agent; here it keeps user
  data away from the outside.
- The user sees the **exact bytes**, not a summary, with Send or Discard. A
  global "send useful data" switch enables the feature; the click sends the item.
- Reports queue in `.doca/outbox/` rather than streaming, so nothing leaves in
  the moment of the work and a batch can be read before it goes.

Private-instead-of-public fixes disclosure to the world, not disclosure to us:
customer data in our own tracker is still a processing relationship. Redact at
the source, not at the destination.

**Two constraints for the autonomous evaluator**, whenever it gets built:

- **Every shipped procedure must end by reading back what it wrote.** A stale
  selector fails loudly and costs a retry; a stale *semantic* step fails
  silently — the field moved, the right-looking box gets filled, the VAT rate is
  wrong and every step reports success. The cabinet that measured 706 × 454
  instead of 700 × 450 was caught only because the agent measured the scene
  instead of trusting the code that built it; every step had said `ok`. A
  verification step is what makes "users notice" a real detector rather than a
  hope.
- **The evaluator needs a test tenant, not a customer's.** A loop that checks
  "can I still file an expense" by filing one puts junk in somebody's books.
  Sandbox account, or navigate-and-confirm-the-fields-exist without submitting.

And the payoff worth designing for: a report carrying the **reproduction** —
typed procedure, the step that failed, observed against expected — is a bug
report another agent can replay. That is what closes the loop instead of leaving
it advisory, and it is where the debugging automation actually comes from.

## Wanted next: many agents, many jobs

The goal this is all pointed at is one agent on the server, reachable from any
paired device on the tailnet, able to work on anything anywhere. Two things are
still missing from that sentence.

- **One conversation, one turn at a time.** `POST /harness/messages` answers
  `409 turn_in_flight` for a second turn in the same conversation, which is
  right — two devices interleaving one transcript is not a feature. But it also
  means a long job from the phone blocks the desk. Several *sessions* already
  exist; nothing lets a device start one deliberately as "a job" and come back
  to it, and `jobs.js` (in-memory, capped at 200, `GET /jobs/:id` only) is not
  yet that thing.

- **No second instance.** Spawning several harness instances to run jobs in
  parallel — the Cursor/Grok-style fan-out — needs a job record with a
  lifecycle, an owner and a result, and a decision about whether instances share
  the durable memory (probably yes) and the session transcript (probably no).
  The proposal's §4.4 "missions" is the same idea under another name; settle the
  vocabulary before building either.

- **You cannot choose which specialist gets the errand, or watch one work.**
  Wanted, asked for 2026-09-18 while debugging a mission that died of a provider
  `400` (`ISSUES.md` H-10): the orchestrator picks the agent, the panel shows a
  bar, and there is no way to say "send this one to the Qwen reporter" or to sit
  and watch what a named specialist is doing. Two things, and the first is
  small: a picker in the harness composer — the roster is already in the prompt
  and `GET /api/harness/agents` already lists it — which sends the next message
  as a mission to that agent rather than to the orchestrator. The second is the
  window onto it: `GET /api/harness/missions/:id` already returns the mission
  *and* its event log, and nothing draws it, so a mission that is blocked looks
  exactly like a mission that is slow. Until both exist, diagnosing a specialist
  means reading `agents/mission-*.jsonl` by hand — which is how H-10 was found.

- **One request shape is sent to every provider, and they do not agree on one.**
  Wanted, and H-10 was the first bite: DeepSeek's thinking mode returns
  `reasoning_content` and requires it back on any request carrying tools, so a
  conversation that starts fine can end as a `400` nothing can retry. **That one
  field is handled as of 2.35.0** — captured, kept on the assistant row with the
  provider that sent it, put back for that provider and no other (`ISSUES.md`
  H-10) — which is deliberately the narrow version: the field name is a literal
  in two functions rather than data, and it answers one provider's one quirk. The
  panel still has no notion of a provider *contract* — `toApiMessages` builds one
  shape and `providers.js` knows only a base URL, a key and a model list. What is wanted is that contract as **data**:
  which extra fields to echo back, what a refusal looks like from this provider,
  whether tools travel, what the token field is called. Then: the harness reads
  it, a specialist definition may override it (a sub-agent on a different
  provider is the common case, so the fields belong in the agent definition as
  well as in settings), and a corrected contract can be pulled and applied
  without a release — the same shape as skills, and worth building as skills if
  the mechanism is going to exist twice otherwise. The cost of not having it is
  paid per provider quirk and always as a dead turn.

- **A mission has no plan, so no client can draw how far along it is.** Wanted:
  a `plan` on the mission document — `[{ title, state: done|running|queued|failed }]`
  — so a device renders one segmented bar (green done, yellow running, orange
  queued, red failed) and `done / total` is the percentage. Today the only
  progress is `steps` and `tokens`, and neither says how much is left: a mission's
  length is not known in advance and `maxSteps` is a ceiling, not an estimate.
  This is §4.4's "a mission is a plan with a memory" made literal, and it keeps
  §4.4's two rules: the plan lives **in the mission's own JSON document**, so a
  human can open it and fix it by hand and the harness re-reads rather than
  caches; and the specialist maintains it with an ordinary tool
  (`mission_plan`: set the list, tick an item) — driving a mission, not
  authorising anything, so it does not belong in `registry.NEVER`. A tool rather
  than parsing `- [x]` out of a markdown file the model writes, because a
  checklist the parser misreads is a progress bar that lies.
  Delivery follows the split already used for missions: **a plan change is
  durable** (`agent.mission` with `plan` attached), since items change a handful
  of times per mission, unlike step ticks — which stay ephemeral, and which a
  polling client never receives at all (`bus.publish` hands ephemerals only to
  live subscribers). That is the part a watch needs: DocaWear polls, so today a
  running mission reads `STEP 0` on the wrist until it finishes. Cap the list
  (~12 items, titles ~60 chars) so the event stays well inside `EVENT_BYTES`.
  Without a plan, clients fall back to the step count, as now. "Queued" only
  means something once a mission's items are declared up front: `dispatch()`
  itself has no queue, and `chainId` is stored but never set.

- **"It is on the tailnet" is a network boundary, not an authorisation one.**
  Worth writing down because it is the assumption the whole surface rests on:
  every device on the tailnet, every container with tailnet access and every
  compromised app on any of those machines reaches `:4242` equally, and the
  legacy `/api/*` routes have no auth in front of them at all. That is survivable
  for a personal setup with three devices. It stops being survivable exactly
  when the thing above gets built, because more devices managing more
  connections is more ways in — and the definitions they would be managing hold
  commands this host spawns.

- **The orchestrator should drive the work, not do it.** Wanted, and the
  evidence is a real session (2026-09-16, rendering a watch in Blender through
  the portal MCP): ten steps, all in the orchestrator's own conversation, each
  re-sending ~40k tokens of prompt — system prompt plus 53 tool schemas, 31 of
  them Blender's — for ~370k tokens in one turn, and the orchestrator busy (so
  the user blocked) the whole time. Observed again 2026-09-17, more sharply: the
  user **asked for an agent to be deployed** and the orchestrator did the work
  itself in the first person, across 28 steps. That is the failure this entry is
  about, stated plainly — not that dispatch was slow, but that the request
  "deploy an agent" did not register *as* a dispatch, so nothing was delegated
  and the orchestrator's own conversation paid for all of it. The dispatch rule
  named below as "a sentence of thinking" is what has to become decidable.

  The shape wanted: the orchestrator is the
  user's interface. It holds the synthesised context (summary, memory), the
  roster of specialists, the running missions and a *catalogue* of what tools
  exist, not their schemas; it reads the request, dispatches, and reports.
  Heavy schemas such as an MCP server's belong on the allowlist of the specialist
  that uses them, so only the mission that needs Blender pays for Blender.
  Decisions to make first: when the orchestrator still does a thing itself (the
  `agent_dispatch` description says "a sentence of thinking"; that needs a rule
  it can apply); whether specialists stay off by default; a mission finishing
  must **wake** the orchestrator instead of waiting for the user's next message;
  a concurrency cap and a cancel (both still missing); and results come back
  synthesised, not raw. Unchanged: depth one, the charter, and questions to the
  user (`ask_device`) keep one owner. Pin it with a test the way the specialist
  prompt is pinned: the orchestrator's per-step prompt stays small (target
  under ~8k) however many MCP servers are connected.

- **A shared core context, owned and editable by the orchestrator.** A
  specialist must not be given *only* its errand, or the first thing it gets
  wrong is something the orchestrator already knew and forgot to pass on: which
  machine it is on, which machine its tools act on, what the project is, what
  has already been ruled out. Today `dispatch()` passes a definition and an
  errand, and every definition re-states its own standing facts — which means
  the same context is either duplicated per definition or silently missing from
  the one that forgot.

  Wanted: one block of common context that the **orchestrator maintains** and
  every specialist receives, so "the thing every agent must know" has one
  author, one place and one edit. Editable by the orchestrator because it is the
  one holding the synthesized picture — it is the component that learns the
  project, the constraints and the dead ends as the conversation goes. Kept
  **small and tightly worded**: it is prepended to every mission, so it is paid
  per mission, and a core context that grows into a second system prompt defeats
  the reason specialists are worth having.

  Two constraints, both learned the hard way elsewhere in this file:

  - **It is not optional and not per-definition.** A definition may add to it,
    never replace it. The floor is what stops a specialist misfiring — the
    `placeBlock`/`environmentBrief` split exists precisely because an agent that
    does not know which machine its tools land on will confidently act on the
    wrong one. A definition that could drop the floor would reintroduce the bug
    the floor is for.
  - **It must be byte-stable between steps of a mission,** for the same reason
    the clock had to move (ISSUES.md H-9). It sits at the very front of a
    specialist's prompt, which is the most expensive place to put a byte that
    changes: everything after it is re-billed uncached on every step. Editing it
    is expected and fine — *changing it mid-mission* is what breaks the prefix,
    so an edit should land between missions, or the specialist should be told
    its prompt changed rather than quietly re-read one that did.

  Related and separate: the skills manifest (see *Two layers of learned
  knowledge*) belongs in this same block — name plus a one-line trigger for each
  skill, always resident, body pulled only when the trigger matches. Same
  discipline, same reason: tens of tokens each, and byte-stable, or it costs
  more than it saves. The manifest must at minimum name skill creation itself,
  so an agent that has just solved something new for the first time knows that
  writing it down is a thing it can do.

- **Every user authenticates, and `:4242` never answers without it.** Today
  `/api/v1` has a bearer token per device, with scopes; the dashboard itself and
  every legacy `/api/*` route have nothing, which is what makes `ISSUES.md` H-7
  (an agent applying its own proposal over HTTP) possible at all. Wanted: a login
  in front of the dashboard and all of `/api/*`, browser sessions as an httpOnly
  `SameSite=Strict` cookie, device tokens unchanged for v1. Until it exists the
  panel should bind to localhost and the tailnet interface only, not `0.0.0.0`.
  Auth comes before groups, and on migration everything that exists becomes the
  first user's, so upgrading a personal install changes nothing visible.

- **Several users, in groups, with rights, on one server.** Wanted after auth.
  A user belongs to any number of groups; a context (conversations, memory,
  missions) belongs to a user *or* to a group, so people can work alone, share
  one group's context, or be in several groups at once. Rights are per group
  (roughly owner / admin / member / viewer) and decide who may chat, apply a
  proposal, pair a device, or manage MCP, containers and VMs. A device is paired
  *to a user*, so what it can do is that user's rights intersected with the
  device's scopes. Memory splits three ways: the user's, the group's, and facts
  about the machine that every group shares. The agent is told who is asking and
  in which group (`clientBlock` already knows the device), and it must be
  **unable** to read another group's memory or transcripts, which means
  enforcing it in the store paths, not asking it to in the prompt. Every action
  that changes something is logged with the user who caused it. The user's own
  `statens` project already has this structure (users, groups, rights on one
  server): read how it does it before designing this one.

## Falling back when a model stops answering

**Built 2026-09-18, on `main`.** Every rule below was implemented as written —
the wording is kept because it is the reason each one is the way it is, not a
record of intent. What is here is `fallbackChain` and `failoverAfterMs` in
`Harness settings → ⚙` on the harness row, `agent.rungsFor()` / `complete()` for
the chain itself, and the `failover` event on every surface (chat row, floating
panel, `warn` log line, and `fallbacks` on the durable `agent.turn` outcome, so a
device that slept through the turn still learns which model answered).

**Configured like a provider, since 2.30.0.** The chain was a textarea reading
`provider/model`, one per line — fine for whoever wrote the parser, wrong for
everyone else: the provider had to exist already in Settings → API Keys, and a
typo silently dropped the rung rather than saying so. It is now the same two
pickers the primary model uses, repeated by "+ Add another fallback" up to five,
with the stored shape unchanged at `[{provider, model}]` so nothing about the
chain's runtime behaviour moved.

**And a rung now says whether it can call tools.** A fallback that answers in
prose is not a fallback for an agent — the turn does not fail loudly, it produces
a message that talks about running a command instead of running it, which is
worse than no fallback. `/models` cannot answer this (`providers.js` says so
explicitly), so `modules/harness/toolcheck.js` asks the model: one trivial tool,
offered first and then required, because a model that chats about a tool instead
of calling it has not proved it cannot. Only two prose answers, or the provider
refusing the *offer* of `tools`, is a "no". Everything else — a rejected key, a
dead address, a provider that goes quiet — is `null` with the reason, and is
never reported as a verdict about a model that was never reached. Each probe is a
real call and is counted in the usage ledger under `kind: 'probe'`, so a settings
box that spends money is visible where the money is counted.

The second attempt is not the same question as the first, and reading it as one
was wrong for a whole release (fixed 2026-09-20, `ISSUES.md` H-10). A provider
can refuse to be *told* to call a tool while calling it happily when one is
offered — DeepSeek's thinking mode answers `Thinking mode does not support this
tool_choice` — so a refusal there is not the model declining the call, and the
verdict is `null` carrying both facts rather than a "no". The distinction is the
one the whole file turns on: what the provider says about the model, versus what
it says about the request we built.

**Still open, and not needed for the chain to work:** the chain is per registry
entry, so a local Ollama rung is a rung like any other, but nothing on screen yet
*suggests* local-first when a hosted model goes quiet — the settings hint says it,
the panel does not. The tool verdict is also per rung and shown under it; it is
not consulted by the engine, so a chain whose only rung cannot call tools still
falls to it and still says so.

**Wanted, not broken.** The defect behind this is H-5 in `ISSUES.md` and it is
fixed: a turn that gets no first token now stops at a named deadline and says so.
This entry is about what should happen *instead* of stopping.

The case that prompted it, 2026-09-14: `deepseek-flash` returned
`200 text/event-stream` and sent `: keep-alive` for three minutes without a
single token, deterministically, on a key with $19.68 of balance — while
`deepseek-v4-pro`, same provider, same key, answered normally. So the unit that
failed was the **model**, not the provider, and the chain has to reflect that:
next model on the same provider first, next provider second.

Shape, as built:

- **An ordered chain of (provider, model) pairs in settings, empty by default.**
  Empty means inert, so the feature ships without a flag and upgrading changes
  nobody's behaviour until they order one.

- **Local models belong at the end of the chain, not off it.** An Ollama or
  llama.cpp instance on this machine has no balance, no vendor and no outage.
  Being able to keep working slowly when the API is down is the whole local-first
  argument, and it is the one rung that cannot fail for the reasons the others do.

- **Two deadlines, not one.** `firstTokenTimeoutMs` (90 s) is when the panel gives
  up entirely. A shorter `failoverAfterMs` (~20 s) is when it moves to the next
  entry. Reusing the single 90 s deadline per rung makes a three-rung chain
  slower than having no chain at all, which is the trap worth naming here.

- **Fall back only before the first token of a step.** Once tokens have arrived,
  switching mid-stream means a half-written answer stitched to a different
  tokenizer's output. Past that point, fail honestly and let the user retry.

- **One pass down the chain, then stop and report.** Never loop, never restart the
  chain, never retry a rung that already stalled within the same turn.

- **A `400` about our own message shape should not end the turn.** Added
  2026-09-18, after `ISSUES.md` H-10 killed a mission. "Only a stall hops" is
  right for a refusal, a rate limit or an authentication failure — those are
  answers about this request, and moving on hides them. It is wrong for a
  request the provider says it cannot parse: every rung would receive the same
  malformed body, so failing without trying anything is neither honest nor
  useful. Wanted: repair once on the same rung where the body names the problem,
  then treat the rung as dead and hop. Decide it together with the provider
  contract above, because the repair is only possible if something knows what
  the provider wanted.

  **Still open, and less urgent since 2.35.0.** The `400` it was written for is
  the one H-10's fix prevents — the panel now sends the field the provider asks
  for, so the body it would repair is no longer built. Two things keep it open
  rather than dropped: a live check did **not** reproduce that `400` at all
  (`ISSUES.md` H-10, *Fixed*), so the rule would be written for a fault whose
  shape is still not pinned down; and a repair path that guesses wrong turns a
  loud failure into a quiet one, which is the worse of the two. Build it with the
  contract, not before it.

- **Remember a stalled entry as degraded for a few minutes**, so the next turn does
  not pay the same 20 s again — but re-probe rather than blacklisting. A model
  that came back has to become usable again without a restart.

And the constraint that decides whether this is worth having at all, which is the
lesson of the evening it came from rather than a style note:

> **A fallback that happens quietly is a worse bug than the outage it hides.**
> Every hop is announced in the chat and logged at `warn`, naming what stalled,
> for how long, and what is answering instead. `environment.block()` already tells
> the agent which model it is on, so it can say so itself when asked. If the user
> cannot tell from the screen that they are on the second choice, the feature is
> not finished — they will read a smaller model's answers as the big one's, and
> the next investigation starts from a false premise.

Nothing in this caps steps, tokens or tool use; it changes which endpoint answers,
never what the agent is allowed to do.

## Version and identity, across the four repos

- **`/api/update-check` cannot see a private repository.** — *Resolved
  2026-09-17: `Zalban95/DOCA` is **public**. The condition this entry is
  premised on does not hold, so it is not a live defect.* Verified against the
  live API exactly as this entry asks, with no credentials:
  `GET api.github.com/repos/Zalban95/DOCA/tags?per_page=100` → **HTTP 200**, 46
  tags, `v2.27.2` first. `fetchLatestTagFromApi()` (`modules/update.js:63`) also
  sits behind `fetchLatestTagFromGit()` (`update.js:92`), so the git path is
  tried first anyway. **The uncertainty is gone; the reasoning below is kept
  because it becomes true again the moment the repo is made private, and the
  `packed-refs` trap is independent of visibility.** The recommendation stands
  on its own merits: the check should say "cannot check" rather than "up to
  date" when it cannot look — `/api/update-check` already has the three-state
  honesty this needs elsewhere.

  <details><summary>Original entry</summary>

  Tagging is not the problem it first looked like: every release from v2.4.0 to
  v2.12.0 is tagged locally, and only the pre-v2.4 ones live in
  `.git/packed-refs` — reading that file alone says "tags stopped at v2.3.5",
  which is a trap worth knowing about, since `git tag -l` and `.git/refs/tags/`
  are the honest answers. What is real is that `fetchLatestTag()` calls
  `api.github.com` with no credentials, so if `Zalban95/DOCA` is private it gets
  a 404 or 403, resolves null, and the panel reports "no update available"
  forever without ever saying it could not look. Verify against the live API
  before trusting the banner; if the repo is private, either the check needs a
  token or it should say "cannot check" rather than "up to date". The ordering
  fix it now carries (highest semver out of a page, instead of whatever
  `/tags?per_page=1` happened to return first) is still right, but it was a
  latent bug, not an active one.

  </details>

- **Tags are not all the same kind.** v2.11.2 and earlier are annotated; v2.12.0
  is lightweight — its ref points straight at the commit. Both push and both
  compare the same, but `git describe` and GitHub's release list treat them
  differently, so pick one and keep to it: `git tag -a vX.Y.Z -m "…"`.

- **The clients do not version themselves.** PROTOCOL §2 requires
  `X-Doca-Client: <name>/<version>` on every request and says it is logged with
  the device — but DocaMobile is still `versionCode = 1, versionName = "1.0"`
  and `DocaDesk/Directory.Build.props` declares no `<Version>` at all. So the
  field is there, logged, and carries no information: three clients under test
  and no way to tell which build a phone is running. Both are one line.

- **`D:\doca\` holds an `openclaw-dashboard` 2.1.0 from March** — the
  monolithic ancestor of this repo, same package name, own `server.js`. Two
  packages with one name in one tree is a trap for a human and worse for an
  agent pointed at the folder. Archive it.

- **The panel reports the version it booted with, and updates by branch, not by
  tag.** — *Added 2026-09-21, working out why a panel showed `v2.46.5` after
  `v2.46.6` had been tagged and pushed.* The tagging was correct; three separate
  mechanisms can make it look otherwise, and each can mislead the next person the
  same way:

  - `LOCAL_VERSION` (`modules/update.js:9`) is `package.json` read **once, at
    module load**, and the header's number is that value by way of
    `GET /api/update-check` → `current` (`public/index.html:1474`). A running
    process keeps reporting the version it started with, so a bump — or a
    `git pull` done outside the panel — appears only after a restart, or after a
    page reload if the tab predates it. The check's own answer is cached for
    `CACHE_TTL_MS = 5 * 60 * 1000`; `?force=1`, which the ↺ Check button sends,
    skips the cache.
  - `handleUpdate` runs a bare `git pull` — no refspec, no tag checkout. It
    follows the current branch's upstream, so a branch with no upstream fails
    outright ("There is no tracking information for the current branch") and a
    checkout sitting on `main` pulls whatever `main` tracks, whatever the newest
    tag is. Tags play no part in updating.
  - The `api.github.com/repos/…/tags?per_page=100` fallback is near its ceiling:
    origin carried **82** tags on 2026-09-21, against the 46 recorded in the entry
    above on 2026-09-17. Past 100 the fallback sees one page, and nothing
    guarantees the newest tag sorts onto it. `git ls-remote` is tried first and
    works from this install, so it is latent rather than live.

  Recorded, not changed: nothing misbehaves today, and deciding what "update"
  should mean for a checkout that is not sitting on the release branch is a
  product question, not a patch to slip into a tagging commit.

## Settings consistency

- **Status lines clear on four different schedules.** `3000ms` is the de facto
  convention (`public/js/snapshots.js:122`, `files.js:497`, `models.js:76`),
  but `setup.js:52` uses `4000`, `llamacpp.js:264` uses `5000`, and most panels
  never clear at all. Pick one rule — probably "success fades, errors stay" —
  and put it behind an option on `setStatus()` instead of a `setTimeout` per
  call site.

- **"Restart to apply" is worded differently everywhere it appears.**
  `keys.js:49` says "restart OpenClaw", `paths.js:77` says "restart DOCA",
  `settings.js:403` says "Restart the server". The first one means the external
  stack and the other two mean this process, which is a real distinction worth
  making with consistent words rather than three phrasings.

- **Shell scripts are editable in two places:** the Setup panel (which lists all
  four, creates missing ones, and can run them) and the Config tab's file list.
  This is tolerable because the Config tab is a generic editor that can open any
  path via favourites, but note that `setup-phase2.sh` appears in the Setup panel
  and in `ALLOWED_SCRIPTS` while being absent from `CONFIG_REGISTRY`. Either
  decide the Config tab does not list scripts, or list all of them.

## Errors that surface as the wrong thing

- **`modules/files.js:79`** `statSync` on a custom config favourite whose file
  was moved or deleted throws ENOENT, which the handler turns into a 500. The
  user sees a server error for what is really "that file is gone" — the same
  class of problem that produced the `keys.js` ENOENT bug.

- **Device rotate/revoke (`public/js/devices.js`) and skill toggles report
  failures through `appAlert()` only.** Not silent, but a modal for a failed
  toggle is heavier than the inline status line those cards already have.

## Settings that exist only as environment variables

These are documented in the README but have no UI, unlike the eight paths in
Settings → System:

| Variable | Why it is still env-only |
| --- | --- |
| `PORT` | Changing it from the page would drop the page. Needs a "restart on :NNNN" flow, not a text box. |
| `DOCA_DATA_DIR`, `DOCA_PREFS_FILE` | Moving these relocates the prefs file the UI writes to, so a bad value locks you out. Wants a migrate-and-verify step. |
| `DOCA_LEGACY_TRUST` | Security-relevant; deliberately not a checkbox. |
| `OPENCLAW_GATEWAY_URL` | Reasonable candidate for the Paths card treatment. |
| `DOCA_FONT` | Cosmetic; belongs with the theme controls if it is ever surfaced. |

`DOCA_STT_URL` / `DOCA_TTS_URL` are the inverse case: they override the Voice
card rather than defaulting it, which the card now states.

## Memory that does not interrupt the agent doing the work

Written 2026-09-18, after measuring what a memory write actually costs. Two
separate problems had been discussed as one, and they have different fixes — so
this section is deliberately split into what is **settled** and what is **not**,
because the settled half is small and independently useful and should not wait
on the rest.

### The two problems

**Cache.** `memoryBlock()` sits at position 7 of the 13 blocks in the system
prompt, and is rebuilt on every step. So a `memory_write` mid-turn changes the
head of the prompt and the next step misses essentially everything: measured at
**23% cached on step 6 of a six-step turn**, against 93–95% either side of it.
The write is cheap; the step after it is not. See `ISSUES.md` H-9b, where this
is recorded among the writers of the same shape.

**Flow.** The orchestrator spends its own steps on bookkeeping. In the 28-step
run of 2026-09-17, step 5 was a `memory_flag` plus a `memory_write` and step 27
was two writes plus a `memory_rules_write` — four steps of the user's turn spent
filing, and the orchestrator busy throughout.

They are not the same fault and a memory agent does not fix both.

### Settled — decided, not yet built

**1. Memory is snapshotted at the start of a turn and does not move during it.**

Decided, because it is the cache fix and it is independent of everything below.
Take the memory block once when the turn begins and rebuild every step from that
snapshot. Writes during the turn land in the store but do not reach the prompt
until the next turn starts.

The consequence to accept: within a turn the agent cannot see a fact it just
wrote. That is the correct trade — it wrote the fact, so it does not need it
read back — and it converts "every write costs the next step" into "at most one
prompt change per turn, at the boundary where a change is expected" (the new
user message changes the prefix anyway). Expected effect: a memory write stops
being a 23% step.

This is the half to build first, and the half with a number attached.

**2. Memory work leaves the orchestrator's turn.**

Decided. A dedicated agent does it, out of band. This is not a new kind of
thing: `archivist` is already the memory specialist, already runs in its own
session, and is already `memory: false` / `environment: minimal` so it does not
drag the orchestrator's context. It needs a **write** tool — today it has only
`memory_search` — not a new architecture.

Run as a mission, so `dispatch()` returns immediately and the orchestrator
carries on. The orchestrator's step cost for memory becomes one dispatch.

**3. Candidates are queued, not written.**

Decided. A new `memory_note` tool appends a candidate to a queue instead of
writing an entry. `memory_write` stays exactly as it is, for when the user says
"remember this" and it must land now.

The point is that the queue is **not in the prompt**, so calling `memory_note`
costs no cache at all — where `memory_write` mid-turn costs a step's prefilled
prefix. A memory agent drains the queue between turns.

This is the same reasoning already written down in *"Nothing searches across
conversations"* above: a thing the agent calls when relevant, not an index
injected into every prompt, which would spend the window it is meant to protect.
It also matches the outbox idea in *"Two layers of learned knowledge"* — queue
first, read it before it goes, rather than acting in the moment of the work.

### Not settled — needs a decision before it is built

**Who tags a candidate as worth keeping?** The settled design says the writing
agent calls `memory_note`. That makes the writer the judge of its own output,
which is cheap and nearly free but is the wrong shape for anything subtle — and
it is the same agent whose context is the thing being protected, so asking it to
also be the filter is asking twice. The alternatives (a second model call per
output, or a heuristic) each cost something real. `.doca/outbox/` style suggests
the answer is "the writer marks, the reader judges", but that is a guess and has
not been decided.

**Does the memory agent write, or propose?** Everywhere else in this panel the
agent proposes and the user clicks — `settings_propose`, `install_propose`, and
the whole reason H-7 matters. Memory has no equivalent: `memory_write` writes
directly today, so a memory agent writing directly would not be a new power, but
it would be a larger one, because it would be consolidating on its own judgement
rather than carrying out an instruction the user watched. `locked` and `disputed`
protect individual entries and `source` records who wrote one; what does not
exist is a review step. Undecided, and it decides how much the queue needs to
carry.

**How does the memory agent decide "this is new" without the window it is
protecting?** Dedupe and contradiction need to see existing memory. Full entries
for a few hundred is fine; the failure mode is the agent's own context becoming
large enough to need the same treatment. The bounded version is a key-and-category
listing rather than full text, with `memory_search` for the detail — plausible,
not decided.

**Does a memory agent get its own provider or model?** `archivist` definition
already allows `provider` and `model` per definition. Filing is a cheap,
mechanical job and a large model would be wasted on it — but a small model
misjudging what matters is worse than no memory agent. Undecided.

### What is deliberately not in this section

Not a second summariser. The rolling session summary already exists and is
already the per-topic artefact; this is about durable entries, which are a
different thing and should stay one.

## The agent writes markdown and the panel shows the asterisks

**Built 2026-09-18, on `main`.** Hand-written, no dependency — the subset below
is `public/js/markdown.js`, loaded before `utils.js` and reached through the two
places the agent's prose already goes (`_hcAppend` in the console, `chatAppendMsg`
in the floating panel), so history reload inherits it with no further work. The
three constraints are settled as written rather than discovered:

- **It streams by committing whole blocks.** `mdSplitBlocks` cuts the text so far
  into finished blocks and the one still being written; finished blocks are
  appended once and never touched again, and only that trailing block is
  redrawn per chunk. No flicker, no O(n²), and the live-typing feel survives.
  A test asserts five blocks cost five insertions, not one per character.
- **Emphasis matches only when its closing delimiter is in the same block**, so
  a half-written `**bold` shows as the characters actually sent and turns bold
  once rather than flickering between guesses.
- **Nothing is built from an HTML string.** Every node is `createElement`, every
  character run `textContent` — the strict form of the `escHtml` discipline
  above. A test asserts the word `innerHTML` does not appear in the file, and
  another feeds it a page of hostile markup and checks the set of tags it
  created.

Two consequences, both deliberate and both recorded here because they are
security decisions rather than rendering ones: **`![alt](url)` is never an
image** — a markdown image makes the browser fetch an address the model wrote,
which is the prompt-injection channel `show_image` exists to avoid — and links
are scheme-gated to `http`/`https`/`mailto`, so `javascript:` and `data:` come
out as the literal text they are.

**Still open, and not needed for it to work:** tool results are still shown raw.
They are the other half of what fills the console and are often structured (JSON,
tables, diffs) where markdown would help more than it does in prose — and they
may want syntax highlighting rather than markdown. Separate call, unchanged.

**Rejected, kept visible:** asking the agent not to use markdown, and reaching
for a library. The first is the cheaper answer and the wrong one — markdown is
how these models communicate structure, and suppressing it would cost
readability in the transcript, which is the artefact that outlives the chat. The
second would have been a sixth dependency in a list that has stayed at five,
none of them UI, for a subset that is a few hundred lines of parser.

**What it was reported as, 2026-09-18.** Every surface where the agent's own
words appear rendered them as **plain text**, so a reply arrived looking like
this:

```
Done. Where things stand:

**Three specialists, three independent answers** — all finished, all read:
- archivist `msn_c470516a36fb` — 2 steps — HALCYON memory search
- scribe `msn_f889eb6c55dc` — 5 steps — wrote `host-note.txt` (99 bytes)
```

The model is doing the right thing — that is markdown, and it is what it was
trained to write. Nothing renders it. There is **no markdown renderer anywhere
in the panel**: a grep for `marked`, `markdown`, `renderMarkdown` or `mdToHtml`
across `public/js/` finds only the words in unrelated comments.

### Where it bites

Both surfaces that show agent prose, and they share the pipeline:

- `public/js/harness.js` — the Harness console, `evt.type === 'text'` → `stream.feed(evt.text)`
- `public/js/chat.js` — the chat panel, the same two lines

Both feed the same streaming helper (`public/js/utils.js`, the `feed(chunk)`
accumulator), which is where the output is written to the DOM. It already does
**one** piece of structured handling — `<think>` blocks are detected and held
back — so the shape of the fix is not new; markdown is simply a case that was
never added.

### What "done" means

- A fenced code block shows as a code block, not as backticks and a language
  tag; headings, bold, italics, inline code and lists render as themselves.
- Tables render as tables — the agent emits them for anything comparative, and
  they are unreadable as pipe-delimited text.
- Links render, and are safe to click.
- The **raw** text is still what is stored, copied and sent to the model. This
  is a display concern only; nothing about the transcript changes.

### The constraints that make it a real piece of work

- **It streams.** Text arrives in deltas, so a renderer has to cope with a
  half-written `**bold` or an unterminated fence without flashing the wrong
  thing and then correcting itself. Rendering the finished message only at the
  end is easier and loses the live-typing feel that exists today; a
  re-render-per-chunk approach is easy and flickers. Whoever does this should
  pick deliberately rather than discover the choice.
- **The model's output is not trusted markup.** It is text a model wrote, in a
  page that has the user's session. Whatever renders it must escape first and
  then introduce only the tags it means to — the existing `escHtml()` discipline
  is the reason nothing has gone wrong so far, and markdown is exactly the kind
  of feature that quietly removes it.
- **`<think>` already occupies the same pipeline.** Whatever is built has to
  compose with that rather than fight it for the same buffer.

### Not decided

- **Whether tool results get the same treatment.** They are the other half of
  what fills the console, and they are often structured (JSON, tables, diffs)
  where markdown would help more than it does in prose. Separate call, and it
  may want syntax highlighting rather than markdown.

The other two — which renderer, and whether to ask the agent to stop writing
markdown — were decided rather than deferred, and the decision is at the top of
this entry.

---

## A picture shown during a voice call

Found on 2026-09-20 while fixing `ISSUES.md` H-15, and deliberately not fixed
there: H-15 is about a picture splitting a *transcript* into two summary lines,
which is a different question from what a voice call should do with one.

`chatSend` handles `evt.type === 'image'` (`public/js/chat.js:539`), so a picture
arrives normally when the user is typing. The streaming loop inside
`_callProcessAudio` (`:745-875`) chains `thinking`, `text`, `tool_call` and
`tool_result` and has no `image` branch, so during a call the event is dropped
and the picture appears only when the history is next loaded — after the call,
which is the one moment the user is not looking at the screen.

What is undecided is not how to draw it but what a call should *say* about it: a
picture is the one tool result that cannot be read aloud, so the honest options
differ — announce it and let the user look afterwards, try to describe it, or
hold it until the call ends. That is a product decision, which is why this is
here rather than in the fix.
