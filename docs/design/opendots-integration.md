# OpenDots integration — coding-agent handoff

> **Status, 2026-10-05.** Written on the portal PC on 2026-10-04 against DOCA 2.116.2 and committed today from there
> (branch `portal/opendots-plan`). Since then the hive backlog took over the "stronger DOCA" half: TODO.md **H14**
> checks OpenDots feature by feature, and computers, recipes, pages, the face, realtime calls and learning were built
> (2.153–2.200). What this document still drives is **OpenDots as a peer harness** (§3–§4), open as H14's last item.
> Line numbers and seams named below are from 2.116.2; re-read the code before acting on them.

Planning only, 2026-10-04. The requested outcome is an OpenDots peer in DOCA's
existing harness panel, plus concrete improvements to DOCA's own logic, work
organisation and tools. `TODO.md` is the work queue; this file supplies the
contracts and evidence for its OD-* and H-OD-* items. Recommendations below are
the proposed implementation, not features already shipped or decisions to buy
services. No runtime, dependency, configuration or credential was changed here.

## 1. Evidence and compatibility baseline

DOCA was fast-forwarded from `c446c41` to `ae6e053` (`2.116.2`). OpenDots was
inspected at `c2569bb6a13a22e565cf3eb791c62267d06babb1` (`0.1.0`, 2026-10-02).
Recheck upstream at implementation time; do not replace a pinned dependency
with `main` or `latest` in an installer. Keep MIT notices for reused code.

Pinned upstream reading map:

| Source | What it establishes |
| --- | --- |
| [Setup][setup], [package][package] | Node >=24, separate React/Vite and Hono/ESM app; Intelligence and model configuration needed for conversations; pages can work without it. |
| [Platform][platform], [headless turn][headless], [runtime scope][scope] | `/api/copilotkit` runtime, registered Dot/thread ownership and the server-compatible `IntelligenceAgent` path. Ordinary completions or an assumed SSE-only transport are insufficient. |
| [Workspace routes][workspace], [Dot agent][dot] | Spaces, Dots and thread creation; per-Dot tools, global/Dot permission checks; configurable OpenAI-compatible compute, not a DOCA agent loop. |
| [Pages][pages], [page routes][page-routes], [page service][page-service] | Revision-checked documents, source-thread links, page/Dot conversation binding and reviewed-save receipts. |
| [Job store][store], [runner][runner] | Transactional claims, lease identity, stale-result rejection, stop/release and a bounded worker; not exactly-once external side effects. |
| [Computer guide][computers], [service][computer-service], [deployment][computer-deployment] | Per-Dot persistent computers, scoped tokens, takeover, capability revocation and pinned OpenBot dependency. |
| [Learning][learning], [Parallel research][parallel], [security][security] | Optional published-skill delivery and external research; single-owner trust boundary and deployment limits. |

Do not infer a working deployment from keys being present: `setupStatus()`
mostly reports configuration. A readiness probe must also establish reachability
and compatibility; a user-triggered conversation check establishes model access.
Upstream tests use fixtures. This research did not run OpenDots, provision
Intelligence, call a paid model, connect Slack/voice, or test Docker computers.

OpenDots persists pages/work metadata in SQLite, chat history in Intelligence,
and computer files/profiles in separate volumes. None is a complete backup of
the others. Its Slack mapping intentionally maps permitted actors to one owner;
it is not a tenant or DOCA-role mapping. Realtime speech has separate provider
configuration: `OPENAI_BASE_URL` changes compute, not the voice endpoint.
Parallel research is enabled by default upstream; a DOCA-managed setup must
show that data destination and require an explicit choice before using it.

## 2. DOCA's existing seams — read these before editing

Paths below are relative to this repository. Read `AGENTS.md` and the current
code as well as old prose: the TODO and AGENTS retain historical statements
about authentication, file storage and recovery that later sections supersede.

| Concern | Existing implementation | Required extension |
| --- | --- | --- |
| Catalogue/preferences | `modules/harness/catalog.js`, `routes.js`, `mount.js`; `public/js/harness/{catalog,lines,params}.js` | Stable `opendots` id; web surface/readiness and per-instance config; preserve fresh-install DOCA default and existing prefs. |
| External workspace | `public/js/harness-console/{shell,external,builtin,transcript,sessions}.js` | Dispatch by supported surface; OpenDots must not open an empty CLI terminal. Reuse the transcript and session UX where supported. |
| Chat routing | `modules/chat.js`, `modules/harness/routes.js`, `public/js/chat.js` | Explicit OpenDots branch shared by status/history/send/clear/stop. Non-built-in currently reaches OpenClaw then Claude; do not inherit that fallback. |
| Device conversation | `modules/api-v1/harness.js`, `bus.js`, `scopes.js`, `openapi.js`; `PROTOCOL.md` | Built-in today. External support is a deliberate additive protocol change with ownership, capability negotiation and existing 202/event semantics. |
| Stack lifecycle/logs | `modules/controls.js`, `modules/logs.js`, `modules/shell.js`, `modules/detect.js` | Stack operations currently assume OpenClaw's `COMPOSE_DIR`; select a validated per-stack root/project before adding another stack. |
| Work and recovery | `modules/harness/{organization,supervisor,workview}.js`, `turn/lifecycle.js`, `modules/agents/{registry,missions}.js` | Keep the three levels, single-turn lock, narrow specialists, explicit outcomes and bounded wakeups; extend durable ownership. |
| Tools and evidence | `modules/harness/{kits,tools,skills,tool-notes,research}.js`, `guard/`, `modules/mcp/` | Use existing tool families, dynamic discovery, source isolation, tool-note proposals and skill manifests. |
| Authority/data | `modules/auth/{gate,rights,store}.js`, `modules/db/`, `modules/store.js`, `modules/harness/control-plane.js` | Authorize every new action; store bindings and durable receipts through existing storage boundaries; do not expose credentials in catalogue/config GETs. |
| Work products/devices | `modules/projects/`, `modules/attachments.js`, `modules/canvas/`, `modules/device-files.js` | Project artifacts and safe previews already exist; retain machine identity and separate executable canvas origin. |

Do not refactor every harness to land OpenDots. Extend the existing stack
handling just enough for the second stack, and introduce one narrow OpenDots
adapter. DOCA remains CommonJS with classic browser scripts and no frontend
build. CopilotKit React, Hono, TanStack and the upstream MCP SDK stay upstream;
do not transplant their application or replace DOCA's MCP client.

## 3. Concrete panel behaviour and runtime ownership

Use `kind: stack` with an explicit web surface/capabilities, rather than pretending
OpenDots is a CLI. Model only supported operations: lifecycle, logs, conversations,
stop, page review, documents, computer, voice and channels. Declare support in
code and refine readiness from probes; a feature flag is not a permission grant.

Store non-secret configuration under `harness.config.opendots`: managed root and
Compose project, deployment mode (`managed` or `attached`), approved endpoint,
instance identity and selected Dot. Secret fields are write-only with a protected
server-side reference. Patch the catalogue's non-built-in `configFor()` path,
which currently returns only launch command, config path, env and model; a new
field saved but absent on the next GET is not a configuration UI.

Allow only the configured service origins and reviewed API paths. Do not turn
the adapter into a caller-supplied URL proxy, follow redirects carrying an owner
token, or trust an arbitrary discovered WebSocket destination. Validate the
configured Intelligence endpoint separately. New routes require explicit
`auth/rights.js` entries; lifecycle, credentials, tool permissions and computer
control require the host right and recent sign-in as applicable, plus the
owner/binding checks below. Same-origin mutation checks and audit still apply.

The Controls row retains Install/Update, Use, Open and settings. Add stack
Start/Stop/Restart only where DOCA owns the deployment. Attached services offer
Connect/check and Open, with unavailable management actions explained. Detection
must distinguish absent, installed/stopped, unreachable, authentication failure,
setup required, incompatible and conversation-ready; keep `detected` compatible
with existing consumers. Optional voice/computer failure must not disable text.

Managed installation uses reviewed, version-pinned upstream code and its lockfile,
an independent Compose project and loopback/private-network binding. Check Docker
Compose v2 and build/runtime prerequisites before changing anything. Invoke fixed
executables with argument arrays; use `shell.js` when a shell is actually needed.
Do not copy POSIX-only `NODE_ENV=...`, `export`, or shell installer strings into
Windows launch paths. A user can connect an existing installation without Docker
on the DOCA host. Installation stays a human action through the existing proposal
handler; never accept an agent-generated install command.

An update drains/reconciles running work, records the old revision, takes a
consistent SQLite copy and records the other data locations. Keep remote history
as a separately reported backup/export obligation, not a claimed `.dBac` success.
Stop/restart preserves data. Dynamically provisioned Dot computers outlive the
supervisor: list them and explicitly stop owned computers when the user chooses
that scope. Never run `down -v`, reset volumes, update an attached deployment,
or prune unrelated containers as routine lifecycle work. Rollback restores a
compatible app/data pair; do not assume an older app understands a migrated DB.

An Open/native-workspace action may open the configured origin during bring-up.
Do not inject the owner token into its URL or iframe it under DOCA's authenticated
origin. Native navigation can require OpenDots' own sign-in and is a labelled
handoff. Full completion requires the DOCA-native conversation/review flow below;
an iframe or link alone does not satisfy OD-2/3.

## 4. Conversation adapter contract

### Transport proof first

Upstream routes to investigate, not a promise of a stable public API:

- `GET /api/workspace` for Dots/Spaces/conversation bindings and setup.
- `POST /api/conversations {dotId, title}` to create and bind a thread.
- `GET /api/copilotkit/info`, then the transport used by
  `src/server/headless.ts::runThreadTurn()` (`IntelligenceAgent`). Inspect the
  SDK's run/connect/stop and persisted-message behaviour at the pinned version.
- Scoped runtime thread history/state paths in `runtime-scope.ts`; page/review
  routes in `page-routes.ts`; `/api/tasks` and its actions for background work.

Start OD-0 with a tiny executable fixture and one live check when configured:
create → stream/tool event → disconnect/reconnect → fetch history → stop, then
review → decline and review → save. `runThreadTurn()` currently returns final
text: reusing it unchanged does not provide tool streaming, reviews or attach.
Verify those SDK behaviours before settling the adapter's packaging. Prefer the
official pinned server SDK over hand-written Intelligence WebSocket machinery.
If it requires Node 24/ESM dependencies incompatible with DOCA's runtime, contain
it in a small companion in the OpenDots deployment with authenticated private
HTTP/SSE to DOCA; do not raise DOCA's global requirements by accident. This
packaging choice is an OD-0 engineering decision, not a second agent framework.

### Identity and source of truth

Persist a binding with DOCA owner/org, stable instance id, harness id, local
conversation id, external Dot/thread ids, and creation time. Existing sessions
with no harness field read as `doca`; old data keeps loading. Do not use names as
keys. Bindings are resolved server-side and checked on every read, run, review,
stop and artifact fetch. An endpoint change cannot silently attach old threads
to a different OpenDots instance.

OpenDots/Intelligence own the external transcript; DOCA owns its binding,
delivery cursor and normalized receipts. A cached transcript is a projection,
not a second history writer. DOCA owns its own memory, identity, plans and skills.
There is no automatic cross-harness sync. An explicit handoff carries the user's
task, allowed artifact references and a bounded brief, with provenance; it does
not export the Orchestrator's memory or grant its tools.

Reference an external page by instance, Space, page id and revision, with an
optional DOCA project association; keep its content authoritative in OpenDots.
A Space is not automatically a DOCA project or permission role. Explicit import
creates a local artifact with source provenance; it does not start bidirectional
sync. If a DOCA work chat delegates to a Dot, store the external run as its
child work/result reference and choose one execution owner. Observe and report
through that adapter; do not run both the built-in loop and Dot agent for the
same task, or let both supervisors retry it. Routine project results still use
the explicit-report rule in TODO.

The first integration maps one DOCA owner to one OpenDots instance. Other users
must not inherit that owner's backend token through the hub. Require both the
appropriate DOCA route right and matching owner/binding; multi-user sharing
needs a separately designed identity contract. Recheck suspended owners and
revoked permissions before dispatch and on later operations. Session selection
and owner identity must never come from an unverified model argument.

Changing the default picks the runtime for new work. It does not migrate an
existing conversation or reinterpret an in-flight turn. Keep a runtime-bound
main conversation for external chat and retain DOCA's Orchestrator. When an
external runtime is selected but unavailable, show its setup/error and preserve
the draft. Do not call OpenClaw, Claude or DOCA as an undisclosed fallback.

### Run, event and review semantics

- Share one adapter path across the panel's OpenDots send/history/status/stop
  operations. Allow at most one active run per external thread from DOCA;
  reconcile upstream activity before starting, because native UI/Slack/tasks
  can also write. An upstream busy conflict is not permission to fork/retry.
- Normalize run start, text, tool call/result, artifact, review, terminal outcome
  and supported usage into existing DOCA event/rendering shapes. Keep instance,
  session, run and tool-call ids. Buffer bounded deltas and rehydrate from saved
  history/receipts; deduplicate by upstream ids (or a persisted adapter key when
  absent). Only a confirmed terminal state means done; a closed socket does not.
- Separate viewer detach from stopping a run. Reconnect attaches to the same
  run/thread and does not repost the prompt. Stop requests upstream cancellation;
  retain cancelling/unknown until acknowledged or reconciled. Explain that an
  accepted external side effect cannot be undone by closing the stream.
- Unknown event kinds degrade to a bounded text/status record. Do not execute
  upstream HTML/JavaScript or expose raw credentials in logs. Use existing safe
  Markdown, media and isolated canvas boundaries. Missing token/cost/context
  data stays unknown; DOCA's usage ceiling does not enforce an external runtime's
  provider spending. Show the external limits that can actually be measured/set.
- Bridge the supported `review_space_page` frontend tool to a DOCA review card
  with the exact draft/destination and an upstream continuation. An approval
  writes through the reviewed-page endpoint and returns that save receipt; the
  agent must not save a duplicate. Bind the decision to owner, thread, tool-call
  and draft revision/hash; reject stale or reused decisions and retain decline.
  General DOCA tool approval is not automatically upstream tool approval:
  unbridgeable pending actions must stay pending with a native handoff or a clear
  unsupported state, never be auto-approved or reported as saved.

The `/api/v1` extension follows OD-2 after the adapter works. Preserve unqualified
legacy device requests as built-in; advertise external support and allow an
explicit harness/session selection for capable clients. Keep `202 {turnId}`,
`409 turn_in_flight`, bounded `agent.turn` outcomes, ephemeral deltas and durable
replay. Deliver only to the owning user's authorized devices, never reuse a
global fanout without that filter. Changing these routes/caps requires
`PROTOCOL.md`, OpenAPI regeneration, tests and each affected client's AGENTS.
Do not claim phone/watch parity while they still silently target `agent.turn()`.

## 5. Improve the built-in harness without importing the whole stack

These are DOCA design recommendations inspired by the cited implementation,
not claims that OpenDots already solves DOCA's orchestration or security.

| TODO item | Smallest coherent implementation | Proof of improvement |
| --- | --- | --- |
| H-OD-1: work products | Add project/conversation/source/revision references to existing document/project surfaces. Use expected-revision writes and preserve local drafts on conflict. Keep Markdown documents separate from executable HTML canvases. | A manual edit racing an agent save is preserved; reload opens the same result and source conversation; a plan approval cannot approve a later draft. |
| H-OD-2: work ownership | Extend supervisor/missions storage with run/attempt identity, claim ownership and durable delivery receipts. Only the current attempt may finish or wake its parent. Start with one worker, retaining existing bounded concurrency; no distributed queue. | Restart after dispatch does not launch the same external work twice; a stale worker cannot finish a new attempt; a project job does not wake the main chat without an explicit report. |
| H-OD-3: evidence/tools | Add optional bounded artifact/source references to existing tool results and transcripts; derive live and reloaded cards from them. An optional search/extract provider feeds the scout/research reader through the airlock. | Saved output is read back; source URLs and extraction limitations survive reload; hostile source instructions cannot authorize actions or expose unrelated memory. |
| H-OD-4: computer capability | Adapt the already pinned OpenBot service as an optional execution place, with browser/files/shell grants, explicit origin, no host fallback, and takeover state checked at call time. | Two Dots cannot read each other's workspace; state survives stop/start; revoke/takeover stops new actions; handback requires a fresh snapshot. |
| H-OD-5: reviewed learning | Extend `skills.js`/tool-note proposals with candidate version, source run, test evidence, publication and rollback. Reuse on-demand manifests. Keep external ingestion and delivery separately visible and disabled until chosen. | A candidate is not delivered before publication; revocation applies next turn; rollback restores a prior version; disabled export sends no private evidence. |
| H-OD-6: evaluation | Add a small scripted workflow corpus to existing `node:test`, `bin/doca-prove.js` and guard evaluation; opt-in live provider runs record versions and costs. Reuse run receipts and the usage ledger rather than deploying a tracing service. | Compare task success, read-back correctness, duplicate effects, recovery, requests/tokens and latency to a recorded DOCA baseline. Do not label fixture success as live verification. |

For H-OD-2, a lease prevents stale state writes, not duplicate external actions.
Persist an operation/attempt receipt before dispatch; use upstream idempotency
only where verified. After a crash/timeout, query the original run and target
state. Retry a known-safe read with bounded backoff; for a possibly completed
write, verify or ask about the unknown outcome rather than blindly replaying it.
Keep existing `done/failed/blocked/question`, stop/stall states and budget brakes;
do not invent a second scheduler beside `supervisor.js`.

For H-OD-3, publish tool additions via kits and generated tool descriptions/news.
Reuse `work_chats`, `work_plan`, `mission_plan`, `research_docs`, `skill`,
`show_media`, `shell_job` and MCP before inventing similarly named tools. Keep
raw web text out of the privileged worker when DOCA's airlock is in use.
Do not make Parallel's outbound queries or SDK a prerequisite: test DOCA's
existing MCP client against the chosen provider contract first. Label data sent,
provider outages, quotas and incomplete extraction in the receipt.

For H-OD-4, keep *Devices as hands* (`devices-as-hands.md`) distinct from Dot
containers: the latter are another place, not the user's paired desktop. Keep
the Docker socket in the supervisor only, no hub credentials or control-plane
mounts in a computer, and separate per-Dot credentials. Containers share the
host kernel and upstream supplies no restrictive egress policy. Stronger
isolation/egress is a separately verified capability, not a badge inferred from
Docker or a `runsc` setting.

## 6. Delivery, acceptance and rollback

Land reviewable changes in order; each phase leaves DOCA working with OpenDots
absent. No implementation is authorized by a checked box here: all remain open
in TODO until the checks exist and have run.

1. **OD-0:** capture the pinned transport fixtures and capabilities above. Record
   unresolved attach/review/cancellation behaviour; unsupported is explicit.
2. **OD-1:** catalogue/config and independently owned lifecycle/logging. Extend
   `test/harness.test.js`, `installs.test.js`, `logs.test.js`, `auth.test.js` and
   `without-openclaw.test.js` where their contracts change. A fake service is
   enough for most failures; test actual Windows and Linux launch paths too.
3. **OD-2:** adapter/bindings and shared console/floating-chat routing. Add a
   small OpenDots fixture test covering real captured payload shapes, reconnect,
   stale/duplicate events, wrong owner/thread/Dot, denied auth, timeout, stop,
   pending reviews and no fallback. Then extend `harness-client.test.js` with
   the additive device contract; retain every existing built-in scenario.
4. **OD-3:** document/review/task surfaces and live acceptance. Show a Dot's
   research, review its draft, approve once, open/revise the saved page, reconnect
   and retrieve it again. Run without voice/computers/Slack and then verify each
   enabled optional service separately. Tests for upstream tasks must not let
   both OpenDots' runner and DOCA's supervisor reschedule the same task.
5. **H-OD-1/2/3/6:** independent built-in changes with the focused regression
   checks above; H-OD-4/5 follow once their permission/evidence contracts exist.
   Reuse `organization`, `supervisor`, `projects`, `canvas`, `skills`, `guard`,
   `workview`, `stop` and `control-plane` suites as appropriate.

Final acceptance requires a clean install with neither OpenClaw nor OpenDots,
unchanged built-in chat/device behaviour, an OpenDots-only deployment, both
external stacks together, owner isolation, server-side credential masking,
page conflict and review replay checks, one-run reconnect/recovery, and rollback
without deleting any user's work. Load every affected panel tab in a real
browser; inspect phone layout and DocaDesk/WebView2. Document what a watch can
receive and which native-client changes are still required. Run `npm test` and
the applicable structure/auth/protocol checks; report actual failures separately
from unavailable live-service checks.

Disable/remove the adapter through settings after draining or explicitly
stopping its runs; retain bindings, transcripts/receipts and external volumes.
Keep affected conversations readable with an unavailable-runtime explanation.
Future new work can use DOCA again without migrating or destroying the external
threads. A rollback must never silently replay those threads through DOCA.

Optional later work: channels and voice with a verified actor-to-owner mapping,
scoped delegation and receipts in the original thread. Do not replace DOCA's
STT/TTS pipeline, silently enroll old conversations in learning, or introduce
multi-user OpenDots sharing as a side effect of this plan. No DAG compiler,
agent marketplace, generic HTTP proxy, mandatory cloud memory, or frontend
framework migration is needed for the requested result.

## 7. Verification of this planning change

Only `TODO.md` and this new handoff document are changed on
`plan/opendots-integration`. The baseline `npm test` run began before either
documentation edit: 622 tests, 527 passed, 92 failed, 1 cancelled and 2 skipped.
Observed failures include `os.userInfo()` / `uv_os_get_passwd ENOMEM` in the
Windows sandbox, missing `python3`, assertion failures and a release-launcher
timeout. This is not a green implementation baseline; reproduce and classify
the remaining failures before using it to judge a later integration. No runtime
fixes were made as part of this documentation-only request. OpenDots live
services and UI were not exercised.

[setup]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/docs/SETUP.md
[package]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/package.json
[platform]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/platform.ts
[headless]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/headless.ts
[scope]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/runtime-scope.ts
[workspace]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/workspace-routes.ts
[dot]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/dot-agent.ts
[pages]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/pages.ts
[page-routes]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/page-routes.ts
[page-service]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/page-service.ts
[store]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/store.ts
[runner]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/runner.ts
[computers]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/docs/COMPUTERS.md
[computer-service]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/computer-service.ts
[computer-deployment]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/deployment/computers/README.md
[learning]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/learning.ts
[parallel]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/parallel.ts
[security]: https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/SECURITY.md
