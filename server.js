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
const skills       = require('./modules/skills');
const setup        = require('./modules/setup');
const snapshots    = require('./modules/snapshots');
const files        = require('./modules/files');
const codeTools    = require('./modules/code-tools');
const claude       = require('./modules/claude');
const chat         = require('./modules/chat');
const models       = require('./modules/models');
const modelsOllama = require('./modules/models-ollama');
const modelsHf     = require('./modules/models-hf');
const modelsLocal  = require('./modules/models-local');
const systemTools  = require('./modules/system-tools');
const docker       = require('./modules/docker');
const services     = require('./modules/services');
const update       = require('./modules/update');
const terminal     = require('./modules/terminal');

// ─── Express + Middleware ─────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Routes: Controls ─────────────────────────────────────────────────────────
app.get ('/api/status',  controls.handleStatus);
app.post('/api/action',  controls.handleAction);
app.get ('/api/logs',    controls.handleLogs);

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
app.get   ('/api/keys/tool-providers',       keys.handleGetToolProviders);
app.post  ('/api/keys/tool-providers',       keys.handlePostToolProviders);
app.post  ('/api/keys/tool-providers/add',   keys.handleAddToolProvider);
app.delete('/api/keys/tool-providers/:name', keys.handleDeleteToolProvider);

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

// ─── Routes: Code Tools ──────────────────────────────────────────────────────
app.get ('/api/code/tools',             codeTools.handleList);
app.post('/api/code/tools/pin',         codeTools.handlePin);
app.post('/api/code/tools/:id/config',  codeTools.handleConfig);
app.post('/api/code/tools/:id/install', codeTools.handleInstall);

// ─── Routes: Claude Code ─────────────────────────────────────────────────────
app.get ('/api/claude/status', claude.handleStatus);
app.post('/api/claude/run',    claude.handleRun);
app.post('/api/claude/stop',   claude.handleStop);
app.post('/api/claude/start',  claude.handleStart);
app.post('/api/claude/stdin',  claude.handleStdin);

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
app.get ('/api/models/tools',             models.handleGetTools);
app.post('/api/models/tools/:id/config',  models.handleToolConfig);

// ─── Routes: Ollama Models ────────────────────────────────────────────────────
app.get ('/api/models/ollama/search',  modelsOllama.handleSearch);
app.get ('/api/models/ollama/status',  modelsOllama.handleStatus);
app.get ('/api/models/ollama/running', modelsOllama.handleRunning);
app.get ('/api/models/ollama/list',    modelsOllama.handleList);
app.post('/api/models/ollama/pull',    modelsOllama.handlePull);
app.post('/api/models/ollama/delete',  modelsOllama.handleDelete);

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

// ─── Routes: Update Check ─────────────────────────────────────────────────
app.get ('/api/update-check', update.handleUpdateCheck);

// ─── Routes: Docker ───────────────────────────────────────────────────────────
app.get   ('/api/docker/containers',            docker.handleContainers);
app.post  ('/api/docker/containers/:id/action', docker.handleContainerAction);
app.get   ('/api/docker/containers/:id/logs',   docker.handleContainerLogs);
app.get   ('/api/docker/images',                docker.handleImages);
app.post  ('/api/docker/images/pull',           docker.handleImagePull);
app.delete('/api/docker/images/:id',            docker.handleImageDelete);
app.post  ('/api/docker/run',                   docker.handleRun);

// ─── Routes: Inference Services ───────────────────────────────────────────────
app.get ('/api/services',          services.handleList);
app.post('/api/services/settings', services.handleSettings);
app.get ('/api/services/status',   services.handleStatus);
app.post('/api/services/start',    services.handleStart);
app.post('/api/services/stop',     services.handleStop);

// ─── Server (HTTPS with HTTP fallback) + WebSocket Terminals ─────────────────
ensureCerts().then(certs => {
  const server = https.createServer(certs, app);
  terminal.setup(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenClaw Panel v${pkg.version} → https://0.0.0.0:${PORT}  (self-signed)`);
  });
}).catch(e => {
  console.warn(`[HTTPS] Falling back to HTTP: ${e.message}`);
  const server = http.createServer(app);
  terminal.setup(server);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenClaw Panel v${pkg.version} → http://0.0.0.0:${PORT}`);
  });
});
