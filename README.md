# OpenClaw Dashboard

Web-based control panel for managing the **OpenClaw** AI agent stack.

## Features

- **Service Control** — Start / Stop / Restart the Docker Compose stack, plus **Update** (pull the newest stack definition and images, then recreate the containers) with streamed output
- **Live Logs** — SSE-streamed container logs with auto-scroll
- **System Stats** — 14 toggleable sidebar stats (CPU %, per-core, temp, freq, load 1/5/15, RAM, swap, per-mount disk usage, disk I/O rate, network rate, uptime, processes, GPU core + extended metrics). Main stats enabled by default; everything else can be switched on in Settings → General
- **API Keys** — Manage LLM endpoints: one click for the ones DOCA knows (llama.cpp, vLLM, LM Studio, OpenAI, Groq, Anthropic…), or any name and base URL by hand
- **Skills** — Install, remove, enable/disable workspace skills with detail view
- **Snapshots** — Create and restore full agent snapshots
- **Setup Scripts** — View and edit setup/restore shell scripts
- **Config Editor** — Multi-file editor with favorites, per-type validation. A file that does not exist yet opens empty and is created on save, directories and all
- **Paths** — Settings → System lists every path DOCA depends on with its current value, where that value came from (saved here / environment / default) and whether it is actually there, plus a one-click **Create** for anything missing
- **File Manager** — Browse, edit, copy/cut/paste, rename, upload/download files with drag & drop
- **Harnesses** — One line per agent runtime on the Controls page. Ships with the **DOCA Harness** (built in, no install) and knows 14 others — OpenClaw, Claude Code, Codex CLI, Gemini CLI, Copilot CLI, Cursor CLI, Amp, Qwen Code, OpenCode, Crush, Goose, Continue, OpenHands, Aider — installable with one click from the catalog. Anything else can be added as a custom harness. The default harness is what the chat panel and the Harness tab talk to
- **DOCA Harness** — The resident agent: structured memory, tool calling and rolling summarisation against any OpenAI-compatible provider (Ollama, llama.cpp, OpenAI, Anthropic, Google, Groq, OpenRouter, Mistral, DeepSeek, xAI, Together, Cerebras). Model and generation parameters are set inline from the ⚙ on its row. It knows where it is running (paths, providers, MCP servers, this panel's own version and source), keeps its memory by rules that it and you can both rewrite, and can suggest settings changes that only take effect when you accept them — under standing safety rules that ship in the code and cannot be edited away
- **MCP Servers** — Register Model Context Protocol servers (a command over stdio, or a URL), start/stop/restart them and see the tools each one offers. A running server's tools are handed to the **DOCA Harness** alongside its built-in ones as `mcp__server__tool`, each switchable in the harness ⚙. One click also writes them into the config Cursor, Claude Code or a project `.mcp.json` reads
- **Virtual Machines** — Guests on this host through whichever hypervisor CLI is installed — libvirt/KVM (`virsh`) and VirtualBox (`VBoxManage`). Start, stop (asks the guest), reboot, force off, resume, and the VNC/SPICE/RDP address to paste into your own viewer
- **AI Tools** — Whisper / Faster-Whisper (STT), Kokoro / Piper (TTS), Stable Diffusion / ComfyUI (image) with auto-detection, one-click install (⬇) and per-tool config (⚙)
- **Inference Services** — Docker-based Whisper STT, Kokoro TTS, vLLM, Stable Diffusion and ComfyUI backends with GPU assignment, image-presence check and one-click pull
- **System Tools** — Auto-checks 15 dependencies (Node, Docker, Compose, Git, Python, pip, Ollama, ffmpeg, curl, nvidia-smi, huggingface-cli, llama-server…) with ⬇ Install for anything missing and ↻ Update to re-run the installer on anything already present
- **Agent Chat** — Floating chat panel wired to the default harness; with an external harness selected it uses the OpenClaw Gateway API when enabled and falls back to the `claude` CLI. Full-screen sheet on phones
- **Start at Boot** — One toggle in Settings installs DOCA as a systemd service (`./run.sh enable` does the same from a shell), so the panel survives reboots and `⟳ Restart` is handled by a real supervisor
- **Mobile** — Fully responsive: bottom tab bar on phones (respects tab visibility settings), safe-area/notch support, reflowed tool rows and settings grids, full-screen chat and modals, coarse-pointer touch targets

## Quick Start

```bash
./run.sh
```

`run.sh` installs dependencies on first run, loads a `.env` file if you have one, and starts the
panel — on **https://localhost:4242** by default. Accept the self-signed certificate
in your browser, or use `curl -ksS https://localhost:4242/api/v1/` from a shell.
Plain HTTP is only a boot-time fallback if certificate setup fails; it is not a
second listener or redirect. `-sS` keeps curl quiet while still showing connection errors.

On Windows, or anywhere without a POSIX shell, use `npm install` then `npm start` instead: that is
all `run.sh` ultimately does. Note that the panel manages Docker, systemd and a set of Unix CLIs,
so Windows is a fine place to develop it but not to run it in earnest.

To have it come back after a reboot, either tick **Settings → General → Start at Boot** in the
dashboard or run `./run.sh enable` on the host; both install the same systemd unit.

## Linking the Chat to OpenClaw Agent

Out of the box the chat panel talks to the built-in DOCA Harness. Once you switch the default
harness to OpenClaw (Controls → **Agent Harnesses**), the panel goes through OpenClaw instead.
To have it use the OpenClaw Gateway API rather than the `claude` CLI, add this to
`~/.openclaw/openclaw.json`:

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}
```

If you use auth, ensure `gateway.auth.token` (or `gateway.auth.password`) is set. The dashboard reads the config and uses the Gateway’s `/v1/chat/completions` endpoint. If the Gateway is unavailable, it falls back to the `claude` CLI.

## Deployment Setups

### 1. Dashboard on host, OpenClaw in Docker (most common)

The dashboard runs as a Node.js service on the host. OpenClaw runs in Docker with its gateway port published (e.g. `18789:18789`).

```bash
# .env or systemd override
PORT=4242
COMPOSE_DIR=/home/youruser/openclaw
CONFIG_PATH=/home/youruser/.openclaw/openclaw.json
SKILLS_DIR=/home/youruser/.openclaw/workspace/skills
WORKSPACE_DIR=/home/youruser/.openclaw/workspace
SETUP_DIR=/home/youruser
SNAPSHOT_DIR=/path/to/snapshots
# No OPENCLAW_GATEWAY_URL needed — 127.0.0.1:18789 is used by default
```

The chat panel will reach the gateway at `http://127.0.0.1:<port>/v1/chat/completions` using whatever port is declared in `openclaw.json` (default `18789`).

---

### 2. Both dashboard and OpenClaw in Docker (same Compose network)

Add the dashboard as a service alongside OpenClaw. The gateway is reachable by its service name — override the URL with `OPENCLAW_GATEWAY_URL`.

```yaml
# docker-compose.yml (excerpt)
services:
  dashboard:
    build: ./openclaw-dashboard
    ports:
      - "4242:4242"
    environment:
      COMPOSE_DIR: /app/openclaw            # mount your openclaw dir here
      CONFIG_PATH: /app/.openclaw/openclaw.json
      SKILLS_DIR: /app/.openclaw/workspace/skills
      WORKSPACE_DIR: /app/.openclaw/workspace
      OPENCLAW_GATEWAY_URL: http://openclaw-gateway:18789
    volumes:
      - /home/youruser/openclaw:/app/openclaw
      - /home/youruser/.openclaw:/app/.openclaw
```

---

### 3. Running as a systemd service (host install)

Tick **Settings → General → Start at Boot**, or on the host:

```bash
./run.sh enable     # write /etc/systemd/system/openclaw-panel.service and enable it
./run.sh status     # installed? running?
./run.sh disable    # stop starting at boot (a running panel is left alone)
```

Both routes run the same code, so the toggle and the CLI cannot drift apart. The generated unit
runs `run.sh` as the user who enabled it, with `Restart=always` and `StartLimitIntervalSec=0` —
without the latter, the default start limit (5 attempts in 10s) lets a brief crash loop take the
dashboard down for good.

Environment overrides go in a `.env` file next to `server.js`, which `run.sh` loads before
starting; the unit does not have to repeat them:

```bash
# .env
PORT=4242
COMPOSE_DIR=/home/youruser/openclaw
CONFIG_PATH=/home/youruser/.openclaw/openclaw.json
```

Enabling the service does not steal the port from a panel you already started by hand — systemd
takes over at the next boot, or immediately if you stop that process and
`sudo systemctl start openclaw-panel`.

`⟳ Restart` in **Settings → Updates** works by exiting the process, so it relies on
`Restart=always` to bring the panel back — and so does the restart you do after applying an
update. Without a supervisor DOCA detects that and spawns its own detached successor instead
(its boot output goes to `.doca/restart.log`), but letting systemd own the lifecycle is more
reliable: it also recovers the panel after a crash or a reboot.

---

## Harnesses

A *harness* is whatever agent runtime DOCA hands your prompts to. The **Agent Harnesses** card at
the top of the Controls page lists one line per harness; exactly one is the default (`●`), and both
the floating chat panel and the **Harness** tab use it.

- **⬇ Install a harness** opens the full catalog. Installing runs the vendor's own installer
  (`npm i -g …`, `pipx install …`, a `git clone` + `docker compose` for OpenClaw) and streams the
  output, asking for a sudo password only when the command needs one.
- **Add your own harness** — name, command, optional install command — registers anything the
  catalog does not know about, including your own scripts. Custom harnesses can be deleted; known
  ones cannot.
- **⚙** on an external harness sets its launch command, model flag, config file path and extra env
  vars. **▶ Open** runs it in a PTY on the Harness tab.

### The built-in DOCA Harness

The default on a fresh install, and the one harness that needs nothing installed. It is a plain
agent loop over any **OpenAI-compatible** `/chat/completions` endpoint. The endpoints it already
knows are Ollama, llama.cpp, vLLM and LM Studio locally, and OpenAI, Anthropic, Google, Groq,
OpenRouter, Mistral, DeepSeek, xAI, Together and Cerebras hosted — but that list is a set of
shortcuts for default URLs, not a restriction: **Settings → API Keys → + Add provider** takes any
name and base URL, and running a known server on a different port is just a base URL saved there.
Keys come from the same screen (or the matching env var; local servers need none), and the model
dropdown is populated live from the provider.

Both the Harness and floating chat show one current activity line. Click
**Thinking** to watch the provider's reasoning arrive in a scrollable preview
about ten lines tall. Finished activity collapses to a thought/command summary;
a reply without thinking or tools shows only the answer. Saved conversations
keep their thinking previews. This supports `reasoning_content` and `<think>`
blocks when the provider supplies them.

**Three levels, one workspace.** The floating chat always reaches a persistent
**Orchestrator** — your main contact for goals, decisions and results. Selecting
another conversation in the Harness never redirects it. Device messages without
an explicit conversation id reach the same Orchestrator.

- **1 · Orchestrator:** coordinates the work and keeps a small context. It has
  coordination, memory, proposal and communication tools; execution and MCP
  tools belong in work chats. It receives at most ten brief work rows and ten
  unread reports per step. `work_chats` retrieves more, including full histories,
  when needed. Its recent history is capped at 20 rows with earlier summarisation;
  the current turn stays whole. It injects at most three memory entries.
- **2 · Work leader:** owns a work chat, its detailed transcript and its plan.
  The Orchestrator can create one and start or continue work in the background.
  **+ Work** opens one for direct conversation; **+ Plan** marks a planning chat.
  Work leaders can dispatch the existing specialists when the Specialists
  switch is on. They cannot create another layer of work leaders.
- **3 · Specialist:** handles a focused mission using its saved role and tool
  allowlist, plus report and plan tools. Opening it directly does not grant it
  general tools, and it cannot delegate further. The roster defines capabilities;
  the workspace tree and mission's **Chat** button open actual conversations.

You can talk directly to every level in the **Harness**. Direct interventions,
results, failures and plan changes are recorded for the superior and Orchestrator.
Reports become model context on the superior's next turn; viewing the Harness
does not launch model calls. A work leader can inspect a specialist's result with
`agent_results`, with `wait:true` to wait up to 30 seconds for its own specialist
without extra model calls. A result received within that wait lets the leader
continue its turn. Work outliving the wait is reported for later continuation;
updates never start an automatic chain of model calls. One shared lock protects each transcript
across browser, device and background turns. Stop the running turn before intervening.

**Plans.** Every conversation has a Plan panel. Agents use `work_plan` to read,
draft, propose and record step progress. You can edit a draft and approve or reject
the exact proposed revision. Changing its scope creates a new draft; marking
progress preserves the approved scope. Approval records your decision and does
not start execution. Tell the responsible chat to proceed when ready. Specialist
missions also retain their existing `mission_plan` checklist and device progress.

**Archive and recall.** Archive keeps the transcript, plan and profile. Enable
**Show archived chats**, open a chat and **Recall** it to continue. A running chat
or a leader with running specialists cannot be archived. Clearing the main chat
archives the old Orchestrator, carries its unread reports and work ownership to
a new one, and retains the old transcript. Recalling an old Orchestrator opens it
as a work chat. Existing conversations remain available; old specialist sessions
derive their profile and parent from their mission records. Missing definitions
fall back to reporting only. Interrupted work reads as paused after a restart.

The same workspace is served to the phone and desktop WebViews. This does not
add a separate native phone UI. Shared durable memory remains one store; specialist
memory is still opt-in. **Context** displays the selected conversation's actual
profile and estimated tool/history cost.

**Work-chat tools.** `shell`, `read_file`, `write_file`, `list_dir`, `system_status`, `http_fetch`,
`memory_write`, `memory_search`, `memory_forget`, `memory_rules_write`, `settings_read`,
`settings_propose`, plus whatever any running MCP server offers. File access is confined to
`FM_ALLOWED_ROOTS`, writes leave a `.bak`, and each tool can be switched off individually in ⚙.

**Standing rules.** Every turn opens with a charter that lives in `modules/harness/providers.js`:
look before you touch, one change at a time, follow the conventions already in the file, leave a way
back, nothing destructive that was not asked for, settings go through the user, secrets stay where
they are, report what actually happened. It is **not** in the prefs file and the ⚙ panel cannot edit
it — an agent that can rewrite everything in prefs must not be able to rewrite the rules about it.
The system prompt you *do* own is added after it. Read the whole thing, exactly as sent, with
**Context** on the Harness tab.

**Awareness.** After the charter comes the machine, read fresh each turn and cheap enough to be:
host and hardware, the time and zone, this panel's version, port, pid, source directory, prefs and
data locations, every managed path with where its value came from and whether it exists, which
providers have a key, and which MCP servers are running with how many tools. Live figures that cost
a subprocess — docker, GPUs, disks — stay behind the `system_status` tool.

**Context preflight.** Set the primary model's **Context window** and, independently,
the served context window on each fallback row in the harness configuration. A specialist
can declare `contextWindow` in its definition; a different specialist model does not inherit
the primary model's window. Zero or an omitted fallback window means unknown. Before sending,
DOCA estimates text, reasoning and tool-schema tokens plus the configured reply cap, skips
entries that exceed their declared window, and names the setting and model in the warning.
This is a character-based estimate, not a tokenizer measurement or a guarantee that images
will fit; image tokens and an uncapped reply remain provider-dependent.

**Mission completions.** Finished and failed missions appear in the originating
conversation's next model request, in the panel readings after the transcript. A successful
reply acknowledges those notices so later turns do not repeat them; a failed request leaves
them pending. Older missions without a conversation recorded can notify the next orchestrator
conversation. This does not wake an idle agent; device completion events still arrive independently.

**Memory** is structured in four layers, all under `DOCA_DATA_DIR/harness/`:

| Layer | What it holds |
|---|---|
| Transcript | Every message and tool result of a conversation, appended to `sessions/<id>.jsonl` |
| Rolling summary | Once a conversation passes *Summarise after*, the older half is folded into prose notes so the context window stays bounded without losing the thread |
| Durable memory | Keyword-searchable facts the agent chose to keep (or you added by hand), carried into **every** new conversation |
| Memory rules | The categories facts are filed under and the rules for writing them — in context every turn, and editable by the agent (`memory_rules_write`) as well as by you (**Rules** on the Harness tab) |

The durable layer is why a fresh conversation still knows how your machine is set up. You can read,
pin and delete entries from the Memory panel on the Harness tab; **Rules** opens the filing system
itself, with a one-click return to the shipped defaults.

**Settings, with your consent.** The agent can read every setting it is allowed to touch
(`settings_read`) and suggest changes (`settings_propose`), but it cannot apply one. A proposal
appears in the console as a card with the old and new value of every key and a one-line reason, and
nothing is written until you press Accept. Declining is remembered along with your reason, so it is
not suggested again. What may be proposed is an allowlist of prefs sections in
`modules/harness/settings.js` — paths, harness parameters, model, snapshot, service, voice and VM
settings, theme, sidebar and navigation choices. Anything whose name is a credential is refused
wherever it sits, and the API keys in `openclaw.json`, the MCP server definitions and the custom
harnesses are not on the list at all, because each of those is a command that would later be run.
Accepted changes are written with the same `savePrefs()` the Settings screens use; a path change
says it needs a restart, because it does.

**Parameters** — provider, model, temperature, top-p, max tokens, max tool steps per turn, history
window, summarise-after threshold and the system prompt — live in `.dashboard-prefs.json` under
`harness.config.doca` and are editable from ⚙ without restarting anything.

---

## MCP Servers

The **MCP** tab is a registry of Model Context Protocol servers. A server is either a command DOCA
spawns and talks to over stdio (`npx -y @modelcontextprotocol/server-filesystem /srv`) or a URL it
POSTs to. Definitions are saved in `.dashboard-prefs.json` under `mcpServers`; the processes are not,
so nothing runs until you start it — except servers ticked **Start this server when DOCA starts**,
which come up with the panel and are stopped again when it exits.

Start one and it reports the tools it offers. Those tools are then handed to the built-in DOCA
harness next to its own, named `mcp__<server>__<tool>` so two servers offering `search` cannot
collide, and each one appears as its own switch in the harness ⚙ panel. **Only running servers
contribute tools**: a tool declared to a model has to be callable. A server that declares a tool
read-only (`readOnlyHint`) is shown without the `!` that marks a tool as able to change something.

Servers log to stderr, which is what the **Log** button shows — including the reason a server
refused to start, which is reported in place rather than as a failed request.

The export buttons write the same servers into the files other agents read: `~/.cursor/mcp.json`,
`~/.claude.json`, or a project `.mcp.json`. Only the `mcpServers` key is touched, everything else in
the file is preserved, a `.bak` is kept, and a file that does not parse is refused rather than
overwritten. Codex CLI is the exception — its config is TOML, so DOCA hands you a snippet to paste
instead of rewriting a file and losing your comments.

## Virtual Machines

The **VMs** tab manages guests on this host through whichever hypervisor CLI is installed —
libvirt/KVM (`virsh`) and VirtualBox (`VBoxManage`). Both are optional and each is reported
separately, so a libvirtd you cannot reach does not hide the other's machines, and neither being
installed is stated plainly instead of looking broken.

Per machine: **Start**, **Stop** (asks the guest to shut down), **Reboot**, **Force off** (does not
ask, so it confirms first) and **Resume** for a paused domain. Running machines show their display
address — `virsh domdisplay` covers VNC and SPICE alike, and VirtualBox's VRDE is reported as RDP,
which is what it actually is unless you installed the VNC extension pack. Copy it into your own
viewer; DOCA does not proxy the console.

If libvirt shows no machines, it is nearly always the connection URI: `virsh` defaults to
`qemu:///session`, while machines made with virt-manager as root live in `qemu:///system`. The card
has a field for it.

Commands are run with an argv array and no shell, and a name from the browser is checked against the
machines that actually exist before it is passed to anything.

---

## Environment Variables

Defaults are derived from the current user's home directory (`os.homedir()`, shown below as `~`) so
the dashboard is portable across machines. Override any of them via the environment, or put them in
a `.env` file next to `server.js` — `run.sh` loads that before starting, so a hand start and the
boot service see the same values.

The eight path variables (`COMPOSE_DIR`, `CONFIG_PATH`, `SKILLS_DIR`, `WORKSPACE_DIR`, `SETUP_DIR`,
`SNAPSHOT_DIR`, `SNAPSHOT_SCRIPT`, `RESTORE_SCRIPT`) are also editable in **Settings → System →
Paths**, which shows whether each one exists, where its current value comes from, and offers to
create anything missing. A path saved there beats the environment variable and is picked up on the
next restart; clearing the field hands it back to the environment or the default.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4242` | Server port |
| `COMPOSE_DIR` | `~/openclaw` | Docker Compose directory |
| `CONFIG_PATH` | `~/.openclaw/openclaw.json` | Main config file |
| `SKILLS_DIR` | `~/.openclaw/workspace/skills` | Skills directory |
| `WORKSPACE_DIR` | `~/.openclaw/workspace` | Workspace root |
| `SETUP_DIR` | `~` | Setup scripts directory |
| `SNAPSHOT_SCRIPT` | `~/snapshot-agent.sh` | Snapshot script path |
| `RESTORE_SCRIPT` | `~/restore-agent.sh` | Restore script path |
| `SNAPSHOT_DIR` | `~/openclaw-snapshots` | Snapshot storage |
| `OPENCLAW_GATEWAY_URL` | — | Override gateway base URL (e.g. `http://openclaw-gateway:18789` when dashboard runs in Docker) |
| `DOCA_DATA_DIR` | `<repo>/.doca` | Durable state for the `/api/v1` client layer (devices, outboxes, profiles, media) and the harness (conversations, memory) |
| `DOCA_PREFS_FILE` | `<repo>/.dashboard-prefs.json` | Runtime preferences (theme, visible tabs, harness selection and model parameters) |
| `DOCA_LEGACY_TRUST` | `1` | Allow device pairing and token issuance from the dashboard (Settings → API Keys). Set to `0` to make `npm run token` the only way to mint tokens; the device list stays visible either way |
| `DOCA_STT_URL` / `DOCA_TTS_URL` | — | Override the voice service URLs saved in the dashboard settings |
| `DOCA_FONT` | auto-detect | TTF used for text in server-rendered charts/figures |

## Client API for watches, phones and other thin devices (`/api/v1`)

A device-agnostic, token-scoped API sits next to the dashboard routes and exposes
everything the platform can do to thin clients over the tailnet: capability
discovery, typed metric surfaces, commands, a durable push channel (SSE / poll),
the agent ↔ user prompt cycle (tap / voice / text / image), device profiles,
on-demand sensors, media uploads, agent-shipped artifacts, and server-rendered
graphics for devices without an SVG engine.

- **Developer docs:** [docs/api/](docs/api/README.md) — [getting started](docs/api/getting-started.md), [device app guide](docs/api/device-app-guide.md), [agent guide](docs/api/agent-guide.md), [cookbook](docs/api/cookbook.md) (JS / Kotlin / Swift / Python).
- **Specification:** [PROTOCOL.md](PROTOCOL.md) (normative) and the OpenAPI 3.1 document at [docs/api/openapi.json](docs/api/openapi.json), also served live at `GET /api/v1/openapi.json`.
- **Building a client:** [docs/client-briefs.md](docs/client-briefs.md) — the pattern used to brief coding agents on `DocaMobile` and `DocaWear`, and the starting point for the next client.

**Enrolling devices from the dashboard.** Settings → **API Keys** → *This server — devices*
lists every enrolled device with its scopes, and can pair a new one. **Pair a device** shows a
QR and a six-digit code that the device scans or types; the code is single use, expires in five
minutes, and the device mints its own token, so no long-lived secret is ever displayed in the
browser. **Issue token** is the direct route for agents and headless clients that cannot scan
anything. Tokens can be rotated and revoked from the same panel. Set `DOCA_LEGACY_TRUST=0` to
turn issuing off and use only the CLI below.

```bash
npm run token -- issue --name phone --preset phone      # mint a token from the host (shown once)
curl -ksS -H "Authorization: Bearer doca_…" https://<host>:4242/api/v1/capabilities
npm test                                                 # protocol tests (node --test)
DOCA_ADMIN_TOKEN=doca_… npm run client:demo              # end-to-end walkthrough with the reference clients
npm run openapi > docs/api/openapi.json                  # regenerate the OpenAPI document
```

Reference clients live in `clients/reference/` (`watch.sh`, `agent-sim.js`).

## Project Structure

```
run.sh                      Launcher (deps, .env, node server.js) + boot-service verbs
server.js                   Express orchestrator: wires middleware + routes, starts server
modules/                    Backend feature modules (one per concern)
  paths.js                  Paths (saved > env > default), config registry, create()
  utils.js                  run(), SSE helpers, prefs + config load/save, streamCmd(), detectBinary()
  store.js                  Durable JSON / JSONL store under DOCA_DATA_DIR (atomic writes)
  https-cert.js             Self-signed / Tailscale cert handling
  controls.js               /api/status (Docker, GPU, CPU/RAM + extended stats), start/stop/restart, logs
  stats.js                  Stats registry (STATS_DEFS) + collectors (disk, net, procs, swap, freq…)
  config.js                 Multi-file config + prefs + favorites
  keys.js                   API key / provider management
  skills.js                 Skill install / remove / toggle / detail / search
  setup.js                  Setup script read / write
  snapshots.js              Snapshot create / restore / settings
  files.js                  File manager (list, read, write, upload, paste…)
  chat.js                   Floating chat panel (default harness, Gateway API / claude CLI fallback)
  harness/                  Agent harnesses
    catalog.js              Built-in + 14 known + custom harnesses: detect, install, default, config
    providers.js            Provider presets, default params, and the standing safety charter
    memory.js               Sessions, transcripts, rolling summaries, durable memory, memory rules
    environment.js          What the agent is told about this machine, each turn
    settings.js             Settings the agent may propose, and the proposals awaiting the user
    tools.js                The 12 built-in tools, plus whatever MCP is offering
    agent.js                The turn: runs the agent loop, tool calls, and re-exports its parts
    turn/                   The turn's parts, one idea per file
      params.js             The panel's params, and a profile's on top of them
      prompt.js             The system prompt: instructions, environment, memory, missions
      client.js             What the prompt says about the device the turn came from
      messages.js           The transcript as the model sees it; tool output clipping
      fallback.js           Which rung of the fallback chain to try next
      transport.js          One model request, streamed or whole, with the first-token guard
      summary.js            Folding older turns into the rolling summary
      introspect.js         Preview, breakdown, context and status, without running a turn
    routes.js               /api/harness/* handlers
  mcp/                      MCP servers
    client.js               JSON-RPC 2.0 over stdio or HTTP: handshake, tools/list, tools/call
    registry.js             Server definitions in prefs + the live clients and their lifecycle
    tools.js                Running servers' tools, namespaced for the harness
    export.js               Write the servers into Cursor / Claude Code / .mcp.json / Codex TOML
    routes.js               /api/mcp/* handlers
  vms.js                    Virtual machines via virsh / VBoxManage (list, lifecycle, display address)
  models*.js                Ollama / llama.cpp / HuggingFace / local model managers + AI tools
  system-tools.js           System dependency detection / install (15 tools)
  docker.js                 Docker containers / images / presets
  services.js               Inference service management (incl. image-presence check)
  update.js                 Self-update / restart
  startup.js                Start at boot — reports and drives run.sh enable/disable
  terminal.js               WebSocket PTY terminals
  api-v1/                   Device-agnostic client API (see PROTOCOL.md)
    router.js               All /api/v1 routes (device + agent side)
    devices.js / auth.js / scopes.js   Tokens, pairing, caps, scope matching
    bus.js                  Per-device durable outbox + live SSE fan-out
    sampler.js / surfaces.js / live.js Shared status sampler, typed surfaces, profile-driven pushes
    commands.js / jobs.js   Command registry over existing handlers, long-running jobs
    prompts.js / agent-bridge.js       Interaction state machine, server-side resolver (gateway)
    profiles.js / sensors.js / media.js / artifacts.js / motion.js / render.js
    openapi.js              OpenAPI 3.1 document built from the registries (served at /api/v1/openapi.json)
bin/doca-token.js           Token CLI (npm run token)
clients/reference/          Reference watch client (bash) + agent simulator (Node) + demo
test/                       node --test suites for the protocol and the harness
public/
  index.html                Clean HTML shell
  css/
    variables.css           CSS custom properties
    base.css                Reset, utilities, animations
    layout.css              Header, nav, sidebar, content
    components.css          Buttons, cards, inputs, modals, chat
    sidebar.css             GPU, CPU/RAM (+ logical cores), containers, models
    config.css              Multi-file editor layout
    files.css               File manager + drag-drop upload
    harness.css             Harness rows, catalog modal, agent console
    models.css              Model manager views
    terminal.css            Embedded terminal styling
    responsive.css          Breakpoints 1024 / 768 / 480 px
  js/
    state.js                Global vars (incl. stats/sections state)
    lib/                    Shared helpers with no page of their own
      api.js                apiFetch, sseStream, streamToEl
      html.js               escHtml, jsArg
      status.js             setStatus — the one place a status line is timed out
      dialogs.js            appPrompt / appConfirm / appAlert
      format.js             fmtBytes, fmtNumber, fmtDuration, fmtDate
      output.js / debounce.js / system-tools.js / pty-banner.js
    agent-ui/               The agent transcript, shared by chat.js and the Harness tab
      fold.js / working.js / fold-runs.js   Folds, the per-turn working block, collapsing runs
      think-stream.js       <think> blocks and rendered markdown, live and reloaded
      media.js / context-meter.js / approval.js
    nav.js                  Tab routing + mobile drawer
    sidebar.js              Status polling (GPU, CPU/RAM + toggleable stats, containers, models)
    controls.js             Start / stop / restart actions
    logs.js                 SSE log streaming
    keys.js                 API key management
    skills.js               Skill install / remove / toggle / detail
    snapshots.js            Snapshot create / restore
    setup.js                Setup script editor
    config.js               Multi-file config editor + editable favorites
    files.js                File manager + upload / download / drag-drop
    harness/                Harness settings on the Controls page
      lines.js / params.js / fallbacks.js / probe.js / catalog.js
    harness-console/        The Harness tab
      shell.js / sessions.js / transcript.js / missions.js / agent-editor.js / approval.js
      memory.js / env.js / proposals.js / builtin.js / external.js
    chat.js                 Floating agent chat panel
    models.js / llamacpp.js Model managers + AI tools card + local model files
    docker.js               Docker manager UI
    mcp.js                  MCP servers UI (registry, lifecycle, logs, export)
    vms.js                  Virtual machine UI (per-hypervisor cards, lifecycle, display address)
    services.js             Inference services UI (gear config, image pull)
    terminal.js             Embedded terminal UI
    settings.js             Settings (tabs, theme, stats/sections toggles, boot service) + system tools UI
    paths.js                Settings → System → Paths (edit, create, restart hints)
    themes.js               Theme switching
    sudo.js                 Sudo password prompt helper
    fp.js                   Misc front-panel helpers
```
