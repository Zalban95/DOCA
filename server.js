/**
 * OPENCLAW PANEL — server.js
 * Minimal orchestrator: imports modules, wires middleware + routes, starts server.
 */
'use strict';

const express = require('express');
const http    = require('http');
const https   = require('https');
const path    = require('path');
const multer  = require('multer');

// ─── Foundation ───────────────────────────────────────────────────────────────
const pkg                      = require('./package.json');
const { PORT }                 = require('./modules/paths');
const { ensureCerts }          = require('./modules/https-cert');

// ─── Feature modules ──────────────────────────────────────────────────────────
const controls     = require('./modules/controls');
const config       = require('./modules/config');
const keys         = require('./modules/keys');
const devicesPanel = require('./modules/devices-panel');
const skills       = require('./modules/skills');
const setup        = require('./modules/setup');
const snapshots    = require('./modules/snapshots');
const files        = require('./modules/files');
const harness      = require('./modules/harness/routes');
const chat         = require('./modules/chat');
const models       = require('./modules/models');
const modelsOllama   = require('./modules/models-ollama');
const modelsLlamaCpp = require('./modules/models-llamacpp');
const modelsHf       = require('./modules/models-hf');
const modelsLocal    = require('./modules/models-local');
const systemTools  = require('./modules/system-tools');
const stats        = require('./modules/stats');
const docker       = require('./modules/docker');
const services     = require('./modules/services');
const update       = require('./modules/update');
const startup      = require('./modules/startup');
const terminal     = require('./modules/terminal');
const apiV1        = require('./modules/api-v1/router');

/**
 * Build the Express app (no listening). Exported so tests can mount it on
 * an ephemeral HTTP port without certificates.
 */
function createApp() {
const app = express();

// Device-agnostic client API — mounted first so it can apply its own,
// tighter body limits and authentication. Legacy /api/* is untouched.
app.use('/api/v1', apiV1.router);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Routes: Controls ─────────────────────────────────────────────────────────
app.get ('/api/status',     controls.handleStatus);
app.post('/api/action',     controls.handleAction);
app.post('/api/stack/update', controls.handleStackUpdate);
app.get ('/api/logs',       controls.handleLogs);
app.get ('/api/stats/defs', stats.handleDefs);

// ─── Routes: Config & Prefs ──────────────────────────────────────────────────
app.get ('/api/configs/:id',       config.handleGetConfig);
app.post('/api/configs/:id',       config.handlePostConfig);
app.get ('/api/config',            config.handleGetLegacyConfig);
app.post('/api/config',            config.handlePostLegacyConfig);
app.get ('/api/prefs',             config.handleGetPrefs);
app.post('/api/prefs',             config.handlePostPrefs);
app.get ('/api/config-favorites',  config.handleGetConfigFavorites);
app.post('/api/config-favorites',  config.handlePostConfigFavorites);
app.get ('/api/fm-favorites',      config.handleGetFmFavorites);
app.post('/api/fm-favorites',      config.handlePostFmFavorites);
app.get ('/api/paths',             config.handleGetPaths);

// ─── Routes: API Keys & Tool Providers ────────────────────────────────────────
app.get   ('/api/keys',                      keys.handleGetKeys);
app.post  ('/api/keys',                      keys.handlePostKeys);
app.post  ('/api/keys/add-provider',         keys.handleAddProvider);
app.delete('/api/keys/:name',                keys.handleDeleteProvider);

// ─── Routes: Doca device tokens (the /api/v1 registry, managed from the panel) ─
app.get   ('/api/devices',             devicesPanel.handleList);
app.post  ('/api/devices',             devicesPanel.handleIssue);
app.post  ('/api/devices/pair',        devicesPanel.handlePairStart);
app.post  ('/api/devices/:id/rotate',  devicesPanel.handleRotate);
app.delete('/api/devices/:id',         devicesPanel.handleRevoke);

// ─── Routes: Skills ───────────────────────────────────────────────────────────
// /search must come before /:name to avoid matching "search" as a skill name
app.get   ('/api/skills/search',        skills.handleSearch);
app.get   ('/api/skills',               skills.handleList);
app.get   ('/api/skills/:name',         skills.handleDetail);
app.post  ('/api/skills/:name/toggle',  skills.handleToggle);
app.post  ('/api/skills/install',       skills.handleInstall);
app.delete('/api/skills/:name',         skills.handleDelete);

// ─── Routes: Setup Scripts ────────────────────────────────────────────────────
app.get ('/api/setup/scripts',       setup.handleList);
app.get ('/api/setup/scripts/:name', setup.handleGet);
app.post('/api/setup/scripts/:name', setup.handlePost);

// ─── Routes: Snapshots ───────────────────────────────────────────────────────
app.get ('/api/snapshots/settings',  snapshots.handleGetSettings);
app.post('/api/snapshots/settings',  snapshots.handlePostSettings);
app.get ('/api/snapshots',           snapshots.handleList);
app.post('/api/snapshots/create',    snapshots.handleCreate);
app.post('/api/snapshots/restore',   snapshots.handleRestore);

// ─── Routes: File Manager ─────────────────────────────────────────────────────
app.get ('/api/files/roots',    files.handleRoots);
app.get ('/api/files/mounts',  files.handleMounts);
app.get ('/api/files/search',  files.handleSearch);
app.get ('/api/files/list',     files.handleList);
app.get ('/api/files/read',     files.handleRead);
app.post('/api/files/write',    files.handleWrite);
app.post('/api/files/rename',   files.handleRename);
app.post('/api/files/delete',   files.handleDelete);
app.post('/api/files/mkdir',    files.handleMkdir);
app.post('/api/files/paste',    files.handlePaste);
app.post('/api/files/upload',   uploadMw.array('files', 20), files.handleUpload);
app.get ('/api/files/download', files.handleDownload);
app.get ('/api/files/raw',      files.handleRaw);

// ─── Routes: Harnesses ───────────────────────────────────────────────────────
// Catalog: the rows on the Controls page (install, default, params, custom).
app.get   ('/api/harness',              harness.handleList);
app.get   ('/api/harness/providers',    harness.handleProviders);
app.get   ('/api/harness/models',       harness.handleModels);
app.get   ('/api/harness/status',       harness.handleStatus);
app.post  ('/api/harness/default',      harness.handleSetDefault);
app.post  ('/api/harness/custom',       harness.handleAddCustom);
app.delete('/api/harness/custom/:id',   harness.handleRemoveCustom);

// Built-in harness console: one agent turn, its sessions and its memory.
app.post  ('/api/harness/chat',                 harness.handleChat);
app.get   ('/api/harness/sessions',             harness.handleSessions);
app.post  ('/api/harness/sessions',             harness.handleSessionNew);
app.get   ('/api/harness/sessions/:id',         harness.handleSession);
app.post  ('/api/harness/sessions/:id/activate', harness.handleSessionActivate);
app.delete('/api/harness/sessions/:id',         harness.handleSessionDelete);
app.get   ('/api/harness/memory',               harness.handleMemoryList);
app.post  ('/api/harness/memory',               harness.handleMemoryWrite);
app.delete('/api/harness/memory/:key',          harness.handleMemoryForget);

// Per-harness routes last: `:id` would otherwise swallow the fixed paths above.
app.post  ('/api/harness/:id/install',  harness.handleInstall);
app.post  ('/api/harness/:id/config',   harness.handleConfig);

// ─── Routes: Chat ─────────────────────────────────────────────────────────────
app.get ('/api/chat/status',      chat.handleStatus);
app.get ('/api/chat/history',     chat.handleHistory);
app.post('/api/chat/clear',       chat.handleClear);
app.get ('/api/chat/call-status', chat.handleCallStatus);
app.post('/api/chat/transcribe',  uploadMw.single('audio'), chat.handleTranscribe);
app.post('/api/chat/synthesize',  chat.handleSynthesize);
app.post('/api/chat',             chat.handleChat);

// ─── Routes: Models & Tools ───────────────────────────────────────────────────
app.get ('/api/models/settings',          models.handleGetSettings);
app.post('/api/models/settings',          models.handlePostSettings);
app.get ('/api/models/disk',              models.handleGetDisk);
app.get ('/api/models/tools',             models.handleGetTools);
app.post('/api/models/tools/:id/config',  models.handleToolConfig);
app.post('/api/models/tools/:id/install', models.handleToolInstall);

// ─── Routes: Ollama Models ────────────────────────────────────────────────────
app.get ('/api/models/ollama/search',  modelsOllama.handleSearch);
app.get ('/api/models/ollama/status',  modelsOllama.handleStatus);
app.get ('/api/models/ollama/running', modelsOllama.handleRunning);
app.get ('/api/models/ollama/list',    modelsOllama.handleList);
app.post('/api/models/ollama/pull',    modelsOllama.handlePull);
app.post('/api/models/ollama/delete',  modelsOllama.handleDelete);

// ─── Routes: llama.cpp Servers ────────────────────────────────────────────────
app.get   ('/api/models/llamacpp/list',    modelsLlamaCpp.handleList);
app.get   ('/api/models/llamacpp/status',  modelsLlamaCpp.handleStatus);
app.post  ('/api/models/llamacpp/config',  modelsLlamaCpp.handleConfig);
app.post  ('/api/models/llamacpp/start',   modelsLlamaCpp.handleStart);
app.post  ('/api/models/llamacpp/stop',    modelsLlamaCpp.handleStop);
app.post  ('/api/models/llamacpp/restart', modelsLlamaCpp.handleRestart);
app.post  ('/api/models/llamacpp/health',  modelsLlamaCpp.handleHealth);
app.delete('/api/models/llamacpp/:id',     modelsLlamaCpp.handleDelete);

// ─── Routes: Local Non-LLM Models ────────────────────────────────────────────
app.get ('/api/models/local/settings', modelsLocal.handleGetSettings);
app.post('/api/models/local/settings', modelsLocal.handlePostSettings);
app.get ('/api/models/local/search',   modelsLocal.handleSearch);
app.get ('/api/models/local/list',     modelsLocal.handleList);
app.post('/api/models/local/install',  modelsLocal.handleInstall);
app.post('/api/models/local/delete',   modelsLocal.handleDelete);

// ─── Routes: HuggingFace Models ───────────────────────────────────────────────
app.get ('/api/models/hf/settings', modelsHf.handleGetSettings);
app.post('/api/models/hf/settings', modelsHf.handlePostSettings);
app.get ('/api/models/hf/status',   modelsHf.handleStatus);
app.get ('/api/models/hf/list',     modelsHf.handleList);
app.get ('/api/models/hf/search',   modelsHf.handleSearch);
app.post('/api/models/hf/download', modelsHf.handleDownload);
app.post('/api/models/hf/delete',   modelsHf.handleDelete);

// ─── Routes: System Tools ─────────────────────────────────────────────────────
app.get ('/api/system/tools',         systemTools.handleList);
app.post('/api/system/tools/install', systemTools.handleInstall);

// ─── Routes: Update ──────────────────────────────────────────────────────────
app.get ('/api/update-check', update.handleUpdateCheck);
app.post('/api/update',       update.handleUpdate);
app.post('/api/restart',      update.handleRestart);

// ─── Routes: Start at boot ────────────────────────────────────────────────────
app.get ('/api/startup', startup.handleStatus);
app.post('/api/startup', startup.handleSet);

// ─── Routes: Docker ───────────────────────────────────────────────────────────
app.get   ('/api/docker/containers',            docker.handleContainers);
app.post  ('/api/docker/containers/:id/action', docker.handleContainerAction);
app.get   ('/api/docker/containers/:id/logs',   docker.handleContainerLogs);
app.get   ('/api/docker/images',                docker.handleImages);
app.post  ('/api/docker/images/pull',           docker.handleImagePull);
app.delete('/api/docker/images/:id',            docker.handleImageDelete);
app.post  ('/api/docker/run',                   docker.handleRun);
app.get   ('/api/docker/presets',               docker.handleGetPresets);
app.post  ('/api/docker/presets',               docker.handleSavePreset);
app.delete('/api/docker/presets/:name',         docker.handleDeletePreset);

// ─── Routes: Inference Services ───────────────────────────────────────────────
app.get ('/api/services',          services.handleList);
app.post('/api/services/settings', services.handleSettings);
app.get ('/api/services/status',   services.handleStatus);
app.post('/api/services/start',    services.handleStart);
app.post('/api/services/stop',     services.handleStop);

return app;
}

module.exports = { createApp };

// ─── Server (HTTPS with HTTP fallback) + WebSocket Terminals ─────────────────
if (require.main === module) {
const app = createApp();
/** Bind, tolerating a predecessor that has not finished shutting down.
 *  POST /api/restart spawns its successor *before* exiting, so a short burst of
 *  EADDRINUSE at startup is expected rather than fatal. */
const BIND_RETRY_MS = 20000;
function listenWithRetry(server, announce) {
  const deadline = Date.now() + BIND_RETRY_MS;
  let bound  = false;
  let waited = false;

  server.on('listening', () => { bound = true; announce(); });
  server.on('error', err => {
    if (bound || err.code !== 'EADDRINUSE') {
      console.error(`[server] ${err.message}`);
      process.exit(1);
    }
    if (Date.now() >= deadline) {
      console.error(`[server] port ${PORT} is still in use after ${Math.round(BIND_RETRY_MS / 1000)}s — another OpenClaw Panel is probably already running.`);
      process.exit(1);
    }
    if (!waited) {
      waited = true;
      console.log(`[server] port ${PORT} busy — waiting for the previous instance to exit…`);
    }
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 250);
  });

  server.listen(PORT, '0.0.0.0');
}

ensureCerts().then(certs => {
  const server = https.createServer(certs, app);
  terminal.setup(server);
  listenWithRetry(server, () => {
    const label = certs.tailscale
      ? `https://${certs.tailscale}:${PORT}  (Tailscale — trusted)`
      : `https://0.0.0.0:${PORT}  (self-signed)`;
    console.log(`OpenClaw Panel v${pkg.version} → ${label}`);
  });
}).catch(e => {
  console.warn(`[HTTPS] Falling back to HTTP: ${e.message}`);
  const server = http.createServer(app);
  terminal.setup(server);
  listenWithRetry(server, () => {
    console.log(`OpenClaw Panel v${pkg.version} → http://0.0.0.0:${PORT}`);
  });
});
}
