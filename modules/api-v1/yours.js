'use strict';

/**
 * What a person has in the hive, for their devices (TODO H11.3: a capability lands in /api/v1 too) — the recipes they
 * can run, their schedules, and the face. Each answers as the device's person, exactly as the panel's routes do.
 *
 *   GET  /recipes                 harness:chat      what can be run, with its parameters
 *   POST /recipes/:id/run         harness:chat      run one as the person ({values}); answers when it ends, approvals asked as usual
 *   GET  /schedules               harness:sessions  the person's schedules
 *   POST /schedules/:id/state     harness:chat      {state: on|paused} — switching one on is the person's decision, so a device of kind
 *                                                   `agent` (an agent, not a person) may pause and never switch on
 *   GET  /face                    harness:sessions  what the hive is doing, as this person may see it ({state, detail})
 *   GET  /face/stream             harness:sessions  the same, as server-sent events on every change and a heartbeat
 */
const { can } = require('./auth');
const { sendError } = require('./errors');

const need = (req, res, scope) => { if (can(req, scope)) return true; sendError(res, 403, 'scope_required', `This action requires ${scope}`, { required: [scope] }); return false; };
const who = req => require('../harness/turn/client').deviceOwner(require('./devices').get(req.device.id));
const fail = (res, e) => sendError(res, e.status || 500, e.status === 404 ? 'not_found' : e.status === 400 ? 'invalid_request' : 'error', e.message);

function mount(router) {
  router.get('/recipes', (req, res) => {
    if (!need(req, res, 'harness:chat')) return;
    res.json({ recipes: require('../recipes/store').list().map(r => ({ id: r.id, title: r.title, description: r.description || '', params: r.params || [] })) });
  });
  router.post('/recipes/:id/run', async (req, res) => {
    if (!need(req, res, 'harness:chat')) return;
    const r = require('../recipes/store').get(req.params.id);
    if (!r) return sendError(res, 404, 'not_found', 'No such recipe');
    const device = require('./devices').get(req.device.id), person = who(req);
    try { res.json(await require('../recipes/run').run(r, { params: req.body?.values || {}, person, client: { name: device.name, kind: device.kind, user: person } })); }
    catch (e) { fail(res, e); }
  });

  const schedules = () => require('../schedules');
  router.get('/schedules', (req, res) => {
    if (!need(req, res, 'harness:sessions')) return;
    res.json({ schedules: schedules().listFor(who(req)) });
  });
  router.post('/schedules/:id/state', (req, res) => {
    if (!need(req, res, 'harness:chat')) return;
    const person = who(req), s = schedules().get(req.params.id);
    if (!s || (s.by !== person?.id && !require('../harness/session-access').isHost(person))) return sendError(res, 404, 'not_found', 'No such schedule');
    if (req.body?.state === 'on' && req.device.kind === 'agent') return sendError(res, 403, 'person_only', 'Switching a schedule on is a person\'s decision; an agent may pause one.');
    try { res.json(schedules().setState(req.params.id, req.body?.state)); } catch (e) { fail(res, e); }
  });

  const face = () => require('../face/state');
  router.get('/face', (req, res) => { if (need(req, res, 'harness:sessions')) res.json(face().viewFor(who(req))); });
  router.get('/face/stream', (req, res) => {
    if (!need(req, res, 'harness:sessions')) return;
    const person = who(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let last = '';
    const send = force => { const v = JSON.stringify(face().viewFor(person)); if (!force && v === last) return; last = v; try { res.write(`data: ${v}\n\n`); } catch { /* gone */ } };
    const off = face().subscribe(() => send(false));
    const beat = setInterval(() => send(true), 15000);
    send(true);
    res.on('close', () => { off(); clearInterval(beat); });
  });
}

module.exports = { mount };
