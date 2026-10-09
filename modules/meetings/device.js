'use strict';

/**
 * A device's meetings (PROTOCOL §24): `GET /api/v1/meetings` lists its person's meetings — scheduled, open now, the
 * last week's — each with its link, so DocaMobile, DocaWear's phone or DocaDesk can show "in 5 min: Planning — Join"
 * and open the room in its web view (`<link>`, which is the panel opening that meeting). Scope `harness:chat`, as the
 * person's day (`/ambient`) is: it reads the device's own person's data and nothing else. The room itself — WebRTC,
 * sharing, control — is the page's; native call screens are each app's later work.
 */
const { requireScope } = require('../api-v1/auth');
const { ApiError } = require('../api-v1/errors');

const owner = device => require('../harness/turn/client').deviceOwner(device);

function mount(router) {
  router.get('/meetings', requireScope('harness:chat'), async (req, res, next) => {
    try {
      const person = owner(req.device);
      if (!person?.id) throw new ApiError(404, 'not_found', 'This device belongs to no person, so it has no meetings.');
      const list = await require('./store').forPerson(person.id, { since: new Date(Date.now() - 7 * 86400000).toISOString() });
      const views = await Promise.all(list.map(m => require('./index').view(m, person)));
      res.json({ meetings: views.map(m => ({ id: m.id, title: m.title, state: m.state, startsAt: m.startsAt, endsAt: m.endsAt, link: m.link,
        organizer: m.people.find(p => p.role === 'organizer')?.name || null, people: m.people.map(p => p.name), inRoom: m.room?.peers?.length || 0 })) });
    } catch (e) { next(e); }
  });
}

/** The route above in the OpenAPI document (openapi.js merges it). */
function paths({ obj, str, arr, json, std }) {
  return {
    '/meetings': { get: { tags: ['Harness'], summary: 'The person\'s meetings, each with its link', operationId: 'meetingsList', 'x-scope': 'harness:chat',
      description: 'Scheduled, open now and the last week\'s, newest first: id, title, state (proposed, scheduled, open, ended, cancelled), startsAt, endsAt, link (open it in the web view to join), organizer, people (names), inRoom (pages in the room now). PROTOCOL §24.',
      responses: { 200: json(obj({ meetings: arr(obj({ id: str(), title: str(), state: str(), startsAt: str(), endsAt: str(), link: str(), organizer: str(), people: arr(str()), inRoom: { type: 'integer' } })) })), ...std(401, 403, 404) } } },
  };
}

module.exports = { mount, paths };
