'use strict';

/**
 * The hive chat's part of the /api/v1 document (v1.js; PROTOCOL.md §23.3): its paths and its three events, beside the
 * module that serves them — openapi.js may only shrink, so it takes these as `...require('../people/openapi')…`.
 */
function shapes({ obj, str, int, bool, arr }) {
  const person = obj({ id: str(), name: str() });
  const message = obj({
    id: str(), spaceId: str(), seq: int({ description: 'Its number in the space: "read up to" is one number.' }),
    author: person, agent: str({ description: 'Set when the author\'s own agent wrote it (`orchestrator` or a specialist\'s id); draw it as `agentLabel`.' }),
    agentLabel: str(), text: str({ description: 'Markdown. Empty once deleted.' }), replyTo: str(), mentions: arr(str(), { description: 'People ids it names.' }),
    attachments: arr(obj({ name: str(), bytes: int(), mime: str(), kind: str() })), at: str(), editedAt: str(), deletedAt: str({ description: 'A tombstone: keep its place, show "deleted".' }),
    reactions: obj({}, { additionalProperties: arr(str()), description: '{emoji: [people ids]}' }), replies: int(),
  });
  const space = obj({
    id: str(), kind: str({ enum: ['dm', 'group', 'channel'] }), title: str(), name: str(), topic: str(), unread: int(), readSeq: int(), lastSeq: int(),
    muted: bool(), member: bool(), members: arr(obj({ id: str(), name: str(), role: str(), readSeq: int() })),
    last: obj({ id: str(), seq: int(), by: str(), text: str(), at: str() }),
  });
  return { person, message, space };
}

function paths({ obj, str, int, bool, arr, body, json, std }) {
  const { message, space } = shapes({ obj, str, int, bool, arr });
  const scope = { 'x-scope': 'harness:chat' };
  const id = { name: 'id', in: 'path', required: true, schema: str() };
  const tags = ['People'];
  const errs = std(400, 401, 403, 404);
  return {
    '/people': { get: { tags, summary: 'The person\'s hive chat: their spaces, channels to join, who they may message', operationId: 'peopleList', ...scope,
      description: 'As this device\'s person. 403 `person_required` for a device paired to nobody. `agents` are the person\'s own agent conversations (their Orchestrator first), which a client opens through /harness.',
      responses: { 200: json(obj({ spaces: arr(space), joinable: arr(space), agents: arr(obj({ id: str(), title: str(), kind: str() })),
        people: arr(obj({ id: str(), name: str(), team: str(), title: str(), may: bool() })), may: obj({ reach: str(), write: bool(), channel: str() }) })), ...std(401, 403) } } },
    '/people/dm': { post: { tags, summary: 'The direct conversation with someone (made once, found after)', operationId: 'peopleDm', ...scope,
      requestBody: body(obj({ person: str() }, { required: ['person'] })), responses: { 200: json(space), ...errs } } },
    '/people/spaces/{id}/messages': {
      get: { tags, summary: 'Messages of a space', operationId: 'peopleMessages', ...scope, parameters: [id,
        { name: 'before', in: 'query', schema: int() }, { name: 'after', in: 'query', schema: int() }, { name: 'limit', in: 'query', schema: int() },
        { name: 'thread', in: 'query', schema: str(), description: 'A message id: it and its replies.' }],
      responses: { 200: json(obj({ messages: arr(message), lastSeq: int() })), ...errs } },
      post: { tags, summary: 'Write in a space', operationId: 'peopleSend', ...scope, parameters: [id],
        description: '`@orchestrator` (or `@agent`, or a specialist\'s id) asks the person\'s own agent, under their level and approvals: its answer arrives later as a message with `agent` set.',
        requestBody: body(obj({ text: str({ maxLength: 8000 }), replyTo: str() }, { required: ['text'] })), responses: { 200: json(message), ...std(400, 401, 403, 404, 409, 413) } } },
    '/people/spaces/{id}/read': { post: { tags, summary: 'Mark read up to a message number', operationId: 'peopleRead', ...scope, parameters: [id],
      requestBody: body(obj({ seq: int() })), responses: { 200: json(obj({ spaceId: str(), readSeq: int(), lastSeq: int() })), ...errs } } },
    '/people/spaces/{id}/typing': { post: { tags, summary: 'Say the person is typing (the others hear `people.typing`)', operationId: 'peopleTyping', ...scope, parameters: [id],
      responses: { 200: json(obj({ ok: bool() })), ...errs } } },
    '/people/messages/{id}/react': { post: { tags, summary: 'Add or take back a reaction', operationId: 'peopleReact', ...scope, parameters: [id],
      requestBody: body(obj({ emoji: str(), on: bool() }, { required: ['emoji'] })), responses: { 200: json(message), ...std(400, 401, 403, 404, 409) } } },
  };
}

function events({ obj, str, int, bool, arr }) {
  const { person, message } = shapes({ obj, str, int, bool, arr });
  return {
    'people.message': { audience: 'device', payload: obj({ spaceId: str(), space: obj({ id: str(), kind: str(), name: str() }),
      what: str({ enum: ['new', 'edited', 'deleted', 'reacted'] }), message, notify: bool({ description: 'A direct message or a mention, not muted, outside this device\'s quiet hours: worth a notification. The hub also sends it as an `alert` with `ext.people` — drop that alert when you draw this.' }) }),
      note: 'The hive chat: to the devices (with harness:chat) of every member of the space, the writer\'s included.' },
    'people.typing': { audience: 'device', payload: obj({ spaceId: str(), by: person }), note: 'Ephemeral: show it for a few seconds.' },
    'people.read': { audience: 'device', payload: obj({ spaceId: str(), by: person, seq: int() }), note: 'A read receipt, ephemeral.' },
  };
}

module.exports = { paths, events };
