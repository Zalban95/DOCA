'use strict';

/**
 * Who hears a report, and whether a model has to (the owner's yes of 2026-10-14 to both: "helpers asking their leader
 * for a specialist, and plain notices for reports that need no decision"). The Orchestrator is the front desk: what
 * does not need it does not reach it.
 *
 * · A project's chat leads the helpers it made (org-depth.js: they are level 3 and make nothing). A helper that needs a
 *   specialist — or anything only its leader may start — asks in a report (`work_chats report`, outcome question). When
 *   a helper's report ends its job, or a specialist its leader sent finishes, the leader is woken — never the
 *   Orchestrator — and decides under its own level and approvals: it dispatches, sends what came back down with
 *   `work_chats send`, and tells the person only what needs them.
 * · A work chat's "done" needs no decision: its person is told in fixed words (their devices that show notices, else
 *   the panel) and one line is written in the Orchestrator's conversation, so its next turn has it — no model is asked.
 *   Failed, blocked and a question still wake the Orchestrator, which asks the person (supervisor.deliver).
 */
const memory = require('./memory');

const short = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

const LEAD_REPORTS = '[panel] Helpers you started reported back. Read each report. Where one asks for a specialist or for '
  + 'something only you may start, decide: dispatch it (agent_dispatch) and, when it is back, send the helper what it '
  + 'needs with work_chats send. Do not redo a helper\'s work yourself. Tell the person only what needs them.';
const LEAD_RESULTS = '[panel] The specialists you sent have finished; their results are in your context. Pass on what a '
  + 'helper of yours asked for with work_chats send, and tell the person only what needs them.';

/** A leader below the Orchestrator: a project's own chat, at level 2. */
function isLeader(s) {
  return !!s && s.kind !== 'orchestrator' && s.kind !== 'specialist' && !s.archivedAt && !!s.projectId
    && require('./org-depth').level(s) === 2;
}

/** The final reports from `s`'s own helpers (not grandchildren) it has not been woken or told for. */
function due(s) {
  const FINAL = require('./organization').FINAL;
  return (s.reports || []).filter(n => FINAL.includes(n.type) && !n.readAt && !n.wokeAt && memory.getSession(n.from)?.parentId === s.id);
}

/** One per job: a work chat that reported "done" twice (a short one, then one with timings) is one outcome, the latest. */
const latestOf = notes => [...new Map(notes.map(n => [n.from, n])).values()];

const lineOf = n => `- ${short(memory.getSession(n.from)?.title, 80)} (${n.from}) — ${n.type}: ${short(n.text, 500)}`;

/** Mark the reports from these jobs as handled, so nobody is woken or told for them again. */
function markWoken(id, notes) {
  const ids = new Set(notes.map(n => n.id)), at = new Date().toISOString();
  if (ids.size) memory.updateSessions([id], row => ({ reports: (row.reports || []).map(n => (ids.has(n.id) ? { ...n, wokeAt: at } : n)) }));
}

/**
 * The Orchestrator's "done" reports, said without a model: a notice to each job's person and a line in its
 * conversation. → the reports handled (every report of those jobs in `notes`), marked.
 */
function tellDone(ceo, notes) {
  const done = latestOf(notes).filter(n => n.type === 'done');
  if (!done.length) return [];
  const notice = require('./reach-notice');
  for (const n of done) {
    const title = memory.getSession(n.from)?.title || 'A job';
    const personId = require('./session-access').ownerOf(n.from) || null;
    try {
      notice.deliver({ personId, title: `Done: ${short(title, 60)}`, text: short(n.text, 300),
        ...(personId ? { to: notice.ownIds(personId) } : {}), from: 'work' });
    } catch (e) { console.warn(`[leaders] notice for ${n.from}: ${e.message}`); }
    memory.append(ceo.id, { role: 'assistant', content: `✓ **${title}** is done: ${short(n.text, 300)}`, auto: true });
  }
  require('../live').changed('conversation', ceo.id, 'row');
  const jobs = new Set(done.map(n => n.from));
  const handled = notes.filter(n => jobs.has(n.from));
  markWoken(ceo.id, handled);
  return handled;
}

module.exports = { isLeader, due, latestOf, lineOf, markWoken, tellDone, LEAD_REPORTS, LEAD_RESULTS };
