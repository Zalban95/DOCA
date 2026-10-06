# The hive — installing a client makes a device part of DOCA

Asked for 2026-10-04 (the name is for another day). The end state: **install a client on a device and
it becomes part of the hive** — its screen, its tools, its sensors and its person are reachable by the
agents, governed by the same levels and approvals, and configured from one place. The platform lets a
person do anything an agent can do anywhere else; the product sold later is a narrower edition of it
(a lower level, chosen skills, chosen visible parts), and for now every capability other harnesses have
is wanted here. The values and rules this design answers to are `CONSTITUTION.md`'s.

This document is the plan to get there: where settings live (§1), the coherence review every part is
held to (§2), what is missing against the other harnesses (§3), what "joining the hive" takes (§4), a
face for it (§5), and an order (§6). TODO.md carries one line per item and points here.

---

## 1. Settings: the device's page, the hive, and the person

Today there is **one prefs file per install**, and it mixes three kinds of thing. `theme`, `skin`,
`hiddenTabs`, `sidebarSections`, `sidebarStats`, `codeExpanded`, `fmFavorites` and the voice choices
are about *a screen* — so a phone and a desk share one look and one tab list, and hiding a tab on the
phone hides it on the desk. `harness`, `mcpServers`, `agents`, `models`, `llamacpp`, `paths`,
`updates`, `backups` are about *the hive*. Nothing yet is about *the person* except accounts.

**Decided direction (2026-10-04): every setting that can be per device moves to a page served per
device, like the mobile app's settings; the rest lives in the clients structure.**

| Home | What lives there | Where it is edited |
|---|---|---|
| **Device** | look (theme, style, face), visible tabs and sidebar, the face interface on/off and its pack, voice in and out (STT/TTS choice, voice, speak replies), notifications and quiet hours, the console/macro layout, which tool families it lends the hive and their consent, its own MCP servers, its local paths, presence | `/d/<device-id>/settings` — served by the hub to that device's session or its owner, the same page whether opened in a phone app, DocaDesk, a watch's phone, or a browser |
| **Hive** | accounts, levels, grants; providers and keys; the harness's defaults (model, fallback, limits, approval policy); MCP registry; skills, specialists, recipes, packs (§2.4); services and models catalogues; backups and updates; guards; branding | Settings, as today — host / owner rights |
| **Person** | profile, password, sessions, their own `approve:` grants, their memory (auth phase 3), their default device for questions | Settings → Account |

What it takes:

- **A browser is a device.** A signed-in browser gets a device record the first time (a `browser`
  kind, named after the user agent, revocable like any other), so `/d/<id>/` exists for it and the
  panel reads its look and tabs from there. The phone app and DocaDesk already open the panel in a
  WebView and are devices; they keep their native settings only for what the WebView cannot do
  (connection, certificate, background push, the wear bridge).
- **One settings schema** (`modules/settings-schema.js`): each key with its home (device | hive |
  person), type, default, range, hint, who may change it, and whether the agent may propose it. The
  forms render from it (the way `HARNESS_PARAMS` already renders ⚙), `settings.SETTABLE` and the
  rights table derive from it, and a test fails on a key that is read but not declared. This is what
  makes settings upgradable: a new version adds a key with a default and a migration step, instead of a
  form somebody forgot.
- **Layering:** hive default → person override → device override, resolved by one function the panel
  and the clients both call (`GET /api/v1/settings/effective`). Migration: today's prefs values become
  the hive defaults; nothing changes visibly until a device overrides one.
- **The Settings tab shrinks** to the hive's settings; a "This device" entry opens `/d/<id>/settings`;
  the Wearables sub-tab becomes the watch's device page.

---

## 2. The coherence review — four questions for every part

Every part of the platform is held to four questions, asked 2026-10-04:

1. **Upgradable?** Can a new version change it without breaking what a person has, and without them
   redoing anything?
2. **Necessary?** Would anyone miss it? Is it a second way of doing what another part does?
3. **Repeatable without the thinking?** Once the agent has done something — researched it, set it up,
   got it working — can it do it again quickly, reliably, the same way, without paying for the
   research and the reasoning a second time?
4. **Portable?** Can whatever was made — a tool, a skill, a specialist, a server definition, a
   procedure — be exported from this instance and imported into another?

### 2.1 Where the platform stands

| Part | Upgradable | Necessary | Repeatable | Portable |
|---|---|---|---|---|
| Harness (agent loop, params) | ✓ params have defaults and a box; contracts learned per provider | ✓ | — (it is the thinking) | params: as a pack (§2.4) |
| Skills | ✓ adapt/restore, audit | ✓ | **partly**: prose the model reads — it still thinks every time | ✓ import from five harnesses; export: ✗ |
| Specialists (agent defs) | ✓ files over built-ins | ✓ | partly (same as skills) | ✓ markdown in/out |
| MCP servers | ✓ registry, timeouts as settings | ✓ | ✓ (a server is a repeatable tool) | export to other harnesses' configs ✓; to another DOCA ✗; secrets stripped ✓ |
| Memory | ✓ (SQL, rules editable) | ✓ | it is the *knowing*, not the doing | ✗ export/import |
| Projects, checkpoints | ✓ | ✓ | commands detected ✓ | ✗ (a project is a folder) |
| Canvases, plan docs | ✓ | ✓ | — | ✗ |
| Services / installs catalogue | catalogue in code — a new service needs a release | ✓ | ✓ (installs are catalogue entries, not commands) | ✗ |
| Device console / macros | ✓ | ✓ | ✓ (macros) | ✗ |
| Levels, grants | ✓ (SQL, migrations) | ✓ | — | ✗ |
| Prefs | **✗ no schema, no migrations** — a renamed key is a lost setting | ✓ | — | backup only |
| Data | ✓ data format + migrations in restore | ✓ | — | ✓ backups, restored across machines |
| Client protocol | ✓ versioned, caps negotiated | ✓ | — | — |
| Releases | ✓ worktrees, roll back in 90 s | ✓ | — | — |

### 2.2 Necessary? — what to retire or merge

- **Three chat surfaces drawn three ways** (floating chat, console, Projects chat) already share the
  event sink and queued send; finish the job: one chat component with three sizes. The floating chat's
  gateway and `claude`-CLI paths (`modules/chat.js`) are from the OpenClaw era — keep only if a
  non-built-in default harness is still a real case; otherwise retire them.
- **`jobs.js`** (in-memory, capped, `GET /jobs/:id`) next to work chats, missions and shell jobs:
  three "background thing" records. Fold into the `runs` table (§5 of permissions.md).
- **The Wearables sub-tab** becomes the watch's device page (§1).
- **OpenClaw's group** (Skills/Snapshots/Setup/Config) stays only while OpenClaw is installed — already
  the rule; nothing new.
- **Legacy `/api/*` vs `/api/v1`**: the panel speaks the legacy routes, devices speak v1. Not a
  retirement — but every *new* capability lands in v1 first so a client can have it.

### 2.3 Repeatable without the thinking — recipes

The biggest coherence gap. A skill is prose: the model reads it and reasons through it again, every
time, at full price, and a weaker model gets it wrong. What is wanted is the thing a person does after
solving a problem once: **write the script.**

**A recipe** is a recorded, parameterised sequence of tool calls with checks:

- **Made from a turn that worked**: "Save as recipe" on a finished turn (or the agent's `recipe_save`)
  takes its tool calls, lifts the values that varied into parameters (`{path}`, `{version}`), keeps
  the checks that proved it worked (an exit code, a file, an HTTP 200), and drops the dead ends.
- **Run without a model** (`recipe_run`, a button, a schedule, a device macro): each step is a tool call
  through the same gate, permits and approvals as the agent's; a failed check stops it and says which
  step. A model is used only to fill parameters from a sentence, and only the cheapest one.
- **Escalates when the world changed**: a step that fails hands the run, its log and the recipe to the
  agent, which repairs it and proposes the new revision — so recipes get more reliable, not stale.
- **Referenced by skills**: a skill says *when* and *why*, its recipe says *exactly how*.

This is what "repeat this action minus the thinking, research and setup" means in code. Close cousins
already exist (device macros, install proposals that never take a command, `project run` named
commands) and should become recipes or call them.

### 2.4 Portable — one pack format

Export/import exists piecemeal: specialists as markdown, skills imported from other harnesses, MCP
definitions exported to other harnesses' configs, backups whole. Wanted: **one pack format** for
everything a person or an agent makes.

- **`.dpack`**: a zip with `pack.json` — `{ kind, name, version, description, requires: { tools,
  mcp, services, models, level, os }, files }` — for skills, recipes, specialists, MCP server
  definitions (secrets stripped, asked for on import), canvases, memory rules, levels, device console
  layouts, faces (§5), harness parameter presets, editions (§6). **Its contents are in other tools'
  native formats wherever one exists (§9)** — a pack is an envelope, never a dialect: unzip it and a
  skill is a `SKILL.md` folder Claude Code reads, a specialist is a subagent markdown, an MCP server is
  an `mcpServers` entry. `pack.json` only adds what no standard carries (version, requirements).
- **Import is a dry run first**: what it adds, what it needs that this hive lacks (a tool, a model, a
  service) and offers to install through install proposals, what it would overwrite.
- **A library** in Settings lists installed packs with versions; packs can be sent to another hive
  (hub-to-hub over the tailnet, or a file), and later published to a registry.
- **Agents make packs too**: whatever the agent builds (a skill, a recipe, a specialist) is a pack the
  moment it is saved, so it travels without a separate export step.

---

## 3. What is missing — against the other harnesses

Compared 2026-10-04 with OpenDots (CopilotKit), OpenAI's agent/Dots, Claude Code and Cowork, Codex,
Cursor, OpenHands, Goose, OpenClaw and browser-use. DOCA already has things several of them lack
(devices and wearables as first-class clients, levels and grants, approvals on any device, the airlock,
the hub-and-clients protocol, checkpoints, the plan-before-work charter). The big gaps:

1. **Browser control** — the largest missing capability. Two forms, both wanted:
   - **The agent's own browser**: a Chromium per agent (or per specialist) driven over CDP — navigate,
     read the page as an accessibility snapshot, click and type by element reference, screenshot,
     extract, tabs, downloads — with a persistent profile per agent, and a **live view in the panel**
     (CDP screencast) the person can **take over** and hand back (OpenDots, OpenAI's agent, browser-use
     all have this). Page text goes through the airlock like any outside text; submitting forms, paying
     and logging in ask first; credentials come from a vault, never the transcript.
   - **The person's own browser** on a client: a DocaDesk/desktop extension or CDP attachment, so "fill
     this form in my browser" acts in the browser they are using — consent per site, visible on screen.
   - Quick path while it is built: the Playwright MCP server as a catalogue entry.
2. **A computer per agent (sandbox)** — files, terminal and browser in an isolated container per
   specialist, persistent across restarts, off by default (OpenDots' "Dot computer", OpenHands'
   runtime). Already the #1 gap in TODO's "Where this harness stands" §1.
3. **Schedules and triggers** — recurring tasks ("every morning at 8"), and events (a file changed, a
   webhook, a device event, a mail arrived) that start a recipe or a turn, visible in the queue fold,
   per person, pausable. Only backups run on a schedule today.
4. **Channels** — Slack, Telegram, email, WhatsApp, Matrix: a message there is a turn, the answer goes
   back there. Each channel is a client kind on the hive (§4), not a special case. OpenClaw and
   OpenDots both have them.
5. **Realtime voice** — speech-to-speech calls with barge-in, the agent working in the background
   while it talks (OpenDots' call + delegated compute). DOCA has a call mode over STT/TTS; upgrade it.
6. **Pages** — documents with an editor and a chat per page (OpenDots' Spaces/Pages). DOCA has plan
   docs, canvases and Projects' markdown preview: a "Pages" space that is a Projects folder of markdown
   with the chat beside it may be all it takes.
7. **Open protocols** — speak **AG-UI** (so any CopilotKit/AG-UI front end is a client), **A2A** for
   agent-to-agent, and **MCP Apps** for tools with UI; DOCA is an MCP client and should also be an MCP
   *server* exposing the hive to other harnesses.
8. **Learning that closes the loop** — "this conversation becomes a skill or a recipe", proposed and
   reviewed (OpenDots' Automatic Learning). DOCA's agent writes skills; add the review queue and recipes.
9. **Parallel work in isolation** — several work chats on one repo, each in its own git worktree
   (Codex/Cursor cloud tasks), merged by a person.
10. **Connectors with OAuth** — Google, GitHub, calendars, mail as accounts with a vault, scoped per
    agent and per level.
11. **Evaluation and tracing** — TODO's "Where this harness stands" §4; **retrieval** — §3.

---

## 4. Joining the hive

What "install a client and it becomes part of DOCA" needs:

1. **A client for every device**: DocaDesk (Windows), a Linux and a macOS desktop client (Avalonia over
   `DocaDesk.Core`, or one cross-platform core), DocaMobile (Android), DocaWear, an iOS client later, a
   browser-only web client (a browser is a device, §1), and headless agents (a server, a Raspberry Pi,
   a channel adapter).
2. **One client core per platform**: the `/api/v1` protocol, pairing, the push loop, presence, the
   offline queue, the device page, the face (§5) — and **the tool families it lends the hive** (files,
   shell, screen, input, apps, browser, camera, microphone, sensors) as an MCP server the hub connects
   to, the way DocaDesk already hosts one. "Device as hands" stops being DocaDesk's alone.
3. **Pairing in one step**: scan a QR or open a link on the device; it is bound to the signed-in
   person, its caps declared, its families offered for consent on the device itself. Discovery on the
   tailnet (or mDNS on a LAN) so "find my hub" needs no address typing.
4. **Consent and policy**: per device and family on the device; per level on the hub (permits.js); a
   device's tools obey the same approvals, shown on the device that runs them.
5. **Routing**: which device runs a tool — the asking device by default (`placeBlock`), named when not.
6. **Updates**: clients learn the hub's version and update themselves from the hub's release channel;
   the hub keeps its 90-second rollback.
7. **Sync of packs** (§2.4) to the devices that need them (a watch's face, a desk's recipes).
8. **Later**: more than one hub (a hive per home, per office) federated; a hosted hive per tenant.

---

## 5. A face — the hive's presence on any screen

An interface that can be switched on on any client or on the host (a device setting, §1): a **face**
that shows what the agent is doing — listening, thinking, working, speaking, waiting for you — in the
style of protolab.tech.

**The look** (from protolab.tech's own page): near-black `#050507`, ink `#e8edf2`, dim ink `#707a85`,
accent cyan `#57c9c2` and steel `#6f8aa3`; Space Grotesk for words, JetBrains Mono for the small HUD
labels in caps and brackets (`[ THINKING ]`, `shell · git status`); a faint scanline grain and a
vignette. No cartoon: **a field of luminous dots** that drifts like noise when nothing is happening and
**coalesces into a face** — two eye clusters and a mouth line — when the hive pays attention. Order out
of noise is the whole idea, and it is simple enough to draw on a watch.

**States**, driven by events that already exist (presence, `agent.turn`, `agent.tool`, approvals,
the voice call's audio levels):

| State | The dots |
|---|---|
| idle | slow drift; the face half-formed; a blink every few seconds |
| listening | the face forms; the dots pulse with the microphone level |
| thinking | eyes narrow; dots orbit slowly around the face |
| working | a ring of dots turns; the tool's name in the mono HUD |
| speaking | the mouth line moves with the speech audio |
| asking you | eyes up; the accent turns amber until answered |
| error | a red flicker, then back to idle |
| quiet hours | dimmed, no motion |

**Editable, and a pack**: a face is a small JSON — palette, dot count, eye and mouth geometry,
expression curves per state, HUD on/off — exported and imported as a `.dpack` (§2.4), chosen per
device. Drawn with a 2D canvas (WebGL optional where it is cheap), so it runs on an old tablet, a TV in
kiosk mode (`/face`), DocaDesk as an overlay, the panel's corner in place of the ⬡ button, and a watch.

---

## 6. Editions, and an order

**The product sold** will be a narrower edition — a lower level, chosen skills and recipes, chosen
visible parts, a face — which is a pack (§2.4) built on what exists: branding, levels, hidden tabs.
Until then, every capability first.

**Order** (each step is releasable on its own; §7–§9 apply to every step):

- **P0 — foundations**: the settings schema and per-device settings (§1); the pack format and a
  library (§2.4); recipes (§2.3); browser control, the agent's own browser first (§3.1).
- **P1 — the hive**: the client core with tool families and one-step pairing (§4.2–4.3); a Linux
  client; schedules and triggers (§3.3); a computer per agent (§3.2); the face (§5).
- **P2 — reach**: channels (§3.4); realtime voice (§3.5); AG-UI, A2A, DOCA as an MCP server (§3.7);
  pages (§3.6); parallel worktrees (§3.9); OAuth connectors (§3.10); evaluation, tracing, retrieval;
  a pack registry; federation and hosting (§4.8).

---

## 7. The host runs on any major OS, up to what the hardware can do

Decided 2026-10-04: **the platform is OS-agnostic, at least on the host side** — Linux, Windows and
macOS each host DOCA up to their hardware's capabilities. Today it is developed on Linux and tested on
a Windows box; macOS has never been run (there is no `darwin` branch anywhere in `modules/`).

**The rule:** a capability probes for what it needs and degrades by saying so — it never assumes a
POSIX box, a Linux service manager, an NVIDIA card or Docker (the Models section's rule, `AGENTS.md`,
made universal). Every OS-specific piece sits behind one module with a per-OS implementation and a
test that runs the parser against captured output from each OS.

| Area | Linux | Windows | macOS | Today |
|---|---|---|---|---|
| Shell for agent and installers | bash | PowerShell | zsh/bash | ✓ `shell.js` (macOS: untested) |
| Start at boot | systemd unit | Task Scheduler / a service | launchd agent | **Linux only** (`startup.js`) |
| GPU readings | nvidia-smi, rocm-smi, Intel | nvidia-smi, WMI/DXGI | `ioreg`/`powermetrics` (Apple GPU, unified memory) | **nvidia-smi only** |
| Containers (services, sandbox) | Docker / Podman | Docker Desktop / WSL2 | Docker Desktop / Colima / OrbStack | Docker only, Linux-shaped paths |
| VMs | libvirt, VirtualBox | Hyper-V, VirtualBox | UTM / Parallels / VirtualBox | libvirt, VirtualBox |
| A computer per agent (§3.2) | container / namespaces | Windows Sandbox / WSL2 / container | VM (Virtualization.framework) / container | none |
| Local inference | llama.cpp, Ollama, vLLM | llama.cpp, Ollama | llama.cpp (Metal), Ollama, MLX | llama.cpp, Ollama (paths Linux-shaped) |
| Browser for the agent (§3.1) | Chromium | Chrome/Edge | Chrome/Chromium | none |
| Certificates, listen on tailnet | ✓ | ✓ | untested | `https-cert.js`, `listen.js` |
| Paths and file manager roots | `$HOME`, `/media`, `/mnt` | user profile, drive letters | `$HOME`, `/Volumes` | roots Linux-shaped |
| Installer | `run.sh` | `.cmd` wrappers by hand | none | Linux script |

What it takes: **a CI matrix** (GitHub Actions: ubuntu, windows, macos) running `npm test` and a
headless browser smoke on each; per-OS probes for the rows above; an installer per OS (a script that
installs Node, the panel, the boot entry and the certificate, and prints the pairing QR); and a
**capabilities report** (`GET /api/host/capabilities`) that says what this host can and cannot do, so
the panel greys out what is absent instead of failing in its name.

---

## 8. Experiments — innovative, with their drawbacks found before they ship

An edge needs new approaches; every new approach needs its pull-backs measured. Decided 2026-10-04:
experiments are welcome, and each one is run the same way.

- **Behind a flag, off by default** (`experiments.<id>` in the settings schema, listed in Settings →
  Experiments with what each does and costs). Switching it off is a settings change, never a release —
  the rule specialists already follow (`agents.enabled`).
- **Written down first** (`docs/experiments/<id>.md`): the hypothesis, what is measured and how,
  the cost (tokens, latency, money, complexity), the risks (security, privacy, reliability, lock-in,
  OS coverage), and how it is rolled back with nothing left behind.
- **Measured, not admired**: an eval set or a benchmark, run before and after (the airlock's guard
  eval and `db-bench` are the shape); the result goes in the same file.
- **Graduates or dies**: kept only when the numbers say so; then the flag goes, or the code does.
- **Candidates now**: recipes repaired by the agent (§2.3); speculative decoding / a draft model for
  local inference; the face reacting to audio (§5); learned contracts shared between hives; agent-made
  tools hot-loaded as MCP servers; a vision pass on screenshots for browser control; on-device small
  models for routing; packs published to a registry.

---

## 9. Cross-compatible assets — import from anywhere, export to anywhere

Decided 2026-10-04: **exportable and importable assets are prioritised for cross-compatibility.** A
skill made in DOCA must be usable in Claude Code, and one made there usable here, with nothing lost
that both can express. The pack (§2.4) is an envelope around native formats:

| Asset | Native format exported | Imported from |
|---|---|---|
| Skill | Agent Skills folder (`SKILL.md` + files) — Claude Code, Codex skills | ✓ Claude Code, plugins, commands, Codex prompts, Gemini CLI, Cursor rules (2.128) |
| Specialist | Claude Code subagent markdown (frontmatter `name`, `description`, `tools`, `model`) | ✓ ours and Claude Code's (`agent-import`) |
| MCP server | the `mcpServers` JSON every MCP client reads; Claude Code / Cursor / Codex config entries | ✓ ours; other configs to add |
| Rules / instructions | `AGENTS.md` (and `CLAUDE.md`, `.cursor/rules/*.mdc`) | to add |
| Recipe | the recipe JSON **and** a runnable script per OS (bash / PowerShell) and an Agent Skills `scripts/` entry | — |
| Prompt / persona | markdown | ✓ (`persona.md`, `human.md`) |
| Face, layout, preset, edition | small JSON with a published schema | — |
| Memory | JSONL of entries (key, value, category, provenance) | to add |
| Conversation | JSONL transcript in the OpenAI message shape | to add |

Rules: a field another tool does not understand goes into frontmatter it ignores, never into the body
it reads; secrets never leave in an export; a lossy conversion says what it dropped (the skill
adapter's rule); each converter has a round-trip test (export → import → identical) and a fixture from
the other tool. Interoperable tool protocols follow the same rule: MCP (client and server), AG-UI,
A2A.
