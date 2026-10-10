'use strict';

/**
 * The hive chat for a device (a capability lands in /api/v1 too; PROTOCOL.md §23.3): the device acts as its person —
 * the same spaces, the same rules (spaces.js, messages.js) — under `harness:chat`, the scope a device already holds to
 * converse as that person. A device paired to nobody (an older token) has no person and gets 403 `person_required`.
 *
 *   GET  /people                                 the person's spaces (unread, last line), channels to join, who they may message
 *   POST /people/dm {person}                     the direct conversation with someone
 *   GET  /people/spaces/{id}/messages            ?before|after=<seq>&limit, or ?thread=<message id>
 *   POST /people/spaces/{id}/messages            {text, replyTo}  — @orchestrator asks the person's own agent
 *   POST /people/spaces/{id}/read {seq}          read up to
 *   POST /people/spaces/{id}/typing              typing now (ephemeral to the others)
 *   POST /people/messages/{id}/react {emoji, on} a reaction
 *   GET  /people/notify                          where a message reaches the person beyond the panel (forward.js)
 *   POST /people/notify {devices, chats, each}   change it, as the person
 * Pushed: `people.message` (durable), `people.typing` and `people.read` (ephemeral); a direct message or a mention also
 * arrives as an `alert` with `ext.people` (deliver.js), so a client that draws `people.message` drops that alert.
 */
const { can } = require('../api-v1/auth');
const { sendError } = require('../api-v1/errors');
const spaces = require('./spaces');
const messages = require('./messages');

const SCOPE = 'harness:chat';

const run = fn => async (req, res) => {
  if (!can(req, SCOPE)) return sendError(res, 403, 'scope_required', `This action requires ${SCOPE}`, { required: [SCOPE] });
  const device = require('../api-v1/devices').get(req.device.id);
  const p = require('../harness/turn/client').deviceOwner(device);
  if (!p?.id) return sendError(res, 403, 'person_required', 'The hive chat is between people, and this device is paired to nobody: pair it again from a person\'s account.');
  try { res.json(await fn(req, p, device)); }
  catch (e) { sendError(res, e.status || 500, e.status === 404 ? 'not_found' : e.status === 403 ? 'forbidden' : e.status === 400 || e.status === 413 ? 'invalid_request' : e.status === 409 ? 'conflict' : 'error', e.message); }
};

const client = (device, p) => ({ ...require('../api-v1/harness').clientOf(device), user: p });   // the device's own shape, as its turns have

function mount(router) {
  router.get('/people', run(async (req, p) => ({ ...(await spaces.list(p)), people: require('./routes').directory(p) })));
  router.post('/people/dm', run((req, p) => spaces.dm(p, String(req.body?.person || ''))));
  router.get('/people/spaces/:id/messages', run((req, p) => messages.list(p, req.params.id, req.query)));
  router.post('/people/spaces/:id/messages', run((req, p, d) => messages.post(p, req.params.id, { text: req.body?.text, replyTo: req.body?.replyTo || null }, { client: client(d, p) })));
  router.post('/people/spaces/:id/read', run((req, p) => messages.read(p, req.params.id, req.body?.seq)));
  router.post('/people/spaces/:id/typing', run((req, p) => messages.typing(p, req.params.id)));
  router.get('/people/notify', run((req, p) => require('./forward').view(p.id)));
  router.post('/people/notify', run((req, p) => require('./forward').set(p.id, req.body || {})));
  router.post('/people/messages/:id/react', run((req, p) => messages.react(p, req.params.id, req.body?.emoji, req.body?.on !== false)));
}

module.exports = { mount, SCOPE };
