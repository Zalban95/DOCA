'use strict';

/**
 * What the panel could do and a device could not (audit 2026-10-06, cl 7–8, 18–19; coh F12; TODO C1/D1, approved
 * 2026-10-07): stop a specialist, restart or drop a work chat a person stopped, put a conversation or a mission away,
 * see what works on its own, read the person's day and the decisions waiting for them. Each is the panel's own code,
 * called as the device's owner — the conversation's access rule (session-access.js) decides, and anything else is a 404
 * as if absent. Mounted on the `/harness` router and the top router by router.js (one line, it may only shrink).
 */
const { requireScope } = require('./auth');
const { ApiError } = require('./errors');

const owner = device => require('../harness/turn/client').deviceOwner(device);
const access = () => require('../harness/session-access');
const mine = (device, sid) => { if (!sid || !access().mayUse(owner(device), sid)) throw new ApiError(404, 'not_found', 'Unknown conversation'); };
const wrap = fn => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { next(e.status && !(e instanceof ApiError) ? new ApiError(e.status, e.status === 404 ? 'not_found' : 'invalid_request', e.message) : e); } };

function mount(harnessApi, router) {
  // A specialist's mission: stop it at its next step; what sent it waits for its person (agents/stopping.js).
  harnessApi.post('/missions/:id/stop', requireScope('harness:chat'), wrap(req => require('../agents/stopping').stop(owner(req.device), req.params.id)));
  // A finished or paused mission put away (or back): devices hear it quietly (missions.archive).
  harnessApi.post('/missions/:id/archive', requireScope('harness:chat'), wrap(req => {
    const m = require('../agents/missions').get(req.params.id);
    if (!m) throw new ApiError(404, 'not_found', 'Unknown mission');
    mine(req.device, m.sessionId || m.by);
    return { mission: require('../agents/missions').archive(m.id, { on: req.body?.on !== false }) };
  }));
  // A work chat a person stopped: carry on, or end it without waking anyone (harness/stopped-work.js).
  for (const verb of ['restart', 'drop'])
    harnessApi.post(`/work/:id/${verb}`, requireScope('harness:chat'), wrap(req => {
      mine(req.device, req.params.id);
      return require('../harness/stopped-work').decide(req.params.id, verb === 'restart');
    }));
  // A conversation put away or back (organization.archive — its missions with it), not deleted.
  harnessApi.post('/sessions/:id/archive', requireScope('harness:sessions'), wrap(req => {
    mine(req.device, req.params.id);
    return { session: require('../harness/organization').archive(req.params.id, req.body?.on !== false) };
  }));
  // What runs on its own right now: missions, automatic turns with why, and work a person stopped.
  harnessApi.get('/working', requireScope('harness:chat'), wrap(req => require('../agents/stopping').working(owner(req.device))));

  // The person's day — the ambient screen's weather, calendar and notices (ambient.today) — for a device's own screen.
  router.get('/ambient', requireScope('harness:chat'), wrap(req => require('../ambient').today(owner(req.device),
    { place: req.query.place || require('../settings-schema').value('ambient.place') || '', units: req.query.units })));
  // Everything waiting for the person's decision, one list (decisions.js), for a badge or a watch's summary.
  router.get('/decisions', requireScope('harness:chat'), wrap(req => ({ decisions: require('../decisions').list(owner(req.device)) })));
}

/** The routes above in the OpenAPI document (openapi.js merges this; it may only shrink). */
function openapi({ obj, str, bool, arr, body, json, std }) {
  const scope = s => ({ 'x-scope': s }), id = [{ name: 'id', in: 'path', required: true, schema: str() }];
  const post = (tag, summary, operationId, sc, description, extra = {}) => ({ post: { tags: [tag], summary, operationId, ...scope(sc), description, parameters: id, ...extra, responses: { 200: json(obj({})), ...std(401, 403, 404) } } });
  return {
    '/harness/missions/{id}/stop': post('Harness', 'Stop a specialist\'s mission at its next step', 'harnessMissionStop', 'harness:chat', 'What sent it waits for its person instead of being woken with the result (PROTOCOL §23).'),
    '/harness/missions/{id}/archive': post('Harness', 'Put a finished mission away, or back', 'harnessMissionArchive', 'harness:chat', 'Body {on}: false brings it back. Devices hear it as agent.mission with archivedAt and quiet: take the row off, notify nothing.', { requestBody: body(obj({ on: bool() }), { required: false }) }),
    '/harness/work/{id}/restart': post('Harness', 'Carry on with a work chat a person stopped', 'harnessWorkRestart', 'harness:chat', 'It resumes where it stood. Only a work chat whose job is stopped; otherwise it says what it is.'),
    '/harness/work/{id}/drop': post('Harness', 'End a work chat a person stopped, waking nobody', 'harnessWorkDrop', 'harness:chat', 'Its transcript stays; nothing more runs. Devices hear it quietly, as cancelled.'),
    '/harness/sessions/{id}/archive': post('Harness', 'Put a conversation away, or back (not deleted)', 'harnessSessionArchive', 'harness:sessions', 'Body {on}: false brings it back. Its missions go with it. DELETE /harness/sessions/{id} still deletes for good.', { requestBody: body(obj({ on: bool() }), { required: false }) }),
    '/harness/working': { get: { tags: ['Harness'], summary: 'What runs on its own right now, with why', operationId: 'harnessWorking', ...scope('harness:chat'), description: 'missions (running), auto (turns the supervisor started, with why) and stopped (work a person stopped, waiting for restart or drop) — of conversations this device\'s person may open.', responses: { 200: json(obj({ missions: arr(obj({})), auto: arr(obj({})), stopped: arr(obj({})) })), ...std(401, 403) } } },
    '/ambient': { get: { tags: ['Harness'], summary: 'The person\'s day: weather, today\'s calendar, what waits for them', operationId: 'ambient', ...scope('harness:chat'), description: 'What the panel\'s ambient screen shows. place (a town; default the hive\'s ambient.place) and units (metric, imperial) are optional.', parameters: [{ name: 'place', in: 'query', schema: str() }, { name: 'units', in: 'query', schema: str() }], responses: { 200: json(obj({ weather: obj({}), calendar: obj({}), notices: arr(obj({})), at: str() })), ...std(401, 403) } } },
    '/decisions': { get: { tags: ['Harness'], summary: 'Everything waiting for the person\'s decision', operationId: 'decisions', ...scope('harness:chat'), description: 'Questions the agents are blocked on, plans, recipe repairs and schedules (the person\'s own); for a host also settings and installs the agent proposed, MCP servers and services it prepared, and the model scout\'s suggestions. Each {kind, id, title, at, page}; decided in the panel page named.', responses: { 200: json(obj({ decisions: arr(obj({ kind: str(), id: str(), title: str(), at: str(), page: str() })) })), ...std(401, 403) } } },
  };
}

module.exports = { mount, openapi };
