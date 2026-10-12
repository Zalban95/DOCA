'use strict';

/**
 * Microsoft 365, as the everyday tools want it (accounts/adapter.js): Graph's calendar and mail through the account's
 * own token, in the same shapes as google.js. Graph reads and writes wall times with a zone, so every time goes out
 * and comes back as UTC (`Prefer: outlook.timezone="UTC"`). New mail is found with a delta query on the inbox, its
 * `@odata.deltaLink` kept as the cursor — the realistic "on every new mail" without a public address for push.
 */
const { call } = require('./http');
const mime = require('./mime');

const enc = encodeURIComponent;
const UTC = { Prefer: 'outlook.timezone="UTC"' };
const SELECT = 'id,conversationId,from,toRecipients,ccRecipients,subject,bodyPreview,receivedDateTime,isRead,categories,internetMessageId,parentFolderId';

const z = t => (t ? (/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`) : t);
const event = e => ({ id: e.id, title: e.subject || '(no title)', start: z(e.start?.dateTime), end: z(e.end?.dateTime), allDay: !!e.isAllDay,
  where: e.location?.displayName || '', note: e.bodyPreview || '', link: e.webLink || '' });
const when = t => ({ dateTime: new Date(t).toISOString().replace(/Z$/, ''), timeZone: 'UTC' });
const body = f => ({ ...(f.title !== undefined ? { subject: f.title } : {}), ...(f.where !== undefined ? { location: { displayName: f.where } } : {}),
  ...(f.note !== undefined ? { body: { contentType: 'text', content: f.note } } : {}), ...(f.allDay !== undefined ? { isAllDay: !!f.allDay } : {}),
  ...(f.start ? { start: when(f.start) } : {}), ...(f.end ? { end: when(f.end) } : {}) });

const calendar = {
  async events(rec, { from, to, q, max = 50 }) {
    const j = await call(rec, 'GET', '/v1.0/me/calendarView', { headers: UTC,
      query: { startDateTime: from, endDateTime: to, $orderby: 'start/dateTime', $top: Math.min(250, max), $select: 'id,subject,start,end,isAllDay,location,bodyPreview,webLink' } });
    const all = (j.value || []).map(event);
    return q ? all.filter(e => `${e.title} ${e.where} ${e.note}`.toLowerCase().includes(String(q).toLowerCase())) : all;
  },
  event: async (rec, id) => event(await call(rec, 'GET', `/v1.0/me/events/${enc(id)}`, { headers: UTC })),
  create: async (rec, f) => event(await call(rec, 'POST', '/v1.0/me/events', { body: body(f), headers: UTC })),
  update: async (rec, id, f) => event(await call(rec, 'PATCH', `/v1.0/me/events/${enc(id)}`, { body: body(f), headers: UTC })),
  remove: async (rec, id) => { await call(rec, 'DELETE', `/v1.0/me/events/${enc(id)}`); return {}; },
};

const who = r => ({ name: r?.emailAddress?.name || '', address: String(r?.emailAddress?.address || '').toLowerCase() });

function message(m, withBody) {
  const h = {};
  for (const x of m.internetMessageHeaders || []) h[String(x.name).toLowerCase()] = x.value;
  return { id: m.id, threadId: m.conversationId || null, from: who(m.from), to: (m.toRecipients || []).map(who), cc: (m.ccRecipients || []).map(who),
    subject: m.subject || '', snippet: m.bodyPreview || '', date: m.receivedDateTime || null, unread: m.isRead === false, inInbox: true,
    labels: m.categories || [], sent: false,
    headers: { messageId: m.internetMessageId || h['message-id'] || '', inReplyTo: h['in-reply-to'] || '', references: h.references || '', listId: h['list-id'] || '',
      listUnsubscribe: h['list-unsubscribe'] || '', precedence: h.precedence || '', autoSubmitted: h['auto-submitted'] || '', replyTo: h['reply-to'] || '' },
    ...(withBody ? { body: (m.body?.contentType === 'html' ? mime.stripHtml(m.body.content) : String(m.body?.content || '')).slice(0, 20000) } : {}) };
}

const recipients = a => [].concat(a || []).map(x => ({ emailAddress: { address: typeof x === 'string' ? x : x.address } }));

const mail = {
  async list(rec, { q = '', unread = false, max = 20, inbox = true }) {
    const query = { $top: Math.min(50, max), $select: SELECT, ...(q ? { $search: `"${String(q).replace(/"/g, '')}"` } : unread ? { $filter: 'isRead eq false' } : {}) };
    const j = await call(rec, 'GET', inbox ? '/v1.0/me/mailFolders/inbox/messages' : '/v1.0/me/messages', { query });
    return (j.value || []).filter(m => !unread || m.isRead === false).map(m => message(m, false));
  },
  meta: async (rec, id) => message(await call(rec, 'GET', `/v1.0/me/messages/${enc(id)}`, { query: { $select: `${SELECT},internetMessageHeaders` } }), false),
  read: async (rec, id) => message(await call(rec, 'GET', `/v1.0/me/messages/${enc(id)}`, { headers: { Prefer: 'outlook.body-content-type="text"' },
    query: { $select: `${SELECT},internetMessageHeaders,body` } }), true),
  async around(rec, m, n = 4) {
    const query = m.threadId ? { $filter: `conversationId eq '${String(m.threadId).replace(/'/g, "''")}'`, $top: n + 1, $select: SELECT }
      : { $search: `"from:${m.from.address}"`, $top: n + 1, $select: SELECT };
    const j = await call(rec, 'GET', '/v1.0/me/messages', { query }).catch(() => ({ value: [] }));
    return (j.value || []).filter(x => x.id !== m.id).slice(0, n).map(x => message(x, false));
  },
  async send(rec, { to, cc, subject, body: text, reply }) {
    if (reply?.id) {
      await call(rec, 'POST', `/v1.0/me/messages/${enc(reply.id)}/reply`, { body: { message: { toRecipients: recipients(to), ...(cc?.length ? { ccRecipients: recipients(cc) } : {}) }, comment: String(text || '') } });
      return { id: null, threadId: reply.threadId || null };
    }
    await call(rec, 'POST', '/v1.0/me/sendMail', { body: { message: { subject: String(subject || ''), body: { contentType: 'Text', content: String(text || '') },
      toRecipients: recipients(to), ...(cc?.length ? { ccRecipients: recipients(cc) } : {}) }, saveToSentItems: true } });
    return { id: null, threadId: null };
  },
  // A move gives the mail a new id in its new folder: the new one is what undo needs.
  archive: async (rec, id) => ({ id: (await call(rec, 'POST', `/v1.0/me/messages/${enc(id)}/move`, { body: { destinationId: 'archive' } })).id || id }),
  unarchive: async (rec, id) => ({ id: (await call(rec, 'POST', `/v1.0/me/messages/${enc(id)}/move`, { body: { destinationId: 'inbox' } })).id || id }),
  async label(rec, id, name) {
    const m = await call(rec, 'GET', `/v1.0/me/messages/${enc(id)}`, { query: { $select: 'categories' } });
    const cats = [...new Set([...(m.categories || []), name])];
    await call(rec, 'PATCH', `/v1.0/me/messages/${enc(id)}`, { body: { categories: cats } });
    return { id };
  },
  async unlabel(rec, id, name) {
    const m = await call(rec, 'GET', `/v1.0/me/messages/${enc(id)}`, { query: { $select: 'categories' } });
    await call(rec, 'PATCH', `/v1.0/me/messages/${enc(id)}`, { body: { categories: (m.categories || []).filter(c => c !== name) } });
    return { id };
  },
  /** New inbox mail since `cursor` ({deltaLink}); the first look takes the last two days and keeps the delta link. */
  async changes(rec, cursor) {
    let url = cursor?.deltaLink || null;
    const query = url ? undefined : { $select: 'id,receivedDateTime,isRead', $filter: `receivedDateTime ge ${new Date(Date.now() - 2 * 86400000).toISOString()}` };
    if (!url) url = '/v1.0/me/mailFolders/inbox/messages/delta';
    const ids = [];
    let next = null;
    for (let i = 0; i < 10 && url; i++) {
      const j = await call(rec, 'GET', url, i === 0 ? { query } : {});
      for (const m of j.value || []) if (!m['@removed']) ids.push(m.id);
      next = j['@odata.deltaLink'] || next;
      url = j['@odata.nextLink'] || null;
    }
    return { ids, cursor: next ? { deltaLink: next } : cursor || null };
  },
};

module.exports = { calendar, mail };
