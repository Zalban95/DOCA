'use strict';

/**
 * What is stuck, and why — read from DOCA's own files, with no panel running
 * and no model (TODO.md, "Init and inspect without the server").
 *
 * `bin/doca-status.js` prints it; `--json` gives it to a script or a CI job;
 * `--strict` exits 1 when something is waiting on a person or has failed. A
 * running panel is not asked anything, so what is in memory only there — a
 * tool call waiting for approval — is not in this report; everything on disk is.
 */
const memory    = require('./harness/memory');
const missions  = require('./agents/missions');
const settings  = require('./harness/settings');
const installs  = require('./harness/installs');
const usage     = require('./harness/usage');
const ceiling   = require('./harness/turn/ceiling');
const foldCheck = require('./harness/fold-check');
const { params } = require('./harness/turn/params');

const DAY = 86400000;

function report({ now = new Date() } = {}) {
  const sessions = memory.listSessions().sessions.filter(s => !s.archivedAt);
  const recent = s => now - new Date(s.updatedAt || 0) < 7 * DAY;
  const row = s => ({ id: s.id, title: s.title, kind: s.kind, updatedAt: s.updatedAt, ...(s.lastError ? { error: s.lastError } : {}) });

  const p = params();
  const spent = ceiling.state(p, now);
  const day = usage.summary({ days: 1, by: 'kind', now }).total;
  const attention = [];

  const failed = sessions.filter(s => s.state === 'failed' && recent(s)).map(row);
  // "running" on disk with no panel to run it is a turn a restart interrupted.
  const interrupted = sessions.filter(s => s.state === 'running').map(row);
  const stalled = sessions.filter(s => s.job?.state === 'stalled').map(s => ({ ...row(s), autoTurns: s.job.autoTurns }));
  const ms = missions.list({ limit: 500 });
  const mission = m => ({ id: m.id, agent: m.agentId, task: String(m.task || '').slice(0, 100), state: m.state, ...(m.error ? { error: String(m.error).slice(0, 300) } : {}) });
  const proposals = settings.list().pending.map(x => ({ id: x.id, reason: x.reason, paths: (x.changes || []).map(c => c.path) }));
  const installsPending = installs.list().pending.map(x => ({ id: x.id, kind: x.kind, what: x.id, reason: x.reason }));

  if (failed.length) attention.push(`${failed.length} conversation(s) failed in the last 7 days`);
  if (stalled.length) attention.push(`${stalled.length} job(s) stalled — they used their automatic turns without finishing`);
  if (ms.some(m => m.state === 'failed')) attention.push(`${ms.filter(m => m.state === 'failed').length} mission(s) failed`);
  if (proposals.length) attention.push(`${proposals.length} settings proposal(s) wait for a click`);
  if (installsPending.length) attention.push(`${installsPending.length} install proposal(s) wait for a click`);
  if (spent.over) attention.push(`the daily token ceiling is reached (${spent.used} of ${spent.limit}): new turns are refused`);
  const fold = foldCheck.warning(p);
  if (fold) attention.push(fold);

  return {
    at: now.toISOString(),
    version: require('../package.json').version,
    model: p.model ? `${p.provider}/${p.model}` : null,
    conversations: { open: sessions.length, failed, interrupted, stalled },
    missions: {
      running: ms.filter(m => m.state === 'running').map(mission),
      paused: ms.filter(m => m.state === 'paused').map(mission),
      failed: ms.filter(m => m.state === 'failed').map(mission),
    },
    waitingOnAPerson: { proposals, installs: installsPending },
    usage24h: { calls: day.calls, tokens: day.prompt + day.completion, ceiling: spent.limit || null },
    attention,
  };
}

function render(r) {
  const out = [`DOCA ${r.version} — ${r.at}`, `model: ${r.model || '(none chosen)'}`,
    `conversations: ${r.conversations.open} open`,
    `last 24 h: ${r.usage24h.calls} model calls, ${r.usage24h.tokens} tokens${r.usage24h.ceiling ? ` of ${r.usage24h.ceiling} a day` : ''}`, ''];
  const list = (title, rows, line) => { if (rows.length) out.push(`${title}:`, ...rows.map(x => `  ${line(x)}`), ''); };
  list('Failed conversations (7 days)', r.conversations.failed, s => `${s.title} (${s.id}) — ${s.error || 'no reason recorded'}`);
  list('Interrupted (marked running; the panel will call them paused)', r.conversations.interrupted, s => `${s.title} (${s.id})`);
  list('Stalled jobs', r.conversations.stalled, s => `${s.title} (${s.id}) after ${s.autoTurns} automatic turns`);
  list('Missions running', r.missions.running, m => `${m.id} ${m.agent}: ${m.task}`);
  list('Missions paused', r.missions.paused, m => `${m.id} ${m.agent}: ${m.task}`);
  list('Missions failed', r.missions.failed, m => `${m.id} ${m.agent}: ${m.error || m.task}`);
  list('Settings proposals waiting', r.waitingOnAPerson.proposals, x => `${x.id}: ${x.paths.join(', ')} — ${x.reason || ''}`);
  list('Install proposals waiting', r.waitingOnAPerson.installs, x => `${x.id} (${x.kind}) — ${x.reason || ''}`);
  out.push(r.attention.length ? ['Needs attention:', ...r.attention.map(a => `  • ${a}`)].join('\n') : 'Nothing needs attention.');
  return out.join('\n');
}

module.exports = { report, render };
