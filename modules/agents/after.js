'use strict';

/**
 * Experts that wait on each other (CONSTITUTION V10, 2026-10-07; TODO P1.4): "when one is finished and needs the
 * other one, just wait for the other one to finish and then gets the files that it needed and keeps working".
 * `agent_dispatch {after: [mission ids]}` holds an errand here while any mission it names is still going; when every
 * one is done it is dispatched with their results and the files they wrote as its context. If one fails or is
 * stopped, the errand does not start and its leader is told why. Missions announce every change on the live feed,
 * which is what this listens to (missions.js is at its size limit, so this lives beside it).
 */
const crypto = require('crypto');
const store = require('../store');

const DOC = 'agents/waiting';
const TERMINAL = ['done', 'failed', 'cancelled'];
const load = () => store.readJson(DOC, { waiting: [] }).waiting;
const save = waiting => store.writeJson(DOC, { waiting });

/** Hold an errand until `after` are done, or dispatch it at once when they already are. */
function dispatchAfter(args, after) {
  const missions = require('./missions');
  const ids = [...new Set((after || []).map(String))];
  for (const id of ids) if (!missions.get(id)) throw Object.assign(new Error(`No mission called "${id}" to wait for.`), { status: 404 });
  const row = { id: `wait_${crypto.randomBytes(5).toString('hex')}`, args, after: ids, at: new Date().toISOString() };
  const out = settle(row);
  if (out) return out;
  save([...load(), row]);
  listen();
  return { waiting: row.id, after: ids };
}

/** Start it, drop it, or leave it waiting: what the missions it waits on say now. */
function settle(row) {
  const missions = require('./missions');
  const deps = row.after.map(id => missions.get(id));
  const broken = deps.find(m => !m || ['failed', 'cancelled'].includes(m.state));
  if (broken) {
    const why = `${row.args.agentId} did not start: ${broken ? `${broken.id} ${broken.state}` : 'a mission it waited for is gone'}${broken?.error ? ` (${String(broken.error).slice(0, 200)})` : ''}.`;
    try { if (row.args.by) require('../harness/organization').report(row.args.by, 'blocked', why, 'panel'); } catch { /* told in the result instead */ }
    return { dropped: row.id, why };
  }
  if (!deps.every(m => m.state === 'done')) return null;
  const handed = deps.map(m => `### From ${m.id} (${m.label})\n${String(m.result || '').slice(0, 6000)}${filesOf(m).length ? `\nFiles: ${filesOf(m).join(', ')}` : ''}`).join('\n\n');
  const m = missions.dispatch({ ...row.args, context: [row.args.context, `## What the missions you waited for delivered\n${handed}`].filter(Boolean).join('\n\n') });
  return { started: m.id, after: row.after };
}

/** The files a mission wrote (its write_file calls), for the one that needs them. */
function filesOf(m) {
  try {
    const out = new Set();
    for (const r of require('../harness/memory').messages(m.sessionId)) for (const c of r.tool_calls || []) {
      if (c.function?.name !== 'write_file') continue;
      try { const a = JSON.parse(c.function.arguments || '{}'); if (a.path) out.add(a.path); } catch { /* not JSON */ }
    }
    return [...out].slice(0, 40);
  } catch { return []; }
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  require('../live').feed.on('change', c => {
    if (c.topic !== 'missions' || !TERMINAL.includes(c.what)) return;
    const waiting = load();
    if (!waiting.some(w => w.after.includes(c.id))) return;
    const still = [];
    for (const w of waiting) (w.after.includes(c.id) && settle(w)) || still.push(w);
    save(still);
  });
}

/** What waits, for agent_results and the panel. */
const list = () => load().map(w => ({ id: w.id, agent: w.args.agentId, task: String(w.args.task || '').slice(0, 120), after: w.after, at: w.at }));

module.exports = { dispatchAfter, list, listen, filesOf };
