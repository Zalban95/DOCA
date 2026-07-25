# OpenClaw Dashboard

Web-based control panel for managing the **OpenClaw** AI agent stack.

## Features

- **Service Control** — Start / Stop / Restart the Docker Compose stack
- **Live Logs** — SSE-streamed container logs with auto-scroll
- **System Stats** — 14 toggleable sidebar stats (CPU %, per-core, temp, freq, load 1/5/15, RAM, swap, per-mount disk usage, disk I/O rate, network rate, uptime, processes, GPU core + extended metrics). Main stats enabled by default; everything else can be switched on in Settings → General
- **API Keys** — Manage provider keys (OpenAI, Groq, Anthropic, Ollama…)
- **Skills** — Install, remove, enable/disable workspace skills with detail view
- **Snapshots** — Create and restore full agent snapshots
- **Setup Scripts** — View and edit setup/restore shell scripts
- **Config Editor** — Multi-file editor with favorites, per-type validation
- **File Manager** — Browse, edit, copy/cut/paste, rename, upload/download files with drag & drop
- **Code Agents** — Detect, install and run Claude Code, Aider, Codex CLI, Gemini CLI, Qwen Code, OpenCode, Crush, Cursor CLI and Goose in embedded terminals
- **AI Tools** — Whisper / Faster-Whisper (STT), Kokoro / Piper (TTS), Stable Diffusion / ComfyUI (image) with auto-detection, one-click install (⬇) and per-tool config (⚙)
- **Inference Services** — Docker-based Whisper STT, Kokoro TTS, vLLM, Stable Diffusion and ComfyUI backends with GPU assignment, image-presence check and one-click pull
- **System Tools** — Auto-checks 15 dependencies (Node, Docker, Compose, Git, Python, pip, Ollama, ffmpeg, curl, nvidia-smi, huggingface-cli, llama-server…) with install buttons for anything missing
- **Agent Chat** — Floating chat panel to talk with the OpenClaw agent (uses Gateway API when enabled, falls back to `claude` CLI); full-screen sheet on phones
- **Mobile** — Fully responsive: bottom tab bar on phones (respects tab visibility settings), safe-area/notch support, reflowed tool rows and settings grids, full-screen chat and modals, coarse-pointer touch targets

## Quick Start

```bash
npm install
npm start
```

The panel runs on **http://localhost:4242** by default.

## Linking the Chat to OpenClaw Agent

To have the floating chat panel use the OpenClaw Gateway API instead of the `claude` CLI, add this to `~/.openclaw/openclaw.json`:

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

```ini
# /etc/systemd/system/openclaw-panel.service
[Unit]
Description=OpenClaw Dashboard
After=network.target

[Service]
WorkingDirectory=/home/youruser/openclaw-dashboard
ExecStart=/usr/bin/node server.js
Restart=always
User=youruser
Environment=PORT=4242
Environment=COMPOSE_DIR=/home/youruser/openclaw
Environment=CONFIG_PATH=/home/youruser/.openclaw/openclaw.json
Environment=SKILLS_DIR=/home/youruser/.openclaw/workspace/skills
Environment=WORKSPACE_DIR=/home/youruser/.openclaw/workspace
Environment=SETUP_DIR=/home/youruser
Environment=SNAPSHOT_DIR=/path/to/snapshots

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-panel
```

---

## Environment Variables

Defaults are derived from the current user's home directory (`os.homedir()`, shown below as `~`) so the dashboard is portable across machines. Override any of them via the environment.

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

## Project Structure

```
server.js                   Express orchestrator: wires middleware + routes, starts server
modules/                    Backend feature modules (one per concern)
  paths.js                  Env-overridable paths + config registry
  utils.js                  run(), SSE helpers, prefs loaders, streamCmd(), detectBinary()
  https-cert.js             Self-signed / Tailscale cert handling
  controls.js               /api/status (Docker, GPU, CPU/RAM + extended stats), start/stop/restart, logs
  stats.js                  Stats registry (STATS_DEFS) + collectors (disk, net, procs, swap, freq…)
  config.js                 Multi-file config + prefs + favorites
  keys.js                   API key / provider management
  skills.js                 Skill install / remove / toggle / detail / search
  setup.js                  Setup script read / write
  snapshots.js              Snapshot create / restore / settings
  files.js                  File manager (list, read, write, upload, paste…)
  code-tools.js             Code agent detection / install (9 tools)
  claude.js                 Claude Code CLI session management
  chat.js                   Agent chat (Gateway API / claude CLI fallback)
  models*.js                Ollama / llama.cpp / HuggingFace / local model managers + AI tools
  system-tools.js           System dependency detection / install (15 tools)
  docker.js                 Docker containers / images / presets
  services.js               Inference service management (incl. image-presence check)
  update.js                 Self-update / restart
  terminal.js               WebSocket PTY terminals
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
    models.css              Model manager views
    terminal.css            Embedded terminal styling
    responsive.css          Breakpoints 1024 / 768 / 480 px
  js/
    state.js                Global vars (incl. stats/sections state)
    utils.js                apiFetch, sseStream, escHtml, toolRowHtml, system-tools cache, helpers
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
    claude.js               Code agent tools (install/gear/terminals) + Claude one-shot
    chat.js                 Floating agent chat panel
    models.js / llamacpp.js Model managers + AI tools card + local model files
    docker.js               Docker manager UI
    services.js             Inference services UI (gear config, image pull)
    terminal.js             Embedded terminal UI
    settings.js             Settings (tabs, theme, stats/sections toggles) + system tools UI
    themes.js               Theme switching
    sudo.js                 Sudo password prompt helper
    fp.js                   Misc front-panel helpers
```
