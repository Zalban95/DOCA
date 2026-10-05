'use strict';

/**
 * OpenDots (CopilotKit) as a peer harness (TODO H14; docs/design/opendots-integration.md §3): a web app with its own
 * data, run with its own Compose project — never a prerequisite for DOCA, and nothing of DOCA's (memory, keys,
 * COMPOSE_DIR) is handed to it. What this gives is what can be honest without a live instance: install (clone at a
 * pinned commit, .env from its example — never filled by DOCA), the states that differ (absent, setup required,
 * stopped, unreachable, ready), Start/Stop of its own project (never `down -v`), and Open, which goes to its own page.
 * Conversations through DOCA (§4) need its Intelligence SDK and a running instance to prove the transport first.
 *
 * Settings: harness.config.opendots.{dir, url} — where it is cloned (default ~/opendots) and where it answers
 * (default http://127.0.0.1:4310, its compose.yml's port).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'https://github.com/CopilotKit/OpenDots.git';
const PIN = 'c2569bb6a13a22e565cf3eb791c62267d06babb1';   // 0.1.0 as inspected 2026-10-02, and main on 2026-10-05
const PROJECT = 'opendots';   // its own Compose project: OpenClaw's stack and DOCA's services are never touched

function settings() {
  const cfg = (require('../utils').loadPrefs().harness?.config || {}).opendots || {};
  return { dir: cfg.dir || process.env.OPENDOTS_DIR || path.join(os.homedir(), 'opendots'), url: (cfg.url || 'http://127.0.0.1:4310').replace(/\/+$/, '') };
}

/** Keys in its .env that must not be empty for a conversation (setup, not reachability). */
const NEEDED = ['INTELLIGENCE_API_KEY', 'OWNER_TOKEN'];
function envMissing(dir) {
  let text;
  try { text = fs.readFileSync(path.join(dir, '.env'), 'utf8'); } catch { return ['.env'].concat(NEEDED); }
  // [ \t]*, not \s*: "KEY=" followed by a newline must read empty, not as the next line.
  const val = k => (new RegExp(`^[ \\t]*${k}[ \\t]*=[ \\t]*"?([^"\\n#]*)`, 'm').exec(text) || [])[1]?.trim();
  return NEEDED.filter(k => !val(k));
}

/** absent | setup | stopped | ready, with a sentence for the row. */
async function state() {
  const { dir, url } = settings();
  if (!fs.existsSync(path.join(dir, 'compose.yml'))) return { state: 'absent', dir, url, say: `Not installed (${dir}).` };
  const missing = envMissing(dir);
  let answers = false;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' }); answers = r.status < 500; } catch { /* not answering */ }
  if (answers) return { state: 'ready', dir, url, missing, say: missing.length ? `Answering at ${url}; its .env lacks ${missing.join(', ')}, so conversations may not work.` : `Answering at ${url}.` };
  if (missing.length) return { state: 'setup', dir, url, missing, say: `Installed; setup required: fill ${missing.join(', ')} in ${path.join(dir, '.env')} (a CopilotKit Intelligence project key and an owner token), then Start.` };
  return { state: 'stopped', dir, url, say: `Installed and set up; not answering at ${url}. Start runs its Compose project.` };
}

/** The installer: clone at the pinned commit, and its .env from the example (only when there is none). */
function installCmd() {
  const { dir } = settings();
  if (process.platform === 'win32') return `if (-not (Test-Path "${dir}\\.git")) { git clone ${REPO} "${dir}" }; git -C "${dir}" fetch origin; git -C "${dir}" checkout ${PIN}; if (-not (Test-Path "${dir}\\.env")) { Copy-Item "${dir}\\.env.example" "${dir}\\.env" }; "OpenDots ${PIN.slice(0, 7)} in ${dir}. Fill INTELLIGENCE_API_KEY and OWNER_TOKEN in its .env, then Start."`;
  return `[ -d "${dir}/.git" ] || git clone ${REPO} "${dir}"; git -C "${dir}" fetch origin && git -C "${dir}" checkout ${PIN} && { [ -f "${dir}/.env" ] || cp "${dir}/.env.example" "${dir}/.env"; } && echo "OpenDots ${PIN.slice(0, 7)} in ${dir}. Fill INTELLIGENCE_API_KEY and OWNER_TOKEN in its .env, then Start."`;
}

/** Start or stop its Compose project, by argv. Never `down -v`: its volume holds its pages and computers. */
function stack(action, say = () => {}) {
  const { dir } = settings();
  const args = action === 'start' ? ['compose', '-p', PROJECT, 'up', '-d', '--build'] : action === 'stop' ? ['compose', '-p', PROJECT, 'stop'] : null;
  if (!args) return Promise.reject(Object.assign(new Error('start or stop'), { status: 400 }));
  if (!fs.existsSync(path.join(dir, 'compose.yml'))) return Promise.reject(Object.assign(new Error(`OpenDots is not installed in ${dir}.`), { status: 409 }));
  if (action === 'start') { const m = envMissing(dir); if (m.length) return Promise.reject(Object.assign(new Error(`Setup first: ${m.join(', ')} in ${path.join(dir, '.env')}.`), { status: 409 })); }
  const cli = require('../containers').cli();
  say(`$ ${cli} ${args.join(' ')}\n`);
  return new Promise(resolve => {
    const child = spawn(cli, args, { cwd: dir, windowsHide: true });
    child.stdout.on('data', d => say(d.toString()));
    child.stderr.on('data', d => say(d.toString()));
    child.on('error', e => { say(`${e.message}\n`); resolve({ ok: false }); });
    child.on('close', code => resolve({ ok: code === 0, code }));
  });
}

function mount(app) {
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/harness/opendots/state', h(() => state()));
  app.post('/api/harness/opendots/config', h(req => {
    const { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs();
    const cur = prefs.harness?.config?.opendots || {};
    const next = { ...cur };
    if (typeof req.body?.dir === 'string') next.dir = req.body.dir.trim();
    if (typeof req.body?.url === 'string') { if (req.body.url && !/^https?:\/\/[^\s]+$/.test(req.body.url.trim())) throw Object.assign(new Error('An http(s) address.'), { status: 400 }); next.url = req.body.url.trim(); }
    savePrefs({ ...prefs, harness: { ...(prefs.harness || {}), config: { ...(prefs.harness?.config || {}), opendots: next } } });
    return state();
  }));
  app.post('/api/harness/opendots/stack', async (req, res) => {
    require('../utils').sseHeaders(res);
    const say = status => { try { res.write(`data: ${JSON.stringify({ status })}\n\n`); } catch { /* gone */ } };
    try { const r = await stack(req.body?.action, say); res.write(`data: ${JSON.stringify({ done: true, ok: r.ok, status: r.ok ? '✓ Done\n' : `✗ Exit ${r.code}\n` })}\n\n`); }
    catch (e) { res.write(`data: ${JSON.stringify({ done: true, ok: false, status: `✗ ${e.message}\n` })}\n\n`); }
    res.end();
  });
}

module.exports = { settings, state, installCmd, stack, mount, envMissing, PIN, REPO, PROJECT };
