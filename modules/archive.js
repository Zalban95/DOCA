'use strict';

/**
 * The Archive (asked 2026-10-06: "have an archive for all of them"): what was put away rather than deleted, in one
 * place, each brought back with one click. Conversations and missions were already archived where they live; projects
 * and the agents' computers now are too — a computer archived is stopped with its desktop, logins and files kept, out of
 * the Computers tab, the agents' list and the tidy-up sweep, until restored or lent again. Each person sees the
 * conversations and missions they may open; projects and computers are the machine's, so a host's. Signed-in browsers
 * nobody opened for a week (kind `device`, screens/archive.js) are each person's own, and every one a host's.
 */
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const KINDS = ['conversation', 'mission', 'project', 'computer', 'device'];

const whoseName = (d, person) => {
  if (!d.userId || d.userId === person?.id) return '';
  const u = require('./auth/store').userById(d.userId);
  return u ? ` of ${u.name || u.email}` : '';
};

function isHost(person) { return !person?.id || require('./harness/session-access').isHost(person); }
const mayOpen = (person, sessionId) => isHost(person) || (!!sessionId && require('./harness/session-access').mayUse(person, sessionId));

async function list(person) {
  const memory = require('./harness/memory');
  const out = [];
  for (const s of memory.listSessions().sessions)
    if (s.archivedAt && mayOpen(person, s.id)) out.push({ kind: 'conversation', id: s.id, title: s.title || s.id, archivedAt: s.archivedAt, detail: s.kind || '' });
  for (const m of require('./agents/missions').list({ all: true, limit: 1000 }))
    if (m.archivedAt && mayOpen(person, m.sessionId)) out.push({ kind: 'mission', id: m.id, title: `${m.label || m.agentId}: ${String(m.task || '').slice(0, 80)}`, archivedAt: m.archivedAt, detail: m.state });
  for (const d of require('./api-v1/devices').list())
    if (d.kind === 'browser' && d.archivedAt && !d.revokedAt && (isHost(person) || d.userId === person.id))
      out.push({ kind: 'device', id: d.id, title: d.name, archivedAt: d.archivedAt, detail: `a signed-in browser${whoseName(d, person)}; once restored, its person signs in again` });
  if (isHost(person)) {
    for (const p of require('./projects/store').list())
      if (p.archivedAt) out.push({ kind: 'project', id: p.id, title: p.name || p.root, archivedAt: p.archivedAt, detail: p.root });
    try {
      for (const c of await require('./computers').list({ all: true }))
        if (c.archivedAt) out.push({ kind: 'computer', id: c.id, title: c.name, archivedAt: c.archivedAt, detail: c.purpose || '' });
    } catch { /* computers unavailable */ }
  }
  return out.sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
}

/** Put one away (`on`) or bring it back. */
async function set(kind, id, on, person) {
  if (!KINDS.includes(kind)) throw bad(`Nothing of the kind "${kind}" is archived: ${KINDS.join(', ')}.`, 404);
  if (kind === 'conversation') {
    if (!mayOpen(person, id)) throw bad('No such conversation.', 404);
    return require('./harness/organization').archive(id, on);
  }
  if (kind === 'mission') {
    const m = require('./agents/missions').get(id);
    if (!m || !mayOpen(person, m.sessionId)) throw bad('No such mission.', 404);
    return require('./agents/missions').archive(id, { on });
  }
  if (kind === 'device') {
    const d = require('./api-v1/devices').get(id);
    if (!d || d.kind !== 'browser' || d.revokedAt || !(isHost(person) || d.userId === person.id)) throw bad('No such browser.', 404);
    const a = require('./screens/archive');
    return on ? a.archive(id) : a.restore(id);
  }
  if (!isHost(person)) throw bad('Projects and computers are the machine\'s: an admin archives them.', 403);
  if (kind === 'project') return require('./projects/store').update(id, { archivedAt: on ? new Date().toISOString() : null });
  return require('./computers').archive(id, on);
}

function mount(app) {
  const who = req => require('./harness/turn/client').dashboardClient(req).user;
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/archive', h(async req => ({ items: await list(who(req)) })));
  app.post('/api/archive/:kind/:id', h(async req => ({ ok: true, item: await set(req.params.kind, req.params.id, req.body?.on !== false, who(req)) })));
}

module.exports = { list, set, mount, KINDS };
