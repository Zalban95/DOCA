'use strict';

/**
 * Machines → Live (TODO H10.9; asked 2026-10-06: "a page where we see the machines of the agents live and the ones
 * working get highlighted on the foreground, not just the machines but all the panels where the agent is serving the
 * pages for the tests"). One picture of where the agents are working:
 *   computers  the agents' computers with what each did last and when (from agent.events: any of its tools, by the
 *              `mcp__computer-<id>__` name, or a tool naming it), and whether a running mission holds it
 *   served     the pages the agents serve for tests: an address a running job printed (a dev server's "Local:
 *              http://localhost:5173"), on this machine only — loopback, 0.0.0.0, this host's names — seen through the
 *              hub's headless browser while a Live page looks (shots.js)
 * "Working" is anything that acted in the last WORKING_MS; the page puts those in front.
 */
const os = require('os');

const WORKING_MS = 45000;
const _acts = new Map();   // computer id → { at, what, sessionId }

function onEvent(evt) {
  if (evt?.type !== 'tool_call' || !evt.name) return;
  let args = evt.args;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  const m = /^mcp__computer-([\w-]+?)__(.+)$/.exec(evt.name);
  const id = m ? m[1] : (args?.computer && /^computer/.test(evt.name) ? String(args.computer) : null);
  if (!id) return;
  const what = m ? m[2].replace(/_/g, ' ') : evt.name.replace(/_/g, ' ');
  _acts.set(id, { at: Date.now(), what: `${what}${args?.url ? ` ${args.url}` : args?.text ? ` "${String(args.text).slice(0, 40)}"` : ''}`, sessionId: evt.sessionId || null });
}

const LOCAL = () => new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::]', '[::1]', '::1', os.hostname().toLowerCase(), `${os.hostname().toLowerCase()}.local`]);
const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w.-]+):\d{2,5}(?:\/[^\s"'<>`)\]]*)?/g;

/** Addresses on this machine that a running job printed, newest job first. */
function served() {
  const jobs = require('../harness/jobs');
  const out = [], seen = new Set();
  for (const j of jobs.list().filter(x => x.state === 'running')) {   // newest first
    let tail = '';
    try { tail = String(jobs.output(j.id, 20000) || ''); } catch { continue; }
    tail = tail.replace(/\x1b\[[0-9;]*m/g, '');
    for (const raw of tail.match(URL_RE) || []) {
      let u;
      try { u = new URL(raw); } catch { continue; }
      if (!LOCAL().has(u.hostname.toLowerCase())) continue;
      const url = `${u.protocol}//127.0.0.1:${u.port}${u.pathname === '/' ? '/' : u.pathname}`;
      const key = `${j.id}:${u.port}`;
      if (seen.has(`${u.port}`)) continue;
      seen.add(`${u.port}`);
      out.push({ key, url, port: Number(u.port), printed: raw, jobId: j.id, command: j.command, sessionId: j.sessionId || null,
        who: j.sessionId ? (require('../harness/memory').getSession(j.sessionId)?.title || j.sessionId) : null,
        startedAt: j.startedAt || null, tail: tail.trim().split('\n').slice(-6).join('\n').slice(-800) });
    }
  }
  return out;
}

async function picture({ shots = false } = {}) {
  const now = Date.now();
  let computers = [];
  try { computers = await require('../computers').detailed(); } catch { /* no computers */ }
  computers = computers.map(c => {
    const a = _acts.get(c.id);
    const busy = (a && now - a.at < WORKING_MS) || c.mission?.state === 'running';
    return { ...c, activity: a ? { ...a, ago: now - a.at } : null, working: !!busy };
  });
  const pages = served();
  const shooter = require('./shots');
  if (shots) shooter.want(pages.map(p => ({ key: p.key, url: p.url })));
  return { computers, served: pages.map(p => ({ ...p, shot: shooter.has(p.key), working: true })), browser: shooter.browser(), workingMs: WORKING_MS };
}

let _listening = false;
function mount(app) {
  if (!_listening) { _listening = true; require('../harness/agent').events.on('event', e => { try { onEvent(e); } catch { /* never the work's problem */ } }); }
  app.get('/api/machines', async (req, res) => { try { res.json(await picture({ shots: req.query.shots === '1' })); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/machines/served/:key/shot', (req, res) => {
    const png = require('./shots').get(req.params.key);
    if (!png) return res.status(404).json({ error: 'No picture of it yet.' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  });
}

module.exports = { mount, picture, served, onEvent, WORKING_MS };
