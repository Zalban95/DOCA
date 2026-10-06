# Audit: coherence of the hub (2026-10-06)

Asked 2026-10-06 ("check if the system is coherent"), against the vision now in CONSTITUTION §1 (almost Jarvis on any
open model; the structure lets weaker models do the work; the panel chooses its tools). Read-only; `npm test` once
(1038/1038). Thirty-one findings, most important first; each ends with its TODO (TODO.md "Audit 2026-10-06").

## Safety and the airlock

- **F1 Secrets in the settings file are readable by the agent's `read_file`.** `control-plane.js:20` allows reading;
  `PROTECTED_FILES` (`paths.js:112`) omits the settings file, which holds channel tokens (`telegram/api.js:11`,
  `matrix/api.js:13`, `mail/index.js:25`) and MCP headers (Home Assistant's bearer, `mcp/catalog.js:27`). Confirmed on
  a scratch file: unmasked. Breaks S4; secrets live in two places. → Move channel tokens and MCP env/header values to
  protected keys files (as H10.16 did for Hugging Face), or mask secret-named keys when `read_file` reads the settings
  file; a test.
- **F2 `http_fetch` is both the airlock's reader and the agent's actor** (method, service keys, form, files from host
  paths, save_as — `toolbox/web.js:46-63`). With specialists on, the acting agents lose keyed APIs; the scout holds
  `read_file` + a POST that uploads files: an exfiltration path. → A GET-only `http_fetch` for the airlock; `api_call`
  for keyed origins and connectors, never airlocked; hi3d and service drafts move to it.
- **F3 The airlock only exists when specialists are on, which is off by default** (`turn/prompt.js:229`,
  `registry.js:93`). S6 holds only after a switch nobody is told about. → An internal quarantined reader regardless of
  specialists, or say so in S6, airlock.md, the environment block and Settings → Harness → Guards.

## How the structure serves smaller models

- **F4 ≈17k tokens per step on a bare install; nothing narrows the tools per request** (48 tools ≈12k; "Your tools"
  repeats first sentences; the Orchestrator `kits: '*'`; assistant mode gets everything). AGENTS.md says "~4k". →
  Kit triage before the turn (rules, then the quick model) + `tools_more {kit}`; a small default for the Orchestrator
  and assistant mode; measure with evals; fix the figure.
- **F5 The prompt breakdown omits what work chats send** (`introspect.js:71-89`: ≈13k of ≈21.5k characters) and no
  page shows it. → Measure `systemPrompt()`'s own labelled parts; a test that they sum to `preview()`; draw it.
- **F6 The panel's tool roster disagrees with the turn** (lists `agent_dispatch`, `scout`, `computer_look` as held
  while `schemas()` drops them). → Move switch-driven removals into `disabledFor()` with reasons; a test that the roster
  equals the schemas.
- **F7 Specialist-only tools reach the Orchestrator and work chats** (`mission_plan`, `scout_report`,
  `permission_grant`; `show_image` alias everywhere). → A mission kit; the alias in `call()` only.
- **F8 `install_propose`'s description is hard-coded and stale** (no `roboflow`, no `home-assistant` though the
  smart-home skill proposes it). → Built from the catalogs; a test.
- **F9 The agent can start a person's MCP server but not a person's installed inference service** (only a proposal,
  no stop, nothing for llama.cpp or Ollama loading). → `service_control {id, start|stop}` for what is installed, in
  NEVER, asked in Manual.

## Duplicated mechanisms and scattered state

- **F10 Two discoveries of llama.cpp servers** (`models-llamacpp-external.js` for the Models tab, `model-servers.js`
  for the sidebar) and `system_status` uses neither, reading Ollama through `curl` strings (not portable to PowerShell
  5.1). → `model-servers.js` the only one; `system_status` includes it via `fetch`; retire the other (W14: the owner's
  keep/archive/delete).
- **F11 No single list of which model does what** (harness, fallback, escalation, assistant, vision, retrieval,
  realtime, specialists, voice, guards, wake word); `scout/roles.js` is partial and its "where" paths are stale. → A
  `model-roles.js` registry read by the scout, a "Models in use" card and `settings_read`; a test that every `*.model`
  leaf is a role.
- **F12 Decisions waiting for a person are on six pages; the ambient screen counts installs only.** → One
  `decisions.list(person)` across every proposal kind, at `/api/decisions` and `/api/v1`, for the ambient screen, a
  header badge and a watch summary.
- **F13 Per-screen settings can't be changed by asking, and a proposal ignores the screen layer** (`call`, `voice`,
  `ambient`, `face` not proposable; an applied theme proposal changes the hive default a screen overrides). Breaks A7.
  → Proposals with a `screen` target applied through `screens`; those sections proposable.
- **F14 The most important settings have no typed declarations; their hints exist only in the browser** (`harness`,
  `agents`, `mcpSettings`, `voiceServices`, …). → Declare harness parameters with hints; derive `defaultParams()` and
  `HARNESS_PARAMS`; `readable()` returns hints.
- **F15 Environment vs settings precedence differs by setting** (paths: saved first; listen and channel tokens: env
  first). → One rule; "overridden by ENV" beside the field; written in AGENTS.md.

## Reachable by people only, or by agents only

- **F16 The release-authority check can't be reached by the agents it is for** (`/api/developer/releasing` is host +
  session; the dev-cycle skill names a wrong Settings path; no tool switches versions). → The rule for the turn's own
  model in the environment block; loopback or a scoped read; fix the path; decide whether a version switch can be a
  proposal.
- **F17 Routes with no panel UI**: `/api/vision/try`, `/api/clients/apps/signing` (the APK signing key is curl-only),
  `/api/harness/contracts`, `/api/ambient/place`, `/api/chat/status`, `/api/models/ollama/running`,
  `/api/harness/prompt`. → Draw each where it belongs or remove; a test that every panel route is used or listed
  API-only.
- **F18 Recipes can't be found by when to use them** (ids only, not in the prompt; `skill-match.js` only in skill
  search). → Match requests against recipe and skill titles each turn ("Possibly relevant: …"); offer "save as recipe"
  after a successful multi-step turn.

## Measurement

- **F19 The evaluation set doesn't measure what the vision depends on** (`evals/basics.json`: 6 general cases). →
  Sets for tools, delegation, skills-recipes and assistant behaviour, by difficulty, with `--models a,b`.
- **F20 Experiments pile up unmeasured** (8 of 10 "not measured yet"; no scripts for barge-in, face-voice,
  pack-registry, wake-model); `chat-call.js:89` turns face-voice on for assistant mode whatever its flag; docs point to
  "Settings → Experiments" (it is Developer); `wakeWord` filed under H8.2. → Start/last-measured dates, stale ones in
  the W14 maintenance list, a script or a "manual" note each, a decision on face-voice.

## Documents that say what the code no longer does

- **F21 PROTOCOL.md says a `mediaId` in a turn is refused "not implemented"** (it is copied in; unknown is 404); the
  §23 heading is missing; §2.3 precedes §2.2. → Rewrite, add the heading, renumber; a test grepping FUTURE/not
  implemented against existing routes.
- **F22 Stale panel locations**: the browser extension says "Settings → API Keys, preset **browser**" (it is
  `extension`, in Field → API keys); doca-client and README say Settings → API Keys; "Settings → Services", "Settings →
  DOCA apps". → Navigation paths from one helper; a test against `NAV_GROUPS`/`_SETTINGS_SUBTABS`; fix the extension's
  preset name.
- **F23 Group ids and names disagree** (`host` = "Hub", `intelligence` = "Field"; TODO says "This host · Models &
  tools"; README's "bottom tab bar"). → Rename or document; fix TODO and README.
- **F24 Overloaded terms**: "job" (four meanings), "scout" (the airlock specialist vs the model scout tool),
  "browser" (a screen kind vs the extension). → `model_scout` for the tool; "task" for a work chat's job in prompts; a
  short glossary in AGENTS.md.
- **F25 TODO.md has drifted** (H6.7 twice; H14 unticked though H8.3 built it; H8.4 stale — *fixed in this change*;
  "Wanted 2026-09-25" mostly built; 3,128 lines, 10 open boxes). → Finished sections to the Done log, narratives to
  checkboxes, unique ids tested.
- **F26 Stray files at the root**: `audit.md` (2.37.0), `CAMPAIGN.md`, `TODO-CAMPAIGN.md`; a committed
  `trainers/wakeword/__pycache__/*.pyc` — *removed in this change, `__pycache__/` ignored*. → Archive the three under
  `docs/history/` (W14).

## Smaller

- **F27 "Skills directory" is OpenClaw's**; DOCA's own skills folder isn't a managed path. → Rename the label;
  register DOCA's.
- **F28 Home Assistant is heading for two connections and two copies of its token** (MCP header today; a Home page
  over its WebSocket planned). → One credential home (a service key `homeassistant`) referenced by both.
- **F29 The Orchestrator's prompt describes specialists even when they are off; a model that doesn't follow the
  work-chat protocol leaves jobs blocked with no `escalateTo` set.** → Prompt built from the switches; the supervisor
  finishing a work chat by checks (plan complete, tests pass) rather than the model's report.
- **F30 Charter rules 24–27 ("go-ahead for anything with several steps") pull against V5 autonomy.** → Fold H10.11's
  risk tiers into rule 25 (reversible with a checkpoint goes ahead; irreversible or outward asks); an eval case per
  tier. Charter change: S11, asked first.
- **F31 AGENTS.md gives the sibling repositories as `../../`; they are at `../`.** → Fix.

**Not checked:** the browser smoke run; the sibling repositories beyond a skim.
