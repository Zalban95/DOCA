'use strict';

/**
 * Work a person stopped waits for that person (asked 2026-10-06: "we need to be able to restart if we want to, and the
 * agent can tell us that some work stopped and ask if we want to restart or drop"). A work chat whose job is
 * `stopped` — by its own Stop, or because a specialist it sent was stopped (supervisor.missionStopped) — is listed to
 * the Orchestrator, which says so in one line and asks once; the answer is `work_chats {action: restart | drop}`. The
 * Harness shows the same rows with ↻ Restart and Drop, for a person who would rather click. Nothing restarts by itself.
 */
const memory = () => require('./memory');
const RESUMED = '[panel] The person asked you to carry on with your job after it was stopped. Look at where it stood and continue.';

/** Work chats stopped and not yet decided, under one Orchestrator (or all). */
function stopped(parentId = null) {
  return memory().listSessions().sessions.filter(s => s.kind === 'work' && !s.archivedAt && s.job?.state === 'stopped'
    && (!parentId || s.parentId === parentId));
}

/** The Orchestrator's prompt: what waits on the person, and how to ask. */
function block(session) {
  if (session?.kind !== 'orchestrator') return '';
  const rows = stopped(session.id);
  if (!rows.length) return '';
  return ['# Stopped work', ...rows.map(s => `- ${s.id} (${s.title || 'work chat'}): STOPPED${s.job.stoppedWhy ? ` — ${s.job.stoppedWhy}` : ' by a person'}${s.job.since ? `, job since ${s.job.since}` : ''}`),
    'Work a person stopped waits for them. In your next reply, tell them in one line what it was and ask once: restart it or drop it? '
      + 'Then call work_chats with action restart or drop and its sessionId. Never restart without a yes, and if you already asked in this conversation, do not ask again.'].join('\n');
}

/** Restart (it carries on where it stood) or drop (it ends, kept as it is). */
function decide(id, go, ctx = {}) {
  const org = require('./organization');
  if (ctx.sessionId && !org.canManage(ctx.sessionId, id)) throw Object.assign(new Error('Only its own Orchestrator decides about a work chat.'), { status: 403 });
  const s = memory().getSession(id);
  if (!s || s.kind !== 'work' || !s.job) throw Object.assign(new Error(`No work chat ${id}.`), { status: 404 });
  if (s.job.state !== 'stopped') return { sessionId: id, state: s.job.state, note: `It is ${s.job.state}, not stopped: nothing to decide.` };
  const at = new Date().toISOString();
  if (!go) {
    memory().updateSession(id, { job: { ...s.job, state: 'dropped', droppedAt: at } });
    require('./workview').announce(id, { quiet: true });   // the person's own decision: devices update, nothing buzzes
    return { sessionId: id, state: 'dropped', note: 'Dropped. Its transcript stays; nothing more runs.' };
  }
  const { stoppedWhy, ...job } = s.job;
  memory().updateSession(id, { job: { ...job, state: 'working', autoTurns: 0, idleTurns: 0, restartedAt: at } });
  const how = require('./supervisor').wake(id, RESUMED);
  return { sessionId: id, state: 'working', woken: how, note: how === 'woken' ? 'Restarted: it carries on where it stood.' : `Marked to carry on; not started yet (${how}).` };
}

function mount(app) {
  const h = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const mine = req => { require('./session-access').check(require('./turn/client').dashboardClient(req).user, req.params.id); return req.params.id; };
  app.post('/api/harness/work/:id/restart', h(req => decide(mine(req), true)));
  app.post('/api/harness/work/:id/drop', h(req => decide(mine(req), false)));
}

module.exports = { stopped, block, decide, mount, RESUMED };
