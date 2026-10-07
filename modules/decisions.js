'use strict';

/**
 * Everything waiting for a person's decision, in one list (audit 2026-10-06, coh F12; TODO C1): questions the agents
 * are blocked on, settings and installs they proposed, MCP servers and services they prepared, recipe repairs, proposed
 * schedules, the model scout's suggestions and plans waiting for approval. Each lives on its own page; this is the one
 * place a screen (the ambient screen, a header badge) or a device (`GET /api/v1/decisions`, a watch's summary) asks
 * "what is waiting for me". Seen per person: what governs the hive (settings, installs, drafts, the scout) is a host's;
 * questions, plans, recipe repairs and schedules are each person's own.
 *
 * Each row: { kind, id, title, at, page } — `page` is the panel page where it is decided.
 */
const access = () => require('./harness/session-access');
const safe = fn => { try { return fn() || []; } catch { return []; } };

function list(person) {
  const host = !person?.id || access().isHost(person);
  const mine = sid => host || (!!sid && access().mayUse(person, sid));
  const out = [];
  for (const a of safe(() => require('./harness/approval').pending()).filter(a => mine(a.sessionId)))
    out.push({ kind: 'question', id: a.id, title: `${a.tool || 'A tool'} waits for an answer`, at: a.at, page: 'harness' });
  for (const s of safe(() => require('./harness/memory').listSessions().sessions)) {
    const p = s.plan;
    if (p?.state === 'proposed' && !s.archivedAt && mine(s.id)) out.push({ kind: 'plan', id: s.id, title: `Plan: ${p.title || s.title || s.id}`, at: p.updatedAt || s.updatedAt, page: 'harness' });
  }
  for (const r of safe(() => require('./recipes/store').list()))
    { const pr = safe(() => [require('./recipes/store').proposed(r.id)])[0]; if (pr && host) out.push({ kind: 'recipe', id: r.id, title: `Repair of the recipe ${r.title || r.id}`, at: pr.proposedAt, page: 'harness' }); }
  for (const s of safe(() => require('./schedules').listFor(person)).filter(s => s.state === 'proposed'))
    out.push({ kind: 'schedule', id: s.id, title: `Schedule: ${s.title || s.message || s.recipe || s.id}`.slice(0, 120), at: s.createdAt, page: 'harness' });
  if (host) {
    for (const p of safe(() => require('./harness/settings').list().pending)) out.push({ kind: 'setting', id: p.id, title: `Settings: ${p.reason || p.changes?.map(c => c.path).join(', ')}`.slice(0, 120), at: p.createdAt, page: 'harness' });
    for (const p of safe(() => require('./harness/installs').list().pending)) out.push({ kind: 'install', id: p.id, title: `Install: ${p.what || p.target}`.slice(0, 120), at: p.createdAt, page: 'harness' });
    for (const d of safe(() => require('./mcp/drafts').all())) out.push({ kind: 'mcp', id: d.id, title: `MCP server prepared: ${d.name || d.id}`, at: d.at, page: 'mcp' });
    for (const d of safe(() => require('./service-drafts').all())) out.push({ kind: 'service', id: d.id, title: `Service prepared: ${d.name || d.id}`, at: d.at, page: 'connectors' });
    for (const s of safe(() => require('./scout').list()).filter(s => s.state === 'pending')) out.push({ kind: 'scout', id: s.id, title: `Model scout: ${s.title}`, at: s.at, page: 'settings' });
  }
  return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function mount(app) {
  app.get('/api/decisions', (req, res) => {
    try { res.json({ decisions: list(require('./harness/turn/client').dashboardClient(req).user) }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

module.exports = { list, mount };
