# OpenClaw Dashboard

Web-based control panel for managing the **OpenClaw** AI agent stack.

## Features

- **Service Control** — Start / Stop / Restart the Docker Compose stack
- **Live Logs** — SSE-streamed container logs with auto-scroll
- **API Keys** — Manage provider keys (OpenAI, Groq, Anthropic, Ollama…)
- **Skills** — Install, remove, enable/disable workspace skills with detail view
- **Snapshots** — Create and restore full agent snapshots
- **Setup Scripts** — View and edit setup/restore shell scripts
- **Config Editor** — Multi-file editor with favorites, per-type validation
- **File Manager** — Browse, edit, copy/cut/paste, rename, upload/download files with drag & drop
- **Claude Code** — Manage and interact with Claude Code CLI sessions
- **Agent Chat** — Floating chat panel to talk with the OpenClaw agent (uses Gateway API when enabled, falls back to `claude` CLI)

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

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4242` | Server port |
| `COMPOSE_DIR` | `/home/al/openclaw` | Docker Compose directory |
| `CONFIG_PATH` | `/home/al/.openclaw/openclaw.json` | Main config file |
| `SKILLS_DIR` | `/home/al/.openclaw/workspace/skills` | Skills directory |
| `WORKSPACE_DIR` | `/home/al/.openclaw/workspace` | Workspace root |
| `SETUP_DIR` | `/home/al` | Setup scripts directory |
| `SNAPSHOT_DIR` | `/media/al/NewVolume/openclaw-snapshots` | Snapshot storage |
| `OPENCLAW_GATEWAY_URL` | — | Override gateway base URL (e.g. `http://openclaw-gateway:18789` when dashboard runs in Docker) |

## Project Structure

```
server.js                   Backend (Express)
public/
  index.html                Clean HTML shell
  css/
    variables.css           CSS custom properties
    base.css                Reset, utilities, animations
    layout.css              Header, nav, sidebar, content
    components.css          Buttons, cards, inputs, modals, chat
    sidebar.css             GPU, CPU/RAM, containers, models
    config.css              Multi-file editor layout
    files.css               File manager + drag-drop upload
    responsive.css          Breakpoints 1024 / 768 / 480 px
  js/
    state.js                Global vars
    utils.js                apiFetch, setStatus, streamToEl, helpers
    nav.js                  Tab routing + mobile drawer
    sidebar.js              Status polling (GPU, CPU/RAM, containers)
    controls.js             Start / stop / restart actions
    logs.js                 SSE log streaming
    keys.js                 API key management
    skills.js               Skill install / remove / toggle / detail
    snapshots.js            Snapshot create / restore
    setup.js                Setup script editor
    config.js               Multi-file config editor + editable favorites
    files.js                File manager + upload / download / drag-drop
    claude.js               Claude Code management
    chat.js                 Floating agent chat panel
```
