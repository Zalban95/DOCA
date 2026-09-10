# AGENTS.md

## Cursor Cloud specific instructions

### What this is
OpenClaw Dashboard — a single Node.js/Express web app (`server.js` + `modules/*`) that serves a static frontend (`public/`) and a JSON/SSE API for managing an external "OpenClaw" Docker/AI stack. There is one service; no database.

### Running
- Dev: `npm run dev` (uses `node --watch server.js` for hot reload). Prod-style: `npm start`, or `./run.sh` which also installs deps on first run and sources `.env`.
- `./run.sh enable|disable|status` manages the systemd unit `openclaw-panel.service`. **Settings → General → Start at Boot** calls the same script through `/api/startup`, so change the behaviour in `run.sh`, not in two places. Neither works in a container or any host without systemd — `/api/startup` reports `supported: false` with a reason and the toggle greys itself out, which is expected, not a bug.
- Listens on `0.0.0.0:4242` (override with `PORT`).
- The server serves **HTTPS with a self-signed cert** (auto-generated into `.certs/`), falling back to HTTP only if cert generation fails. Use `curl -k` and, in a browser, click through the "Your connection is not private" warning (Advanced → Proceed).

### Lint / test / build
- There is **no build step** (plain JS, static assets) and **no lint script**.
- `npm test` runs the `/api/v1` client-protocol suites plus `test/harness.test.js` with `node --test` (no external services; each file boots the app on an ephemeral HTTP port with a temp `DOCA_DATA_DIR` and `DOCA_PREFS_FILE`, so your real prefs are never touched). The harness suite talks to a scripted stub model server on an ephemeral port — no API keys or Ollama needed. `npm run client:demo` (needs a running server and `DOCA_ADMIN_TOKEN`) exercises the reference clients end to end.

### Harnesses (`/api/harness/*`)
- A harness is the agent runtime DOCA talks to. `modules/harness/catalog.js` owns the list (built-in + 14 known CLIs/stacks + user-added custom ones) and which one is the default; the Controls page and the Harness tab both render from `GET /api/harness`.
- The default on a fresh install is the **built-in DOCA harness** (`modules/harness/agent.js`), an agent loop over any OpenAI-compatible `/chat/completions` endpoint with tool calling (`tools.js`) and structured memory (`memory.js`). It stores conversations and durable memory under `DOCA_DATA_DIR/harness/`, and its model parameters under `harness.config.doca` in the prefs file.
- These are legacy dashboard routes, not `/api/v1`, so they are **not** part of the OpenAPI document and adding one does not require regenerating it.
- Selecting a model needs a reachable provider. Without one (no Ollama, no keys) the console shows "Pick a model with ⚙" — that is expected in a bare VM, not a bug.

### `/api/v1` client layer
- Spec: `PROTOCOL.md`. Developer guides: `docs/api/` (getting started, device app guide, agent guide, cookbook). Code: `modules/api-v1/`. Mint tokens with `npm run token -- issue --name x --preset admin|agent|phone|watch|viewer`.
- OpenAPI: `modules/api-v1/openapi.js` is the source; `docs/api/openapi.json` is generated from it (`npm run openapi > docs/api/openapi.json`) and `test/openapi.test.js` fails if it is stale or if any Express route is missing from it. When adding or changing a route, update `openapi.js` and regenerate.
- Durable state goes to `DOCA_DATA_DIR` (default `.doca/`, gitignored); set it to a temp dir when experimenting.
- `server.js` exports `createApp()`; it only listens when run directly.

### Environment gotchas (not bugs)
- The dashboard manages an *external* Docker Compose stack and various AI CLIs. Those tools (Docker, Ollama, nvidia-smi, huggingface-cli, etc.) are **not installed by default**. Panels that shell out to them (e.g. "All Containers" showing `docker: not found`, GPU stats, model managers) will show errors/empty state. This is expected and does not indicate the app is broken — installing Docker/etc. is optional and only needed to exercise those specific panels.
- Some sidebar stats (CPU temp, GPU) read host sensors that are unavailable in the VM and render as `-`.
- Default paths (`COMPOSE_DIR`, `CONFIG_PATH`, `SKILLS_DIR`, `WORKSPACE_DIR`, `SNAPSHOT_DIR`) derive from `~` and may not exist; override via env vars (see README "Environment Variables") when testing those features.
- Runtime prefs are written to `.dashboard-prefs.json` and certs to `.certs/` (both gitignored).
