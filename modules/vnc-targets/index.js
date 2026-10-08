'use strict';

/**
 * VNC in Machines (asked 2026-10-08: "let's add a vnc section in machines, same logic, showing the running and connected
 * ones on the live and so on"). Screens a person with host adds by address — kept with their passwords in a protected
 * file (store.js) — read by DOCA's own RFB client (rfb.js): a row each in the status column (machines/rows.js, kind
 * `vnc`: connected, reachable or unreachable — state.js), a picture in Live while it is shown (shots.js), a console in
 * the panel with the hub signing in for the browser (proxy.js), and the agent's vnc_look and vnc_input
 * (harness/toolbox/vnc.js). Displays DOCA already knows — a running VM's, the agents' computers'
 * — are listed beside them read-only and never twice (known.js).
 *
 *   GET    /api/machines/vnc                   the targets with their state, and the known displays
 *   POST   /api/machines/vnc                   add one {name, host, port, password?}
 *   PUT    /api/machines/vnc/:id               change one (a password left out or masked is kept; '' forgets it)
 *   DELETE /api/machines/vnc/:id
 *   GET    /api/machines/vnc/:id/shot          its picture for Live, while Live asks
 *   GET    /api/machines/vnc/:id/test          sign in now: its size and name, or why not
 *   GET    /api/machines/vnc/:id/console       the noVNC page (?view=1 watches; ?drive=1 takes over)
 *   WS     /ws/vnc/:id[?drive=1]               its stream (proxy.js; the upgrade router demands host)
 * All of /api/machines is host (auth/rights.js).
 */
const store = require('./store');
const state = require('./state');
const known = require('./known');

/** Whether any target is added: the agent's VNC tools exist only then (turn/tool-shape.js), so they cost no prompt before. */
const any = () => store.list().length > 0;

const consoleUrl = (id, drive) => `/api/machines/vnc/${encodeURIComponent(id)}/console?${drive ? 'drive=1' : 'view=1'}`;

/** Every target with where it stands and whose display it is; the known displays not already a target. */
async function detailed(have) {
  const displays = await known.known(have);
  const targets = await Promise.all(store.list().map(async t => {
    const same = known.same(t, displays);
    return { ...t, state: await state.stateOf(t), driving: state.driving(t.id),
      same: same ? { kind: same.kind, id: same.id, name: same.name } : null, console: { watch: consoleUrl(t.id, false), drive: consoleUrl(t.id, true) } };
  }));
  const taken = new Set(targets.map(t => t.same && `${t.same.kind}:${t.same.id}`).filter(Boolean));
  return { targets, known: displays.filter(d => !taken.has(`${d.kind}:${d.id}`)).map(({ key, ...d }) => d) };
}

function mount(app) {
  const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
  const changed = () => require('../machines/rows')._reset();
  app.get('/api/machines/vnc', async (req, res) => { try { res.json(await detailed()); } catch (e) { fail(res, e); } });
  app.post('/api/machines/vnc', (req, res) => { try { const t = store.save({ ...req.body, id: undefined }); changed(); res.status(201).json(t); } catch (e) { fail(res, e); } });
  app.put('/api/machines/vnc/:id', (req, res) => {
    try { const t = store.save({ ...req.body, id: req.params.id }); state.probe(t, { fresh: true }).catch(() => {}); changed(); res.json(t); } catch (e) { fail(res, e); }
  });
  app.delete('/api/machines/vnc/:id', (req, res) => { try { res.json(store.remove(req.params.id)); changed(); } catch (e) { fail(res, e); } });
  app.get('/api/machines/vnc/:id/test', async (req, res) => {
    const t = store.connection(req.params.id);
    if (!t) return res.status(404).json({ error: 'No such VNC target.' });
    state.probe(t, { fresh: true }).catch(() => {});
    changed();
    try { const { sock, r } = await require('./rfb').open(t); try { res.json({ ok: true, ...await require('./rfb').init(sock, r) }); } finally { sock.destroy(); } }
    catch (e) { res.json({ ok: false, why: e.message }); }
  });
  app.get('/api/machines/vnc/:id/shot', (req, res) => {
    const png = require('./shots').get(req.params.id);
    if (!png) return res.status(404).json({ error: require('./shots').error(req.params.id) || 'No picture of it yet.' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  });
  app.get('/api/machines/vnc/:id/console', (req, res) => {
    const t = store.find(req.params.id);
    if (!t) return res.status(404).type('text/plain').send('No such VNC target.');
    const ws = `ws/vnc/${encodeURIComponent(t.id)}${req.query.drive === '1' ? '?drive=1' : ''}`;
    res.type('html').set('Cache-Control', 'no-store').send(require('../machines/vm-console').pageFor(t.name, ws));
  });
}

module.exports = { mount, detailed, any, consoleUrl, upgrade: (...a) => require('./proxy').upgrade(...a) };
