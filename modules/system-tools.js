'use strict';

/** Settings → System → System tools: the rows (system-tools-catalog.js), found and installed here. */
const { detect } = require('./detect');

const { streamCmd } = require('./utils');

const { SYSTEM_TOOLS, installFor, versionOf, restartFor } = require('./system-tools-catalog');   // the rows, per OS

/** GET /api/system/tools */
async function handleList(req, res) {
  // Each row declares what it looks for (modules/detect.js): no shell line,
  // so a tool is found on Windows as it is on Linux; and its command per OS.
  const results = await Promise.all(SYSTEM_TOOLS.map(t => detect(t.detect).then(({ detected, version }) => {
    const cmd = installFor(t);
    return {
      id: t.id, label: t.label, category: t.category, for: t.for || null, note: t.note, repo: t.repo, repoLabel: t.repoLabel,
      canInstall: !!cmd,
      canUpdate: !!cmd && t.update !== false,
      installCmd: cmd,
      // sudo is POSIX: on Windows an installer elevates through UAC on the desktop, never through a password here.
      needsSudo: process.platform !== 'win32' && !!cmd && (!!t.needsSudo || cmd.includes('sudo ')),
      // A program that runs as a service: restarted by its own command (ask first, the password where it needs it).
      restartCmd: detected ? restartFor(t) : null,
      restartNote: t.restartNote || null,
      detected,
      version: detected ? versionOf(t, version) : null,
    };
  })));
  res.json({ tools: results, platform: process.platform });
}

/** POST /api/system/tools/install — SSE progress */
function handleInstall(req, res) {
  const { id, password } = req.body;
  const tool = SYSTEM_TOOLS.find(t => t.id === id);
  const cmd = tool && installFor(tool);
  if (!cmd) return res.status(400).json({ error: `No install command for this tool on ${process.platform}` });

  streamCmd(res, cmd, {
    label:    tool.label,
    cwd:      tool.installCwd,
    password: typeof password === 'string' && password.length > 0 ? password : undefined,
  });
}

/** POST /api/system/tools/restart — SSE progress; only a row's own restart command, never one from the request. */
function handleRestart(req, res) {
  const { id, password } = req.body || {};
  const tool = SYSTEM_TOOLS.find(t => t.id === id);
  const cmd = tool && restartFor(tool);
  if (!cmd) return res.status(400).json({ error: `${tool ? tool.label : 'This'} has no restart here on ${process.platform}` });
  streamCmd(res, cmd, { label: null, password: typeof password === 'string' && password.length > 0 ? password : undefined });
}

function mount(app) {
  app.get('/api/system/tools', handleList);
  app.post('/api/system/tools/install', handleInstall);
  app.post('/api/system/tools/restart', handleRestart);
}

module.exports = { SYSTEM_TOOLS, handleList, handleInstall, handleRestart, mount };
