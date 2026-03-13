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
