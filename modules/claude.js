'use strict';

const { spawn } = require('child_process');

const { WORKSPACE_DIR } = require('./paths');
const { run, sseHeaders } = require('./utils');

// Module-scoped state: tracks the single running Claude process
let claudeProc = null;

/** GET /api/claude/status */
async function handleStatus(req, res) {
  try {
    const result = await run('claude --version 2>/dev/null || echo "NOT_FOUND"');
    const out = result.stdout.trim();
    const available = !out.includes('NOT_FOUND');
    res.json({ available, version: available ? out : null, running: !!claudeProc });
  } catch {
    res.json({ available: false, version: null, running: !!claudeProc });
  }
}

/** POST /api/claude/run — one-shot prompt via -p flag */
function handleRun(req, res) {
  const { prompt, workdir } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt' });
  sseHeaders(res);
  const cwd = workdir || WORKSPACE_DIR;
  const child = spawn('claude', ['-p', prompt], {
    cwd,
    env: { ...process.env, TERM: 'dumb' }
  });
  claudeProc = child;
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stdout', text: d.toString() })}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stderr', text: d.toString() })}\n\n`));
  child.on('close', code => {
    res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
    res.end();
    if (claudeProc === child) claudeProc = null;
  });
  req.on('close', () => { child.kill(); if (claudeProc === child) claudeProc = null; });
}

/** POST /api/claude/stop */
function handleStop(req, res) {
  if (claudeProc) { claudeProc.kill(); claudeProc = null; }
  res.json({ ok: true });
}

/** POST /api/claude/start — interactive session (no -p flag) */
function handleStart(req, res) {
  if (claudeProc) return res.status(409).json({ error: 'A Claude process is already running' });
  sseHeaders(res);
  const cwd = req.body?.workdir || WORKSPACE_DIR;
  const child = spawn('claude', [], {
    cwd,
    env: { ...process.env, TERM: 'dumb' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  claudeProc = child;
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stdout', text: d.toString() })}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify({ type: 'stderr', text: d.toString() })}\n\n`));
  child.on('close', code => {
    res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
    res.end();
    if (claudeProc === child) claudeProc = null;
  });
  child.on('error', err => {
    res.write(`data: ${JSON.stringify({ type: 'stderr', text: `Failed to start claude: ${err.message}` })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', code: 1 })}\n\n`);
    res.end();
    if (claudeProc === child) claudeProc = null;
  });
  res.on('close', () => { child.kill(); if (claudeProc === child) claudeProc = null; });
}

/** POST /api/claude/stdin — send text to running process */
function handleStdin(req, res) {
  const { text } = req.body;
  if (!claudeProc) return res.status(404).json({ error: 'No running process' });
  try {
    claudeProc.stdin.write((text ?? '') + '\n');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { handleStatus, handleRun, handleStop, handleStart, handleStdin };
