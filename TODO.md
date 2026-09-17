# TODO

Known rough edges, deliberately deferred, and features wanted but not built.
Every entry here is a **decision**, with its reason — that is what separates this
file from `ISSUES.md`, which holds defects nobody chose. "Known since day one"
does not put something here; only *somebody decided* does.

When a deferred item turns out to bite someone, promote it to `ISSUES.md`. When
an issue turns out to have been a decision, move it back here with the reason.
Do not silently drop either.

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

- **The ledger is per turn and is not kept.** `usage` lands on each assistant
  row and the session index gains a cumulative `tokens`, but nothing aggregates
  across sessions, so "what did this week cost" has no answer and there is no
  per-model or per-provider breakdown. The rows are all there; it is a reader,
  not new plumbing.

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
  the user blocked) the whole time. The shape wanted: the orchestrator is the
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

**Wanted, not broken.** The defect behind this is H-5 in `ISSUES.md` and it is
fixed: a turn that gets no first token now stops at a named deadline and says so.
This entry is about what should happen *instead* of stopping.

The case that prompted it, 2026-09-14: `deepseek-flash` returned
`200 text/event-stream` and sent `: keep-alive` for three minutes without a
single token, deterministically, on a key with $19.68 of balance — while
`deepseek-v4-pro`, same provider, same key, answered normally. So the unit that
failed was the **model**, not the provider, and the chain has to reflect that:
next model on the same provider first, next provider second.

Shape, if this gets built:

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

- **`/api/update-check` cannot see a private repository.** Tagging is not the
  problem it first looked like: every release from v2.4.0 to v2.12.0 is tagged
  locally, and only the pre-v2.4 ones live in `.git/packed-refs` — reading that
  file alone says "tags stopped at v2.3.5", which is a trap worth knowing about,
  since `git tag -l` and `.git/refs/tags/` are the honest answers. What is real
  is that `fetchLatestTag()` calls `api.github.com` with no credentials, so if
  `Zalban95/DOCA` is private it gets a 404 or 403, resolves null, and the panel
  reports "no update available" forever without ever saying it could not look.
  Verify against the live API before trusting the banner; if the repo is
  private, either the check needs a token or it should say "cannot check" rather
  than "up to date". The ordering fix it now carries (highest semver out of a
  page, instead of whatever `/tags?per_page=1` happened to return first) is
  still right, but it was a latent bug, not an active one.

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
