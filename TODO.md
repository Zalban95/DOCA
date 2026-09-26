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
  **Built in 2.85.0** (`harness/recall.js`): the fold now ends its summary with a
  `Topics:` line, stored as `topics` on the session row (same model call, no
  second summariser). `recall_conversations` (memory kit, no approval — it reads
  only DOCA's own store) searches titles, topics and summaries of every
  conversation, archived ones included, plus the words of the newest 300
  transcripts; `read` gives one conversation's summary and last messages. The
  Archivist has it beside `memory_search`. Sessions folded before 2.85.0 have no
  topics until their next fold; titles, summaries and transcripts still find them.

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

**Layer 2 built in 2.82.0** (`modules/harness/skills.js`): skills in the open
Agent Skills format (a folder with `SKILL.md`), shipped in `skills/` (android-app,
make-a-specialist) or made/imported on this machine (`<DATA_DIR>/skills/`, wins on
a name clash; `~/.claude/skills` imports as it is). The Orchestrator's and work
chats' prompts carry the manifest (name + when to use); the body is loaded with
the `skill` tool (the `skills` kit), which also lets the agent keep a procedure
it worked out. A specialist sees the skills its definition names. Settings →
Harness → Skills lists and imports them. **Layer 1 built in 2.83.0**
(`harness/tool-notes.js`): the agent proposes a note on a tool (`tool_note`),
the person accepts it on the ordinary proposal card (`toolNotes.<tool>`), and it
is added to that tool's description; a note written before the tool changed is
shown as possibly out of date (a fingerprint of the description it was written
against). Specialists cannot propose one. Not yet: the opt-in report upward below.

Decided in discussion, not yet built (except as above). Written down because it is expensive to
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

- **Extended 2026-09-25: "high demand" hops too.** A provider out of capacity
  (502/503/504/529, or a 5xx saying overloaded/busy/at capacity) is unavailable in
  the same sense as a stall and says nothing about the request, so it moves down
  the chain and marks the rung degraded. A rate limit (429, the account's quota),
  a refusal and a failed login still do not. And the chain now applies to one-off
  calls (`agent.ask` — the rules review, the documentation reader) and summaries,
  which never passed `onHop` and so never hopped; the tool-check probe still does
  not, on purpose, since it tests one rung. A reasoning model that returns nothing
  because it spent `max_tokens` thinking gets one retry with room, then an error
  that says so — the Rules button had shown an empty review. **Superseded the
  same night:** one-off calls now stream like turns and take the harness's own
  "Longest reply" (the owner's is 256k) instead of a cap of their own, so a
  reasoning model may think as long as it is doing useful work; only the
  first-token guard (silence) and a 60-minute backstop stop them.

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

**All three done** (checked 2026-09-26; the entries had gone stale): status
lines follow one rule in `setStatus()` — success fades, errors stay
(`test/status-lines.test.js`); two restart phrases, "restart DOCA" and "restart
OpenClaw", each meaning one thing; and the Config tab lists exactly the Setup
panel's four scripts (`paths.SCRIPT_CONFIG`). **Changed in 2.65.1:** saving an
API key said "restart OpenClaw to apply" to everyone, but DOCA's own harness
reads the key on every call — it now says DOCA uses it at once, and mentions
restarting OpenClaw only when OpenClaw is installed.

## Errors that surface as the wrong thing

- ~~**`modules/files.js:79`** a moved or deleted favourite answered 500.~~
  Already fixed (`files.fsStatus`: ENOENT/ENOTDIR → 404, EACCES/EPERM → 403);
  the entry was stale, checked 2026-09-26.

- ~~**Device rotate/revoke and skill toggles report failures through
  `appAlert()` only.**~~ Already done (checked 2026-09-26): both use the card's
  status line, `appAlert` only as a fallback when there is none.

## Settings that exist only as environment variables

These are documented in the README but have no UI, unlike the eight paths in
Settings → System:

| Variable | Why it is still env-only |
| --- | --- |
| `PORT` | Changing it from the page would drop the page. Needs a "restart on :NNNN" flow, not a text box. |
| `DOCA_DATA_DIR`, `DOCA_PREFS_FILE` | Moving these relocates the prefs file the UI writes to, so a bad value locks you out. Wants a migrate-and-verify step. |
| `DOCA_LEGACY_TRUST` | Security-relevant; deliberately not a checkbox. |
| `OPENCLAW_GATEWAY_URL` | **In the Paths card since 2.84.0** (a URL: checked as `http(s)://`, never on disk). |
| `DOCA_FONT` | **In the Paths card since 2.84.0** — it is a file (the .ttf for text in images the hub draws), so it sits with the paths rather than the theme. |

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

---

## Where this harness stands against the labs' agent SDKs, and what is left

**Assessed 2026-09-21 against v2.47.0; re-checked against v2.50.0 before being
written down here.** Three of the original findings were already closed by
2.46.x and the approval work in 2.49–2.50, and are recorded below as closed
rather than deleted — a comparison that only ever grows is one nobody trusts.

The short version: the orchestration, memory bookkeeping, cost honesty and
device-reach layers are at or above what Claude Code / the OpenAI Agents SDK
ship. The **execution-safety and evaluation** layers are behind. Everything in
this section is a DOCA feature, not a setting, so none of it is something the
agent can propose in the ⚙ panel.

### Closed since the assessment — do not re-file these

- **Per-command approval.** Was "gap number one" alongside the sandbox.
  `modules/harness/approval.js` (v2.49.0) gates every tool call that does
  something, remembers a decision by tool-plus-verb, and v2.50.0 puts it in a
  popup and on the watch that started the turn. The *sandbox* half is still
  open and is the first entry below.
- **The specialist prompt losing `profile`.** `agent.js`'s wire call passes
  `profile` (`systemPrompt({ p, userText: message, summary, client, profile, … })`),
  and `preview()` passes the same. Verified by reading both call sites.
- **Failover dying on a smaller rung's window.** Each fallback entry carries its
  own `contextWindow` and `windowSetting` (`rungsFor`), and `preflight` runs per
  rung, so a chain that drops to a local model with a smaller window skips that
  rung with a reason instead of taking a 400.

### 1. No execution sandbox — the largest remaining gap

`shell` runs unrestricted as the panel's own user. The only guards are a 60 s
timeout, a 64 KB output clip and the per-tool off switch; `read_file` /
`write_file` / `list_dir` enforce `FM_ALLOWED_ROOTS`, and a shell command walks
straight around that. Manual approval now puts a person in front of each call,
which is real mitigation and is **not** the same thing: an approved command
still runs with the full rights of the process.

What the labs put underneath the model — seatbelt on macOS, landlock/bubblewrap
or a container on Linux, and a filesystem/network allowlist — has no equivalent
here. On Windows there is no cheap equivalent at all, which is part of why this
is unbuilt rather than merely undone.

**Undecided:** whether the boundary is a container (clean, and cuts the agent
off from the host it is meant to administer — which is the whole product), a
per-command policy, or an unprivileged second user. The tension is real and is
the reason this has not been picked: DOCA exists to manage the host.

### 2. No trust boundary on content the agent did not write

`research_docs` is the one place this is handled, and handled well: the page is
read by `agent.ask()` with no tools, no memory and no charter, and `frame()`
hands back a report labelled as somebody else's words. **Nothing else does
this.** `http_fetch` output, `read_file` contents and MCP tool results enter the
transcript with exactly the trust of the user's own message. `mcp/tools.js`
tracks `origin`, but that is *which machine a tool runs on*, not *how far its
output may be trusted* — the two are easy to confuse and are not the same field.

Injection is the dominant real attack on an agent holding a shell, so the
missing pieces are: a label on untrusted text, and dangerous tools re-gated
after it enters the turn. A classifier is optional; the label is not.

### 3. No retrieval layer

`memory.memSearch` is keyword scoring over the memory list — substring hits,
weighted for key matches and pins. There are no embeddings, no chunk-and-rerank
over the workspace, and no document index, so context has to be hand-fed or
found with `shell`. This is a deliberate simplification so far and is cheap to
live with at one user's scale; it is the item most likely to be wanted first
once the workspace is large.

### 4. No evaluation, and no tracing

`npm test` asserts mechanism against a scripted stub — prompt order, refusals,
what reaches the wire. Nothing scores *behaviour*: no golden trajectories, no
success metric per task, no judge, no regression corpus, and no per-turn trace
that could be read after the fact. The `usage` JSONL is the closest thing and
records cost, not outcome.

The failure class this leaves open is the one the assessment itself hit: a bug
that changes what the model is sent can pass a suite that asserts `preview()`
rather than the request. That particular instance is fixed; the hole that let it
through is not.

### 5. Context management is one-shot folding

A rolling summary is the only instrument. There is no pruning of stale tool
results and no context editing, so a turn that read three large files carries
all three until the fold. Defaults are sane (`compactTokens: 40000`,
`compactAt: 60`, `contextWindow: 0` = nobody has said) — but **a saved config can
disable folding without saying so**: this panel ran with a 1M window and
`compactTokens` at 500 000, which is past where most turns end, so nothing ever
folded. Worth a check in the ⚙ panel rather than a code change, and worth a
warning when the two settings are configured so far apart that neither can fire.

### 6. Vision is delegated, not native

Images are described by calling a separate model from a specialist's role
instructions. The main loop's input path carries a *path*, never image content —
which is the attachments design and is deliberate (`AGENTS.md`, Attachments).
When there is a vision model worth using, this becomes one optional thing done
to a file that already exists; it is listed here as a known limit, not a defect.

### 7. Not built, and correctly so

No tenant model, no quotas, no policy engine. This is a single-owner panel and
those are the enterprise gap, not a missing feature — recorded so the comparison
is honest rather than because anyone should build them.

### 8. Verified while writing this: no retry on a rate limit

The assessment left this unchecked, so it was checked. The only retry in the
call path is the one that drops `stream_options` after a 400 (`agent.js`, "any
400 costs one retry"). A 429 or a 5xx is not retried and carries no backoff — it
falls to the fallback chain if one is configured, and otherwise ends the turn.
`budget.explain()` at least names whose limit it was. Whether to add backoff is
open: a retry that is invisible is how a turn silently costs twice.

---

## Distilled from an audit of another harness (2026-09-21)

A 39-point audit of a **coding-agent orchestrator** — plan → contracts → graph
→ orchestrator → providers — was offered as a quality checklist. Most of it is
excellent and roughly a third of it transfers: that harness builds a dependency
graph over declared interfaces, and DOCA has no such object and should not grow
one to satisfy a checklist. What follows is the distillation, not the list.

**The heuristic is worth adopting whole, and is the reason for the ordering
below:** anything that strengthens a *mechanical guarantee* — something the
panel can state without asking a model — outranks new surface area. DOCA
already leans this way (`budget`, `environment`, `paths` and the whole graph of
"what is running" are model-free), so this is a sharpening, not a turn.

### Already true here — recorded so nobody re-files them

- **A typed event bus, no polling** (#27): `agent.events` plus the `/api/v1` bus,
  with the ephemeral/durable split. The missions bar polls and *stops* polling.
- **Ledger every completion** (#21): `usage.js`, one JSONL row per call, marked
  `provider` or `estimated`, tokens not money because prices move.
- **Persist "running" and resume after restart** (#17): `missions.recover()`, and
  `paused` rather than `failed` because the work is still there.
- **Humans own the plan; agents propose** (#3, partly): `work_plan` — approval
  records a decision and never launches work; revisions invalidate approval.
- **Regression-test the mechanical core without a model** (#33): the whole suite
  runs against a scripted stub; no key, no network, no Ollama.
- **Sandbox agent writes to allowed roots** (#31, partly): `fmSafe` — with the
  hole named below.
- **Honest self-evaluation in the docs** (#36): `ISSUES.md`, this file, and the
  rule that says which belongs where.

### 1. The control plane is writable by the thing it governs

The audit's #30/#31, and the sharpest finding in it for us. `settings.js` is
careful — `FORBIDDEN` blocks anything named key/token/secret, `mcpServers` is
out of reach because it holds spawnable commands, and only a click applies a
proposal. **`write_file` walks around all of it**, because `fmSafe` asks only
"is this under an allowed root".

Verified on this machine: `read_file` / `write_file` can reach
`~/.openclaw/openclaw.json`, which holds **every provider API key in
plaintext** — the exact class of secret the proposal system refuses to carry.
`.dashboard-prefs.json` and `.doca/` happen to be unreachable *here* only
because this repo sits on `D:` and `HOME` is on `C:`; on an ordinary install
cloned under `$HOME` they are inside an allowed root and the agent can rewrite
its own memory, its own approval allowlist and its own settings directly.

So the fix is a deny-list that does not depend on where the repo was cloned:
`PREFS_FILE`, `DOCA_DATA_DIR`, `CONFIG_PATH`, `.git`, and the certs directory
are control plane, not workspace. This is small, mechanical, and closes a hole
that makes several existing guarantees decorative.

### 2. A declared context window that is never declared to the runtime

The audit's #19 — "do not force a local runtime through an OpenAI shim that
silently truncates" — and DOCA does exactly that. Ollama is reached at
`${ollamaBase()}/v1`, its OpenAI-compatible endpoint, and nothing in the request
sets `num_ctx`. Ollama applies the model's own default (commonly 4096) and
**truncates the rest without saying so**.

Meanwhile `harness.config.doca.contextWindow` is the number the whole compaction
system reasons with: `compactAt`, the preflight, the warning, and the ring the
panel now draws. Set it to 32768 against an Ollama model and every one of those
is confidently describing a window the runtime is not using. The failure is
silent in both directions, which is the worst kind.

Options are a native `/api/chat` path with `options.num_ctx`, or keeping the
shim and passing the window through where the runtime accepts it — plus
refusing to *claim* a window we have no way to set.

### 3. Failure needs a structured shape, not a sentence

The audit's #14 (retry → escalate → block) and #6's "mismatch carries a
structured failure payload". DOCA's tool failures come back as prose — `Error:
…` text the model reads — which is deliberate and right for the model, but it
means nothing downstream can *reason* about a failure: no failure type, no
upstream chain, no retry policy, no escalation to a stronger model, and no
`blocked` state a human is asked to look at. A mission that fails reports in
words and stops.

Pairs with the missing retry/backoff already recorded above. The smallest
version worth having: a typed failure on the tool result (kind, retryable,
what it was trying to do) alongside the prose, and one policy that reads it.

### 4. A budget ceiling that halts, not only warns

The audit's #21 ends "hard-halt on a budget ceiling". `budget.js` has the whole
apparatus — per-turn ledger, warning at `warnAt`, `explain()` naming whose limit
was hit — and **no ceiling**. `maxSteps` bounds one turn; nothing bounds a day.
A runaway loop across many turns is exactly the case the ledger was built to
make visible and cannot currently stop. The honest shape is a per-day token
ceiling that refuses to start a new turn and says so, rather than one that kills
a turn mid-flight.

### 5. Init and inspect without the server, and a model-free proof

The audit's #23–#25 and #38. `bin/doca-token.js` is the only CLI; everything
else needs the panel running and a browser. There is no `doca status`, no way to
ask "what is stuck and why" from a terminal or a CI job, and no one-command
demo that proves a mechanical property with no provider configured. That last
one is the cheapest credibility this project could buy: the suite already proves
things without a model, and nothing surfaces that to somebody evaluating it.

### 6. Split what travels with a project from local operator state

The audit's #35. DOCA keeps conversations, memory, missions and usage in
`DOCA_DATA_DIR`, and providers, tokens, theme and settings in the prefs file —
which is close to the right split already. What is missing is that the split is
not *stated*, so it drifts: `harness.config` (portable-ish) and `models.hf.token`
(emphatically local) sit in the same file. Worth writing down before it matters,
which is cheaper than discovering it during the first migration.

### Deliberately not adopted

- **Contracts, canonicalised signatures, dead-end and cycle detection**
  (#6–#11). These are the heart of that harness and assume a plan that declares
  interfaces between steps. DOCA's plans are prose steps for a human to approve,
  and inventing a contract registry to get a dependency graph would be building
  a different product. The *idea* worth keeping is narrower and already listed
  above: state stuckness mechanically, and say why.
- **A raw `===FILE:===` agent protocol** (#15). That exists because small local
  models cannot reliably emit JSON-escaped code. DOCA is built on tool calls and
  gets the same property from the schema layer; the spill-file path already
  handles large results.
- **Multi-project priority queue with an agent-slot pool** (#18). One host, one
  workspace, one owner. Revisit only if DOCA grows a second project.

---

## OpenClaw is a peer, not a prerequisite

**Stated 2026-09-21.** DOCA began as a dashboard for an OpenClaw stack and has
since grown its own harness, its own client protocol and its own agents. The
rule from here: **an OpenClaw reference is live only when OpenClaw is
installed.** Nothing in the panel may require it, assume its paths exist, or
fail in its name when it is simply not there.

Mostly this already holds — the built-in harness is the default on a fresh
install, `loadConfig()` reads a missing file as `{}`, and the Controls page
draws "not installed" rather than erroring. Three places do not, and they are
the work:

### 1. The panel's own API keys live in OpenClaw's config file

`Settings → API Keys` writes to `CONFIG_PATH` — `~/.openclaw/openclaw.json` —
and `providers.js:152` reads providers back out of it. So a user with no
OpenClaw at all still has DOCA create a `.openclaw` directory and keep its
credentials there, in another product's file and format.

This is the coupling that matters most, because it is also half of `ISSUES.md`
H-19: the file is inside `HOME`, therefore inside `FM_ALLOWED_ROOTS`, therefore
readable by `read_file` — so "our keys live in their file" and "our keys are
reachable by a tool call" are the same sentence.

**Done in 2.68.0** (`modules/provider-keys.js`): DOCA's providers and keys
live in `<DATA_DIR>/keys/providers.json`, 0600, refused by the file tools
(`PROTECTED_FILES`) and carried by every backup. `openclaw.json` is read as a
source when it exists (DOCA's entry wins; a provider removed in DOCA stays
removed), copied once on the first read, and **written only when OpenClaw is
installed** — the undecided half, settled that way so an existing OpenClaw keeps
seeing the keys it was given here, and an install without it never gets a
`.openclaw` folder. Found on the way: a key of 8 characters or fewer was
"masked" as itself twice over (`m-1••••••••m-1`); keys under 16 characters
are now shown only as dots.

### 2. Detection commands are POSIX, so nothing is detected off Linux

Fixed in part on 2026-09-21: `catalog.shellDetect` and `system-tools.handleList`
ran `bash -lc`, so on Windows every row reported "not installed" whether it was
there or not. Both now go through `modules/shell.js`.

**Done in 2.69.0** (`modules/detect.js`): every row in the harness catalogue
and in System Tools declares what it looks for — `{ file, gitRev }`,
`{ bin, args, stderr?, match? }` (run directly, found by `shell.which`), or
`{ any: [...] }` — and no detection runs a shell line. Checked against the old
detectors on this host: the same answer for every row, except llama-server's
version, which the old `^v` strip had cut to "ersion: 9174". The regression
test the section asks for is `test/without-openclaw.test.js`.

**What was left:** the `detectCmd` *strings* were still POSIX —
`test -f "$COMPOSE_DIR/docker-compose.yml" && …` for OpenClaw, and similar for
the system tools — so they still do not run under PowerShell. The fix is not to
write a second string per platform but for each row to **declare what it looks
for rather than how to look**: a file that must exist, a binary that must be on
PATH, a command whose output is the version. `detectBinary` already does the
third portably; the first two are a few lines and remove the last shell string
from the catalogue.

### 3. OpenClaw-shaped things named as if they were ours

*Partly superseded 2026-09-25 — see "One rename, then no more OpenClaw names of
our own" below: our own identifiers **are** now to be renamed, once.*

`openclaw-panel.service`, `COMPOSE_DIR`, the gateway path in `modules/chat.js`,
the `openclaw` row in `catalog.js`. `branding.js` already draws the line
correctly — a name that would break an existing install if changed is an
identifier, not branding — so none of these get renamed. What they need is to
be **inert and quiet** when OpenClaw is absent: the gateway path already falls
back, Service Control already reports not-installed, and the remaining question
is only whether the UI should keep showing a Service Control panel at all on a
host with no stack. Undecided, and deliberately so: hiding it makes
"where did it go" the next question.

### The test that would keep this true

**Built in 2.69.0:** `test/without-openclaw.test.js` — no compose dir, no
`openclaw.json`: the built-in harness is the default, OpenClaw is "not
installed", a provider added in Settings runs a turn, every OpenClaw surface
answers without a 5xx, and no OpenClaw file is created.

A fixture with no `COMPOSE_DIR`, no `~/.openclaw` and no Docker, asserting that
the panel boots, the built-in harness is selected, a turn runs, and every
OpenClaw surface reports absence rather than failure. Cheap, and it is the only
thing that stops this drifting back.

## One rename, then no more OpenClaw names of our own

**Decided 2026-09-25, deliberately deferred until the external name is
settled.** The company is renamed on 2026-09-28. The product will be the engine
and harness behind other workflows, so it should not carry a second product's
name in its own identifiers into every future install. The rule in
`branding.js` — an identifier that would break an existing machine is not
branding — still holds; what changes is that we now choose to pay that cost
**once**, in a single release on `main`, with a migration, rather than never.

**Why wait.** Branding is already one file: once the name is settled, `vendor`
(and `product`, if it changes) in `modules/branding.js` is the whole rebrand.
The identifiers are the expensive part, and they should be named after the
**product**, not the company. If the product name stays DOCA they could go
today; if it might change, renaming now means migrating every install twice.

**What gets renamed** — ours, carrying the old name:

- `openclaw-panel.service` → `<product>.service`: `modules/startup.js:14`,
  `run.sh:16`, the two user-facing hints in `public/js/settings.js:509` and
  `public/js/utils.js:18`, `test/startup.test.js`,
  `test/status-lines.test.js`, and the README/AGENTS instructions.
- `openclaw-dashboard` as the npm name in `package.json` and
  `package-lock.json`.
- The `User-Agent: openclaw-dashboard/1.0` headers in
  `modules/models-ollama.js` and `modules/skills.js`.
- The `branding.js` header comment, which lists the first two as
  not-renameable.

**What does not** — OpenClaw is a real product the panel manages, and these
name it, not us: `~/.openclaw/`, `openclaw.json`, `COMPOSE_DIR`, the gateway in
`modules/chat.js`, the `openclaw` harness row in `catalog.js`,
`github.com/openclaw/openclaw`. Moving DOCA's own API keys out of
`openclaw.json` is §1 of "OpenClaw is a peer" above and a separate change.

**The migration is the release.** An existing install has
`openclaw-panel.service` enabled. The release must, on first start, notice the
old unit, install the new one, enable it, and disable the old one — or
`run.sh` does it, since it already owns the unit — and `startup.js` must
recognise either name for one release so that the panel's own status check does
not report "not installed" on a machine that is mid-migration.

## Modules with explicit contracts, not one function per file

**Decided 2026-09-25.** The project started maximally modular and has drifted:
of 150 JS files, 82 are under 200 lines, but five carry the weight —
`public/js/harness.js` (2168), `public/js/utils.js` (1654, 53 global
functions), `modules/harness/agent.js` (1599), `public/index.html` (1500) and
`public/css/components.css` (1171).

**What is being fixed is coupling, not length.** "Change one place and something
elsewhere breaks" comes from the front end being 31 classic `<script>` tags
sharing one global namespace: any file can call any other file's functions, a
later file silently replaces an earlier file's function of the same name, and
nothing records who depends on what. One function per file was considered and
rejected: it keeps every hidden dependency and spreads it over more files, so an
agent reads ten files to understand one function, and things that must change
together stop living together. The unit is **one idea per file**, with what it
uses imported and what it offers exported, and a test beside it.

**Staged, because the front end cannot switch in one step.** About 200 inline
`onclick="fn()"` handlers in `index.html`, and about 150 more in HTML strings
built by `public/js/*`, only work while those functions are global.

1. **Split by responsibility, behaviour unchanged.** Classic scripts still,
   globals still, but each file one topic: `utils.js` into its topics, the large
   files along their seams. Pure moves, reviewable as such.
2. **Guards so it does not drift back.** A test that fails when a source file
   passes a line ceiling (current offenders listed, the list may only shrink),
   and one that fails when two front-end files define the same global.
3. **ES modules.** `<script type="module">` with `import`/`export`, inline
   handlers replaced by delegated listeners (`data-action="…"`), one page at a
   time. Until a page is done, what its markup still calls is published on
   `window` explicitly, in one place, so the remaining global surface is a list
   rather than an accident.
4. **The back end** already has explicit `require`s; there only the size is the
   problem, and `modules/harness/agent.js` is split along its seams.

**Progress 2026-09-25** (branch `refactor/split-by-responsibility`):

- Stage 1 for `public/js/utils.js` → `lib/` + `agent-ui/`, and for
  `public/js/harness.js` → `harness/` + `harness-console/`. Pure moves.
- Stage 2 done: `test/structure.test.js` (400-line ceiling with a shrink-only
  allowance list, no duplicate front-end globals, `index.html` and `public/js`
  agree). `test/frontend.js` finds functions by name, so tests do not pin
  where code lives.
- Stage 4 for `modules/harness/agent.js` → `agent.js` (the turn) +
  `modules/harness/turn/` (8 parts), same exports.
- **Next:** `runTurn` (320 lines in one function) split into its steps;
  `public/css/components.css`, `public/js/chat.js`, `modules/harness/tools.js`,
  `public/js/files.js`; then `index.html` into per-tab partials, which is where
  stage 3 (ES modules) starts, one tab at a time.
- `chat.js` and `harness-console/transcript.js` draw the same transcript twice
  (`_chatAppendImage` / `_hcAppendImage` and their siblings). Where they are the
  same, they become one function in `agent-ui/`; that is the agglomerating half
  of this work and it changes behaviour, so it goes in its own commits.

## Licence and per-customer builds

**Decided 2026-09-25 in direction; the legal text is not written and needs a
lawyer.** DOCA should stay free, and a larger customer should be able to buy a
private, heavily customised version.

- **Current state.** `LICENSE` is MIT, copyright Protolab.tech. Every commit is
  the owner's (the Cursor Agent commits are the owner's tooling), so the owner
  can relicense new versions at will. MIT never limited the owner; what it
  permits is **anyone else** taking DOCA closed and selling it.
- **Direction: dual licence.** The public core under **AGPL-3.0** — free to use;
  whoever modifies it and serves it over a network publishes the modifications
  — plus a **commercial licence** sold to customers who want a private build
  without that obligation. Releases already published stay MIT; the change
  applies from the release that makes it.
- **A CLA before the first outside contribution.** Without one, contributed code
  cannot be relicensed and the dual licence stops working.
- **Not a closed branch per customer.** Branches of one repo drift from `main`
  and every fix gets merged N times. Instead: one public core with extension
  points, and a private repo per customer holding only its plugins, prefs and
  branding, depending on the core. `branding.js` already works this way through
  prefs overrides; the modules work above is what extends it to behaviour.
- **Timing.** The company is renamed on 2026-09-28. The licence change, the new
  copyright holder in `LICENSE`, and the identifier rename ("One rename, then
  no more OpenClaw names of our own") belong in the same release. If the legal
  entity changes and not only its name, copyright is assigned from Protolab.tech
  to the new company first.

## Settled 2026-09-25 — from `docs/audits/2026-09-25-harness-rules-map-roadmap.md`

The five questions in that audit were answered **yes** on 2026-09-25. The
audit keeps the reasoning; this is the list of what is now decided, in the
order it is to be done.

- **Done in 2.52.0 — nothing but loopback and the tailnet reaches the panel.**
  `modules/listen.js` drops any other connection at the socket (`DOCA_LISTEN`:
  `tailnet` by default, `local`, `all`). Still to do from the same item: serve
  through `tailscale serve` and read its identity header, as the stop-gap login.
- **Done in 2.53.0:** charter rules 16–23; `repo_rules` (rules + branch + uncommitted work); `write_file` refuses a repository whose rules this conversation has not read, and keeps its backups outside the tree; specialists that may write get `repo_rules` with it; `AGENTS.md` → "Working on this repository". Still to do from this item: the git tool (rules 18–21 in code) and the project root (rule 23), both P2.
  **P0 — rules for working on a repository.** Load the project's own
  `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/` / `CONTRIBUTING.md` before the
  first change, and add the eight-rule "Working on a repository" block from the
  audit (§1) to the charter and to this repo's `AGENTS.md`. Rules 2–4 and 8
  are enforced in code as soon as the git tool and the project root exist.
- **Done in 2.54.0:** Settings → Updates → Version, `modules/releases.js`, the launcher in `run.sh` (watched start, automatic revert after 90 s, `./run.sh versions` / `use`), `.releases/log.jsonl`, `DOCA_HOME`, the data-format stamp (`.doca/format.json`, `package.json` → `docaDataFormat`). Not yet: switching to a version that predates the launcher's pending protocol is fine, but the dropdown cannot follow you there (versions < 2.54.0 have no menu) — `./run.sh use` is the way back.
  **P1 — roll back from a dropdown: release folders with a `current` link.**
  Each version a worktree `releases/vX.Y.Z` with its own `node_modules`; the
  service runs `current/run.sh`; switching moves the link and restarts. The
  dropdown shows the tag's date ("released") and an install log's date
  ("installed here"). A data-format stamp makes a rollback past a store change
  warn. A version that fails its health check within ~60 s of a switch is
  switched back automatically, and `run.sh rollback [version]` works without
  the dashboard — the dashboard being what broke is the case this is for.
- **Phase 1 built on branch `auth/phase-1` (2026-09-25):** gate + rights table (fail closed, route walk test), setup with a log code, Argon2id, hashed session cookies, step-up at 12 h, same-origin check for every change (replaces `requireBrowser`), audit of every change, rate limiting, WebSockets gated, devices owned by a user and pairing bound to one, `./run.sh setup-code` / `reset-password`, login page, Account card. **Not yet in phase 1:** the Tailscale-identity shortcut (§5), and the harness being told who is asking (§6). **§6's first half built in 2.86.0:** the person rides on the turn's client (`turn/client.js` `personOf` / `deviceOwner` / `dashboardClient` — the signed-in browser, or the account a device is paired to), "# Who is asking" names them and their role, the user row records `from.userId`, and every tool call of their turn that is not a pure read is in the auth audit log as `via: harness`, theirs (`tools.js` `audit`). **Still open in §6:** missions and work chats carry no person yet (they start without a client), and proposals applying only with the `propose` right (H-7). Phase 2 next: users page, TOTP, pending approvals.
  - **Decided 2026-09-25: the first owner is set up from the dashboard.** At the machine itself (loopback connection, a loopback Host, nothing forwarded — `tailscale serve` is loopback too, so all three) no code is asked; from anywhere else the logged setup code is. Before an owner exists nothing can start an agent turn, so the agent cannot claim the panel first.
  - **Decided: no password-less mode.** Harmless offline, but once the agent can read the web a page can steer it into requests, and a panel without a password lets any request act as the owner. A password set once with a 30-day session costs almost nothing.
  - **Phase 2, with the second factor: a reset-password button.** An admin resets someone else's password from the users page (a one-time password, behind a fresh step-up, audited). Self-service "forgot password" only once there is a second factor to prove it is you — until then `./run.sh reset-password` on the host is the way, and having a shell there is already having everything.
- **Decided 2026-09-25: `docs/design/auth.md` §8** — Argon2id via hash-wasm; JSON behind a query-shaped store module so a database is one file later; the rest as proposed. Phase 1 in progress. Found while writing it: the dashboard's pairing route is unauthenticated, so anyone who reaches the panel can mint a device token with admin scope; phase 1 closes it.
- **P1 — authentication: StatENS's model, ported to Node.** Users,
  organisations, memberships with a role and a `pending` state an admin
  approves, opaque session tokens hashed at rest in an `HttpOnly`
  `SameSite=Strict` cookie, Argon2id (or `node:crypto` scrypt), TOTP, an
  append-only audit log of who acted on whose behalf. Reviewed for security
  before a customer depends on it. Designed for the hosted case below from the
  start: an organisation is the tenant.
- **P2 — project, git tool, then the structure map (JS/TS first).** The map's
  change overlay needs both of the first two, so they come first.

## Wanted 2026-09-25, not yet settled

- **Projects — phase 1 built in 2.71.0 (asked for 2026-09-26: "feel like an IDE
  such as VS Code, with everything Notepad++ has for search, replace and
  compare; recognise git and show versions; build and test an Android app when
  the tools are there").** `modules/projects/`: a project record (root, name,
  its work chat, the owner's own commands); `inspect.js` reads the kind from the
  tree (Android/Gradle, Gradle, Maven, Node, Python, Rust, Go, Flutter, .NET,
  CMake/Make) with its build/test/lint/install/run commands and which
  toolchains are present (Android SDK found via ANDROID_HOME/Android Studio's
  defaults, adb, java…); `git.js` (status, log per file, branches, diff, show a
  file at a revision, stage/unstage/commit/switch — never push, reset or
  discard); `search.js` (ripgrep or a built-in walker; regex, case, whole
  word, include/exclude; replace with a dry run first, `$1` in regex mode).
  **Instructions to the harness: a brief, not skills** (the cheaper way — skills
  do not exist yet): a conversation bound to a project gets a project block in
  its prompt (where, kind, git state, commands with what is missing, how to
  work: search_files / replace_in_files / git / project run, run the tests
  before reporting done), its shell and paths start at the root, and its
  specialists inherit the binding. New agent tools: `search_files`,
  `replace_in_files`, `git`, `project` (info/list/open/bind/run). Routes:
  `/api/projects…` (host right).
  **Phase 2 built in 2.72.0 — the Projects tab** (`public/js/projects/`): an
  activity bar (Files, Search, Source control, Build & test), editor tabs on
  **Monaco** (MIT, loaded from jsDelivr on first use: find/replace with regex,
  multi-cursor, go to line, F1 palette, folding, minimap, Ctrl+S), **search in
  files** with a per-file, per-line **replace preview** and "Replace all",
  **compare** (a file with its last commit, with any earlier version from its
  history, or with another file — Monaco's diff view, editable on the right),
  **source control** (branch switch, changes → side-by-side diff, stage /
  unstage / commit, history → a commit's changes), **build & test** buttons
  with live output, toolchains found or missing (and what to install for
  Android), your own commands, and the project's **conversation** beside the
  files. A phone gets the side views as a drawer and the editor full width.
  Found while checking it in a browser: `git branch --format` spells a hex byte
  `%1f`, not `%x1f` (branches came back empty); an Android app with a
  package.json had npm's `test` hidden behind Gradle's (now `node:test`).
  **Phase 3 built in 2.73.0 — the end-of-work check** (`projects/finish.js`): a
  project's work chat reporting "done" has its plan checked (every step done,
  or blocked = deferred with its reason), the project's `test` command run
  (must exit 0; tests that cannot run here or do not exist are noted, not
  failed), and its uncommitted changes listed in the report. A failed check
  comes back to the work chat as a list; the third refusal goes up as
  "blocked" with the failures. **Scope, built in 2.79.0:** a "done" report also
  says what the job changed — measured from the job's first checkpoint, so only
  this job's changes — and which of those files its plan did not name ("say
  why, or put them back"); a note, not a failure. Not yet: scoring drift against
  a plan's contracts (HonTabs-style), and the import-cycle check (needs the map).
  **Code intelligence built in 2.81.0** (`projects/lsp.js`, `public/js/projects/lsp.js`):
  language servers bridged to the editor over `/ws/lsp` (same gate as the
  terminal), one per project and language — problems as you type, hover,
  completion, go to definition across files. TypeScript/JavaScript and Python
  install into DOCA's data folder from Projects → Build & test (no sudo); Go,
  Rust, C/C++, Kotlin and Java servers are used when installed. Found checking it
  live: `typescript@7` (the native compiler) has no `tsserver.js`, so the install
  pins `typescript@<7`, and the bridge hands the server the project's own
  TypeScript when it has one.
  **Next:** the file tree
  from the Files tab as a shared component, and editor extensions (e.g. a
  language server for Kotlin/TypeScript) as opt-in add-ons.

- **A project is a work leader with a place to stand.** Asked for: a
  sub-orchestrator per project, with its own agents and work folders, every
  level directly reachable by the user and by the main orchestrator.

  Most of this already exists as the second level (see PRIORITY above): the
  orchestrator creates work chats, a work leader owns its context, dispatches
  specialists, reports up, and the user can open any level. What is missing is
  that a work chat is not *about* anything on disk. Proposed: a **project
  record** — root directory, the repo's rule files, an approved plan (with an
  origin snapshot, HonTabs-style, so drift is measurable), a core-context block
  (the "shared core context" entry above, per project), a roster of the
  specialists it may use, a memory scope, and its git branch — and a work
  leader **bound** to one project. Its file tools and `shell` default to the
  project root; its specialists inherit the binding.

  Not a new level and not a new process. A fourth level doubles the reporting
  path and the cost of every message passed down; a separate DOCA process per
  project splits memory, devices and MCP servers for no gain on one machine.
  Processes (a container or VM per project) come in only where isolation is
  the point — see the hosted entry below.

  **The end-of-work check is mechanical, not a question to the model.** When a
  work leader says a piece of work is done, before it may report "done"
  upward: the project's own tests / lint / build pass (run, not claimed); every
  plan step is done or explicitly deferred with a reason; the files changed
  (`git diff --name-only` against the branch point) are inside what the plan
  named, and anything outside is listed; drift from the approved plan is
  scored (HonTabs' weighting: contracts and acceptance criteria weigh more than
  wording); and, once the map exists, no new import cycle appeared. A failed
  check goes back to the work leader as a structured failure, not as prose;
  after N rounds it goes up to the orchestrator and the user. This is the
  "actual loop check" — context drift is caught by comparing the work with the
  plan and the tree, not by asking the drifted context whether it drifted.

- **Backups that survive versions: `.dBac`.** A zip with a different
  extension, so it opens as what it is and is not mistaken for a generic
  archive. Inside: `manifest.json` (`{ format, dataFormat, appVersion,
  createdAt, host, contents: [{ path, bytes, sha256 }] }`) and the data under
  `DOCA_DATA_DIR` plus prefs, **minus secrets unless asked** (API keys stay out
  of a file that gets copied around; a restore says which keys to re-enter).
  Cross-version by rule, not by hope: restoring into a newer DOCA runs the data
  migrations from the backup's `dataFormat` forward; restoring into an older
  DOCA refuses when the backup's `dataFormat` is newer, and says which version
  to install. The same `dataFormat` stamp as rollback needs — one number,
  introduced once, used by both. Checksums verified before anything is
  replaced; the current data is itself backed up before a restore. Separate
  from `snapshots.js`, which snapshots the OpenClaw agent, not DOCA.

- **The hosted case: DOCA as a website where logging in opens your work
  environment.** A link to the dashboard lands on a login; after it, the
  harness *is* the user's workspace, and their devices connect through
  `/api/v1` exactly as they do today, to use every service. More storage (and
  compute) rented as needed, with fees. What this changes now, before any of it
  is built:
  - **Auth is tenant-shaped from the first line** — the organisation in the
    StatENS model is the tenant, every store path is scoped by it, and a
    device token belongs to a user in an organisation. Retrofitting tenancy
    onto single-user storage is the expensive version.
  - **The machine the agent drives cannot be the shared server.** `shell`,
    Docker and VM control are the product, and on a shared host they are a
    way into everyone's data. Hosted, each tenant gets its own container or VM
    as its "machine" — this is where the VM/Docker idea from the auth
    discussion is right: not to guard the panel, but to give every tenant a
    box of its own to be the host of.
  - **Usage is metered where it is spent:** storage per tenant (the store knows
    its paths), model tokens (the budget ledger already counts them per turn),
    and compute time per tenant machine. Quotas enforced in the same places;
    billing reads the meters and never the other way round.
  - **The licence decision and this one are the same decision.** An AGPL core
    obliges a host to publish its modifications; a commercial licence lets a
    customer host a private build. Settle them together.

## Wanted 2026-09-25 (second pass) — the UI shows the logic it already has

The rule for all three: **one set of operations, two faces.** Every panel a
person uses is backed by the same operation the agent calls as a tool — the file
tree is `list_dir`, the editor is `read_file`/`write_file`, the git panel is the
git tool — so what the user sees and what the agent does cannot drift apart,
and anything built for one is there for the other.

- **A Projects tab, beside the Harness tab.** The Harness tab stays for work
  that is not about a codebase. A project (the record in "A project is a work
  leader with a place to stand") gets a workspace of its own:
  - **left:** the file tree, rooted at the project, from the Files tab's own
    tree and editor rather than a second implementation — which means
    extracting them from `public/js/files.js` (875 lines) into `agent-ui/`-style
    components first;
  - **centre:** editor tabs;
  - **right:** the project's work-leader conversation — the *same* session the
    Harness tab lists, shown here next to its files, not a copy;
  - **later panels:** source control in the VS Code manner (changes, diff,
    stage, commit, branches drawn as a graph); the structure map; contracts.
  - **Links between files are three different things and are drawn as three:**
    *imports* (derived from the code, exact — the map), *mentions* (a file named
    in another file's text or docs, derived, weak), and *contracts* (declared in
    a plan, HonTabs-style, and checked). Only a project with a contract plan
    shows the third.
  - **Mobile:** the tree is a drawer, the editor is full width, the chat floats.

- **A canvas the agent opens, writes into and keeps.** For anything that reads
  better as a page than as markdown or chat: a served project, an MCP app's UI,
  a diagram, the map, a small tool the agent made for the task. The chat floats
  above it. In the transcript it is a distinct chip ("◧ Open canvas: title"),
  not a link in prose, so a phone shows it as a button. Mobile opens it as a
  full-screen sheet. Several per conversation, saved with revisions like
  attachments. The plan/document overlay (`agentDocOpen`) is its ancestor.

  **It must not run on the panel's origin.** Anything on the panel's origin can
  call `/api/*`, and `/api/*` runs shell commands — an agent-written page, or a
  served project that pulls in a hostile script, would own the machine.
  So: a sandboxed `<iframe>` served from a **second origin** (its own port,
  e.g. `:4243`, no panel cookies, a strict CSP), talking to the panel only by
  `postMessage` through a short allowlist ("save this", "send to the agent",
  "open file"). Served projects on `localhost` ports are reached through a
  preview proxy on that same second origin — which is also what lets a phone on
  the tailnet see a dev server that only listens on this machine's loopback.

- **Done in 2.61.0 (2026-09-26): canvases, first version.** The `canvas` tool
  (open / write / read / list; `modules/harness/toolbox/canvas.js`), stored with
  their last 20 revisions (`modules/canvas/store.js`), served **only** from the
  canvas origin — `CANVAS_PORT`, default PORT + 1, same certificate and listen
  mode, no sessions, no cookies (`modules/canvas/origin.js`) — with a CSP
  `sandbox` (no allow-same-origin), `connect-src 'none'`, inline images only,
  scripts/styles from the two CDNs, and `frame-ancestors` the panel's port. The
  address is a 128-bit token; the panel's `/api/harness/canvases/:id` gives it
  out, the list does not. In the chat: a "◧ Open canvas" chip; the window sits
  under the floating chat, a full-screen sheet on a phone, with a revision
  picker and ↗ open-in-tab. postMessage allowlist: `send` (text into the chat
  box, the user sends it) and `close`. Checked in a browser: the page's
  fetch to `/api` is refused by the CSP and its storage is blocked.
  **Preview proxy: done in 2.70.0** — `canvas` action `preview` (or `POST
  /api/harness/previews`, host right) issues a 12-hour token for one localhost
  port (never the panel's own); `/p/<token>/` on the canvas origin sets an
  HttpOnly cookie and the app's root-relative URLs, fetches and WebSockets
  (hot reload) are proxied to that port (`canvas/previews.js`, `canvas/proxy.js`).
  The app keeps the canvas origin (allow-same-origin), never the panel's; our
  cookie is never passed to it. Checked in a browser, desk and phone: CSS,
  script and a same-origin fetch all load. One preview per browser at a time.
  **Not yet:** canvases on **devices** (left out of their
  transcripts for now — a phone could open the canvas URL in its WebView);
  "save this" / "open file" messages. Deleting a canvas from the panel: done
  in 2.70.1 (🗑 in its window, `DELETE /api/harness/canvases/:id`, chat right).
- **Isolated work: hand it to a harness that already isolates.** Where a task
  should run apart — its own checkout, its own process — the agent starts
  Claude Code or a similar CLI through the harness catalog (which already lists
  them) instead of DOCA growing its own isolation. Nothing to build.

- **Done in 2.55.0:** `.dBac` backups — Settings → Backups, `modules/backup/`, password on/off, saved password, upload, verified all-or-nothing restore with a safety backup, the data-format check. **Scheduled** backups and a retention count: done in 2.66.0 (`backup/schedule.js`, Settings → Backups → On a schedule: off/daily/weekly at a local time, keep the last N `auto-…` backups only; an encrypted schedule with no saved password makes nothing and says so); migrations (`restore.js` → `MIGRATIONS`) are empty because there has only been format 1. AES interoperability with 7-Zip was not checked on this host (no 7z installed); the open format was, with Python's zipfile.
- **Settled: `.dBac` is an AES-256 password-protected zip, and it includes
  everything, settings and keys too.** Supersedes "minus secrets unless asked"
  above: once the file is encrypted, leaving the keys out only makes restoring
  harder.
  - **Library: `@zip.js/zip.js`** (BSD-3-Clause, pure JS, no native build,
    reads and writes WinZip AES-256). The archive opens in 7-Zip, WinRAR and
    Keka with the password. **Not ZipCrypto,** the old "classic" zip password,
    which a known-plaintext attack breaks — and a backup always contains known
    plaintext (`manifest.json`, `package.json`).
  - **File *names* are not encrypted by the zip format,** only contents. The
    names here are DOCA's own store paths, so nothing is learnt from them; if
    that ever changes, pack the data into one inner archive first.
  - **Encryption is the user's choice (settled 2026-09-25).** Settings has a
    switch: password-protected (default) or an open zip. Open is allowed, and
    the UI says plainly what that means before the first one is made: the file
    then carries every API key, token and private conversation in the clear,
    and whoever holds it holds them — the user carries that responsibility.
  - **Password:** typed at backup time, or remembered in Settings for scheduled
    backups. Remembered, it is **not** kept in the prefs file — the agent's
    file tools can reach that (`ISSUES.md` H-19) — but in its own `0600` file
    outside `FM_ALLOWED_ROOTS`, write-only from the UI: settable and
    replaceable, never shown again. Restore asks for it. A lost password is a
    lost backup, and the UI says so before the first one is made.

## Wanted 2026-09-25 — review the panel's sections for what DOCA is now

The panel's sections were drawn when it was a dashboard for an OpenClaw stack;
several still describe that product rather than this one. Review them against
"OpenClaw is a peer, not a prerequisite" (above) and against the harness, before
more is built on top of them. Proposed shape, to settle per section:

- **Settings sub-tabs today:** General, API Keys, Skills, Snapshots, Setup,
  Config, Voice, System.
  - **Decided 2026-09-25:** OpenClaw's settings are kept but live only in an "OpenClaw" section that appears when OpenClaw is installed — nobody uses them through this UI (OpenClaw has its own), and the point is that it is never unclear whose settings they are.
  - **Snapshots, Setup, Config** are OpenClaw's (snapshots of its agent, its
    setup scripts, its config files). Not deleted outright — a user with
    OpenClaw still needs them — but **moved into one "OpenClaw" section that
    appears only when OpenClaw is installed**, which is the rule that entry
    already sets. On a DOCA without OpenClaw they vanish.
  - **Backups** gets its own sub-tab (today it sits in General under Updates).
  - **Skills** becomes the harness's skills — the manifest and bodies from "Two
    layers of learned knowledge" — with OpenClaw's skills a filtered view of the
    same list when OpenClaw is present, not the other way round.
  - **Config** in its DOCA sense: the harness's own configuration (params,
    fallback chain, memory rules, charter view) — today split between the ⚙
    strip on Controls and the Rules modal.
  - **General, System, Voice, API Keys** stay, each checked for OpenClaw-only
    wording and for keys that DOCA stores in OpenClaw's file (§1 of "OpenClaw is
    a peer").
- **Done in 2.60.0 (2026-09-26):** the sub-nav is drawn from one list
  (`public/js/settings/subnav.js`): General, API Keys, **Backups** (its own tab
  now), **Harness** (the built-in agent's ⚙ parameters, memory rules and
  approvals, each opened where it is edited), Voice, System — then an
  **OpenClaw** group (Skills, Snapshots, Setup, Config) drawn only when
  OpenClaw is detected (`/api/harness` → `openclaw.detected`). Skills went into
  that group because they *are* OpenClaw's (clawhub, `~/.openclaw/workspace/skills`).
  The file headers no longer say "OPENCLAW PANEL". **Still open:** the
  harness's own skills (none exist yet: "Two layers of learned knowledge");
  API keys still live in OpenClaw's file, so saving one still says "restart
  OpenClaw" — moving them to DOCA's own file is §1 of "OpenClaw is a peer".
- **Done in 2.62.0 (2026-09-26): a lighter, modern style, as a choice.**
  Settings → General → Appearance now has a **Style** (Classic — the panel as
  it was; Modern — Inter, rounded, roomier, sentence case; `public/js/look.js`,
  `public/css/skin-modern.css`, scoped to `html[data-skin="modern"]`, shape only,
  never colour) beside the colour themes, plus a light palette, **Daylight**.
  Saved as `prefs.skin` and remembered in the browser so the page is drawn in
  the right style before prefs arrive. The theme picker moved to
  `settings/appearance.js` (settings.js 477 → 344 lines, off the oversized
  list). Code, logs, editors and terminals keep the mono face in both.
  **Not yet:** the login page is still Classic; a per-user look (it is one
  prefs file for the install).
- **Then the tabs:** Models, Docker, Controls, and the left status bar — each
  reviewed for what is DOCA's and what is the OpenClaw stack's, the same way.
- **Every control built from the existing pieces** (`.input`, `.input-label`,
  `.btn` variants, the toggle, the Snapshots row); `test/ui-consistency.test.js`
  holds the fields to it, and screenshots at desktop and phone width before
  shipping.

## Wanted 2026-09-25 — update the dependencies on purpose, with the version

**Done in 2.67.0.** Settings → General → Updates → "Check dependencies": when
on, every update check also lists the panel's packages that are behind
(current → wanted → latest, licence, "a new major version: a decision, not an
update") and npm's advisories, worst first (`modules/deps.js`, `GET /api/deps`,
owner only, cached an hour). Updating stays a release step: `npm run
deps:update` (update within ranges, audit, tests). Used at once: the first
check found 4 advisories (2 high — `ws` memory disclosure, `path-to-regexp`
ReDoS; `qs`, `body-parser`), all fixed within the declared ranges in 2.67.0.
Left as decisions: express 5 and multer 2 (new majors).


An update installs the new version's own `package-lock.json`, so dependencies
move only when a release moves them, and nothing reminds anyone that they are
stale. Wanted: in Settings → Updates, a **"check dependencies"** toggle beside
Update — `npm outdated` for the checkout, the list shown (current → wanted →
latest, with the licence), and updating within the declared ranges as part of
preparing a release, with the tests run before it is tagged. Security advisories
(`npm audit`) shown in the same list. Chosen with auth in mind: `hash-wasm` is a
dependency at the most sensitive point, and it should be kept current by a
habit, not by memory.

## Found in use 2026-09-25 (the agent's issue list, checked)

The resident agent kept a list during a long run; each item was checked against
the code and the data before landing here. Two of its explanations were wrong,
and are recorded as wrong so nobody re-files them.

- **Fixed in 2.56.2: devices did not see work chats.** `agent.mission` and
  `GET /api/v1/harness/missions` carried only specialists, while most work runs
  in work chats — a watch's picture was always behind. `harness/workview.js`
  publishes work chats in the same shape (no client update), announces every
  turn start/end (`turn/lifecycle.changed`), and at boot tells devices about
  work chats a restart cut off.
- **Built 2026-09-25 (`harness/supervisor.js`): work that finishes itself.** A work chat's job ends only with a final report (`work_chats report` + outcome done/failed/blocked/question) or a stop; a turn ending short of that is followed by another; specialists finishing wake their work chat; the Orchestrator is woken only by final reports and its reply goes to the devices; a restart resumes what it cut off; an automatic turn always gives way to the owner. Brakes: `autoTurnsPerJob` (0 = off; past it, stalled), `autoWakesPerHour`, and 3 idle turns in a row = stalled. The two entries below are what it answers.
- **A subordinate's report does not wake the orchestrator.** Measured by the
  agent with a timer probe: delivered, but no turn starts until someone speaks.
  Deliberate since 2.45 ("reports never start paid model calls"); the owner now
  wants the wake. To design: wake on *final* reports only (done, failed,
  blocked, a question), rate-limited, a setting, default on.
- ~~**Restarts pause work mid-turn.**~~ **Done in 2.64.0:** Restart and a version
  switch first ask `GET /api/harness/busy`; when turns are running the page
  names them and offers Cancel / Restart now / **When they finish**
  (`appChoose`, `settings/busy.js`). Waiting (`harness/drain.js`) holds the
  restart until no turn runs — at most 30 minutes — and meanwhile the
  supervisor starts no automatic turns (`wake` → 'draining'), or it might never
  be idle. A version switch installs at once and restarts into it when idle.
  The page shows what it waits on, with "Stop waiting" (`POST /api/restart
  {cancel:true}`). Paused work was already resumed after a restart
  (`supervisor.recover`).
- ~~**`shell` stops at 60 s**~~ **Done in 2.63.0:** the limit is a harness param,
  `shellTimeoutSec` (⚙ → "Shell command limit", default 60, at most 3600), and
  a call may ask for less with `timeoutSec`. Longer work runs with
  `background: true` as a detached job (`harness/jobs.js`: log file, exit code,
  its own process group so `stop` ends what it started, 8 at once, last 50
  kept) that the agent follows with the new `shell_job` tool (status, output,
  stop, list). After a panel restart a job whose process is gone says "gone":
  its exit code is not known, and it does not pretend otherwise.
- **Not a bug, and wrong in the agent's report:** "no paired device has
  `harness:chat`". The phone (`Smp`) and the watch both have it; the agent read
  the watch's scopes as the phone's. Its own `doca_clients` output in the same
  conversation said the phone can chat.
- **Not a bug, and wrong in the agent's report:** "device ids are not stable
  across restarts". They are (created 09-11, 09-18, 09-20, unchanged); the two ids
  it missed were older pairings, removed.
- **Already fixed, stale in the agent's memory:** "llama.cpp fallback: trailing
  system message → HTTP 500" (ISSUES.md H-9; the readings go as `user`). Its
  memory entry should be corrected.
- **"Send it to the desktop" was read as DocaDesk,** offline since 09-21, so the
  list sat in a device queue. A request naming a place, not a device, should be
  a file (`~/Desktop`) — or the agent should ask which one when both exist.
- **DocaDesk does not send its device token** on the panel's page load, so it
  signs in once instead of like DocaMobile. A change in DocaDesk.

## Built 2026-09-25: rules that settle, questions you can answer, and a bench mode

- **The memory rules were rewritten** (`harness/rules.js`, the shipped defaults,
  which is what this install uses): the three conflicts around locked entries,
  the secret-in-a-quote, what "stale" means, how keys are named, what counts as
  inferred, and the category overlaps are settled; a new rule says that when two
  rules pull apart the agent asks the owner and follows the stricter one until
  then. **One minor conflict is left on purpose, because it is the owner's to
  decide:** an owner instruction that contains a value which goes stale (rule 6
  says keep their words, rule 5 says don't store the stale value).
- **One guide for writing rules** (`rules.GUIDE`), read by the agent in
  `memory_rules_write` and by the reviewer, so the two cannot disagree.
- **Rules have a history** (last 10 versions) and an undo.
- **The review's questions are answerable** in the Rules window: a choice, the
  owner's own words, or "Discuss in chat". An answer is applied at once by the
  model under the guide, with Undo.
- **Unattended mode** (Harness → Approvals): tools run and the agent's own
  settings changes and installs apply without a click, each audited. Owner only,
  confirmed, never proposable, one click back to Auto.
- Found on the way: the harness catalog's first write replaced the whole
  `harness` prefs section, wiping the approval mode on a fresh install. Fixed.

**Wanted next, same shape:**
- ~~**The question card everywhere the owner is asked.**~~ **Built 2026-09-26
  (2.59.0):** a question the agent asks with `ask_device` now reaches the phone,
  the watch *and* the panel at once: `reach.openQuestions()` /
  `answerAtPanel()`, `GET/POST /api/harness/questions`, and a dock of question
  cards on every page (`agent-ui/questions-dock.js`, a badge on the chat
  button). The first answer wins wherever it is given; the others are
  withdrawn, a late one gets 409. The Orchestrator's wake after final reports
  tells it to ask decisions that way.
- **Skills get the same treatment as rules:** a guide for writing a skill, read
  by whoever writes one and whoever reviews it; a review with answerable
  questions; history and undo.
- **Skills from other harnesses** (Claude Code, Codex, Cursor rules…) listed and
  managed in the Skills section, usable by the DOCA harness — part of the
  Settings review above.

## Audit 2026-09-26 — the day's new surface (auth, versions, backups, supervisor, listen, rules, unattended)

A sweep of every GET route as owner, member and viewer on an isolated server
(8 s timeout each, streams noted), plus a read of the new modules. **Fixed in
2.58.2:**
- `/api/versions` answered 500 "not a git repository" on an install that did
  not come from `git clone`; it now lists nothing and says why.
- A restore replaced the accounts of the install it landed on: a backup from
  before accounts existed would put the panel back in setup mode, claimable at
  the machine. Accounts are now kept when the install has any; a new machine
  still takes the backup's.
- Expired sessions were only pruned when someone asked for the session list;
  now at every sign-in. The login rate-limit table never shrank; now it does.

**Recorded, then fixed in 2.65.0:**
- ~~The gate re-read the auth documents on every request~~ — `auth/store.read`
  now parses once per change of the file (inode, size, mtime) and hands out
  copies, so an edit that was never written cannot stay in the cache.
- ~~`auth/audit.jsonl` grows forever~~ — one file a month,
  `audit-YYYY-MM.jsonl`; the old single file is kept and read as the oldest.
- ~~A backup upload has no size limit~~ — refused (413) past what the disk can
  take while keeping 2 GB free, or past `DOCA_BACKUP_UPLOAD_MAX`; checked by
  the declared length and again as bytes arrive; no partial file is left.
- The sweep found no route that crashes for a role and no route answering a
  role without the right for it.


## The resident agent's audit of 2026-09-26 (Desktop: `DOCA-issues-audit-2026-09-26-2.73.1.md`) — answered in 2.74.0

Every finding was checked against the code before it was changed; its line
numbers held. Fixed:
- **§4e, high — truncated replies passed off as whole.** `finish_reason` is now
  read (streamed and plain JSON); a reply stopped at the length limit is said in
  every chat, stored with `truncated: true`, and the supervisor no longer counts
  it as a turn that did nothing — it asks the work chat to carry on from the
  cut. Found on the way: no chat drew `warning` events at all, so the budget and
  context warnings the turn already sent were never seen either; all three
  chats draw them now.
- **N2 / H-19, high — the agent could write what governs it.**
  `harness/control-plane.js`: `write_file` and `replace_in_files` refuse the
  prefs file, OpenClaw's config, the keys, accounts, devices, the backup
  schedule, the release pointer, `.env` and service units, whatever the
  approval mode. `shell` still could — the stated limit.
- **N1, high — events that reach nobody.** `publishWhere` returns whether a
  stream took each event, and a turn or question event that matched no device,
  or none heard from in 2 minutes, is logged (once an hour).
- **§4a/§4b, medium — "offline" and "queued".** The bus records what each
  device fetched, when it last polled and last acknowledged; `doca_clients`
  says STREAM / POLLING (last poll Ns ago) / offline, and splits the queue into
  "fetched but not acknowledged" and "not fetched", with the oldest's age.
  **Open, app-side:** a device whose queue is all "fetched but not
  acknowledged" has the events and never sends its cursor back — DocaMobile /
  DocaWear should poll with `since=` or call `POST /events/ack`.

### To do on the other machine (where DocaDesk runs and the apps are debugged) — together

Decided 2026-09-26: DocaDesk and the two apps are worked on in the same
session, directly on the machine where DocaDesk is installed and the apps are
debugged from. That machine is off at the moment.
- **DocaDesk — check first**, before changing anything: it has not polled since
  2026-09-21 (`lastSeen`); its record lacks `harness:chat` and
  `harness:sessions`, so it can receive no agent replies — Settings → API Keys
  now offers **+ Grant** for exactly those (v2.74.0), which keeps its id and
  queue. Then: does it start, reach the hub over the tailnet, and poll? And the
  older item: it signs the panel in by password, not by its device token.
- **DocaMobile and DocaWear — cursor/ack**: with the hub's new delivery
  counters (`doca_clients`: "fetched but not acknowledged" vs "not fetched"),
  see whether each app polls with `since=<last seq>` or acks
  (`POST /api/v1/events/ack`); if not, their queues never shrink. Fix in the
  apps. Also the apps' side of question cards (`prompt.new`) and canvases
  (open `https://<host>:4243/c/<token>` in the WebView — the hub leaves canvas
  items out of device transcripts until then).
- **§4g, medium — a fallback entry dropped in silence.** Announced as a warning
  in the turn, naming the entry and the provider that is gone.
- **N3, medium — final reports cut to 600 characters.** Kept up to 20,000, with
  `textTruncated` past that; progress notes stay short.
- **N4, medium — scopes frozen at pairing.** Settings → API Keys shows what a
  device's preset gained since it paired, with **+ Grant** (same id, queue and
  token; only the preset's scopes; audited). Never widened by itself.
- **§4f, low — a device named "null".** Refused at pairing and rename; names
  stored that way are repaired at boot. **N5, low** — orphan outbox files
  collected at boot. **N6, low** — `/api/v1` is now covered: every route but
  the three public ones is called with no token and must answer 401.
- **Register:** H-7 closed (proven by a live-call test), H-17 fixed (a mission
  is its dispatcher's and its superiors'), H-19 fixed for the write tools,
  H-6's citations marked stale, H-20 left open with the note that Ollama's
  `/v1` shim takes no per-request context size. The audit's claim that H-13,
  H-14 and H-18 are "still written as open" was mistaken: their status lines
  already read fixed.

## Agents that know their tools, and keep knowing them after an update (asked 2026-09-26)

The design is `docs/design/agents-and-tools.md`: **kits** (tools grouped by
family, each tool with one "when to use it" line beside it; agents hold kits,
so a new tool reaches every agent whose kit it joins), a **generated
`# Your tools` section** in every prompt (the audit's N7: nothing hand-kept),
the **Orchestrator on every kit** (its freedom close to absolute; the audit's
§3), an **update notice** telling each level what changed, **per-file edit
permissions** (free / ask even in Unattended / never) replacing the flat
control-plane refusal, and later **markdown definitions** (`orchestrator.md`,
`owner.md`, `agents/<id>.md`, Claude Code / OpenClaw-importable) with standard
agents shipped from the repository. Phase 1 is the first five — **built in 2.75.0**: `harness/kits.js` (every tool
in a kit; a tool in no kit fails `test/kits.test.js`), the generated "# Your
tools" section at every level (`turn/tools-section.js`, ~1.2k tokens, in the
cached prefix), the Orchestrator and work chats on every kit, specialists on
the kits their definition names (`kits: [...]`, old `tools` lists still
honoured, `registry.NEVER` still subtracted), the update notice
(`turn/tool-news.js`, per agent type, once), and control-plane writes that
**ask in every mode** (never "always", refused to a specialist) instead of the
flat refusal of 2.74.0. The readings-as-`user` test is in `test/harness.test.js`.
Adjusted with the person 2026-09-26: `human.md` and `persona.md` (Letta's names; `me.md` would read as the agent itself), not `owner.md`; tools decided by
agent type; and **undo for agent runs** (git checkpoints, retry with another
prompt/model/specialist) added as phase 3.

From the agent's latest findings, also: its memory note
`llamacpp-cannot-serve-harness` is obsolete (two missions ran end to end on
llama.cpp with `--jinja`); and add a test that the per-step readings travel as a
`user` message, which is what keeps a Qwen `--jinja` template from refusing.

**Phase 2 built in 2.76.0:** specialist definitions are markdown (front matter +
role; `agents/markdown.js`), Claude Code subagents import as they are (Read →
files, Grep/Glob → code, Bash → shell, WebFetch → web; their MCP tools and
model names are left out with a note), a folder imports without overwriting,
each exports as `.md`, the registry saves `.md` and moves an older `.json`
aside. `persona.md` (the Orchestrator's) and `human.md` (the Orchestrator's and
work chats') are in `<DATA_DIR>/identity/`, in Settings → Harness → Who.
**Phase 3 built in 2.77.0 — undo for agent runs** (`projects/checkpoints.js`):
a shadow git repository per project in `<DATA_DIR>/checkpoints/` whose work tree
is the project — works on folders without git, never touches a project's own
repository (no ref, index or status change; tested). A checkpoint is taken
before every turn of a project's conversation when files changed, by hand in
Projects → ↶ Checkpoints, or by the agent (`project` checkpoint / checkpoints /
changes / restore). Restore removes files made since, puts the rest back, and
first checkpoints the present so it can itself be undone. Not in backups (it is
this machine's undo history). **Phase 4 built in 2.78.0 — standard specialists
ship from the repository:** `specialists/*.md` (archivist — moved out of code —,
coder: code/files/shell kits, researcher: web kit + memory_search), loaded as the
shipped fallback; a file of the same id on this machine wins. **Promote** (the
specialist editor's ⇪, `POST /api/harness/agents/:id/promote`) writes one made
here into the checkout's `specialists/`, to ship once committed. Skills as a
layer beside kits and identity remain for later.

**H-20 answered in 2.80.0** — Ollama's real context is measured (`/api/ps`,
`/api/show`) and said when the declared window is larger: in the agent's
readings and under the ⚙ Context window field (`harness/ollama-context.js`).
