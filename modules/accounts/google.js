'use strict';

/**
 * Google, as the everyday tools want it (accounts/adapter.js): Calendar v3 and Gmail v1 through the account's own
 * token, answered in one shape both providers share — an event { id, title, start, end, allDay, where, note, link } and a
 * mail { id, threadId, from: {name, address}, to, cc, subject, snippet, date, unread, inInbox, labels, headers, body? }.
 */
const { call } = require('./http');
const mime = require('./mime');

const CAL = '/calendar/v3/calendars/primary/events';
const GM = '/gmail/v1/users/me';
const HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References', 'List-Id', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted', 'Reply-To'];
const enc = encodeURIComponent;

const event = e => ({ id: e.id, title: e.summary || '(no title)', start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
  allDay: !e.start?.dateTime, where: e.location || '', note: e.description || '', link: e.htmlLink || '' });
const when = (t, allDay) => (allDay ? { date: String(t).slice(0, 10) } : { dateTime: new Date(t).toISOString() });
const body = f => ({ ...(f.title !== undefined ? { summary: f.title } : {}), ...(f.where !== undefined ? { location: f.where } : {}),
  ...(f.note !== undefined ? { description: f.note } : {}),
  ...(f.start ? { start: when(f.start, f.allDay) } : {}), ...(f.end ? { end: when(f.end, f.allDay) } : {}) });

const calendar = {
  async events(rec, { from, to, q, max = 50 }) {
    const j = await call(rec, 'GET', CAL, { query: { timeMin: from, timeMax: to, q, singleEvents: 'true', orderBy: 'startTime', maxResults: Math.min(250, max) } });
    return (j.items || []).filter(e => e.status !== 'cancelled').map(event);
  },
  event: async (rec, id) => event(await call(rec, 'GET', `${CAL}/${enc(id)}`)),
  create: async (rec, f) => event(await call(rec, 'POST', CAL, { body: body(f) })),
  update: async (rec, id, f) => event(await call(rec, 'PATCH', `${CAL}/${enc(id)}`, { body: body(f) })),
  remove: async (rec, id) => { await call(rec, 'DELETE', `${CAL}/${enc(id)}`); return {}; },
};

function headerMap(list) {
  const h = {};
  for (const x of list || []) h[String(x.name).toLowerCase()] = x.value;
  return h;
}

function plain(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  for (const p of payload.parts || []) { const t = plain(p); if (t) return t; }
  if (payload.mimeType === 'text/html' && payload.body?.data) return mime.stripHtml(Buffer.from(payload.body.data, 'base64url').toString('utf8'));
  return '';
}

function message(m, withBody) {
  const h = headerMap(m.payload?.headers);
  const labels = m.labelIds || [];
  return { id: m.id, threadId: m.threadId, from: mime.address(h.from), to: mime.addresses(h.to), cc: mime.addresses(h.cc), subject: h.subject || '',
    snippet: m.snippet || '', date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : (h.date ? new Date(h.date).toISOString() : null),
    unread: labels.includes('UNREAD'), inInbox: labels.includes('INBOX'), labels, sent: labels.includes('SENT'),
    headers: { messageId: h['message-id'] || '', inReplyTo: h['in-reply-to'] || '', references: h.references || '', listId: h['list-id'] || '',
      listUnsubscribe: h['list-unsubscribe'] || '', precedence: h.precedence || '', autoSubmitted: h['auto-submitted'] || '', replyTo: h['reply-to'] || '' },
    ...(withBody ? { body: plain(m.payload).slice(0, 20000) } : {}) };
}

const meta = (rec, id) => call(rec, 'GET', `${GM}/messages/${enc(id)}?format=metadata&${HEADERS.map(x => `metadataHeaders=${x}`).join('&')}`).then(m => message(m, false));

async function labelId(rec, name, make) {
  const j = await call(rec, 'GET', `${GM}/labels`);
  const hit = (j.labels || []).find(l => l.name.toLowerCase() === String(name).toLowerCase() || l.id === name);
  if (hit || !make) return hit?.id || null;
  return (await call(rec, 'POST', `${GM}/labels`, { body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } })).id;
}
const modify = (rec, id, add, remove) => call(rec, 'POST', `${GM}/messages/${enc(id)}/modify`, { body: { addLabelIds: add, removeLabelIds: remove } });

const mail = {
  async list(rec, { q = '', unread = false, max = 20, inbox = true }) {
    const query = [inbox ? 'in:inbox' : '', unread ? 'is:unread' : '', q].filter(Boolean).join(' ');
    const j = await call(rec, 'GET', `${GM}/messages`, { query: { q: query, maxResults: Math.min(50, max) } });
    return Promise.all((j.messages || []).map(m => meta(rec, m.id)));
  },
  meta,
  read: async (rec, id) => message(await call(rec, 'GET', `${GM}/messages/${enc(id)}?format=full`), true),
  /** Recent mails of the same thread, else from the same sender: what the reader is given beside a mail. */
  async around(rec, m, n = 4) {
    const q = m.threadId ? null : `from:${m.from.address}`;
    if (m.threadId) {
      const t = await call(rec, 'GET', `${GM}/threads/${enc(m.threadId)}?format=metadata&${HEADERS.slice(0, 5).map(x => `metadataHeaders=${x}`).join('&')}`).catch(() => null);
      const rest = (t?.messages || []).filter(x => x.id !== m.id).map(x => message(x, false));
      if (rest.length) return rest.slice(-n);
    }
    return (await mail.list(rec, { q: q || `from:${m.from.address}`, max: n + 1, inbox: false })).filter(x => x.id !== m.id).slice(0, n);
  },
  async send(rec, { to, cc, subject, body: text, reply }) {
    const raw = mime.build({ to, cc, subject, body: text, inReplyTo: reply?.headers?.messageId, references: [reply?.headers?.references, reply?.headers?.messageId].filter(Boolean).join(' ') });
    const j = await call(rec, 'POST', `${GM}/messages/send`, { body: { raw, ...(reply?.threadId ? { threadId: reply.threadId } : {}) } });
    return { id: j.id || null, threadId: j.threadId || null };
  },
  archive: async (rec, id) => { await modify(rec, id, [], ['INBOX']); return { id }; },
  unarchive: async (rec, id) => { await modify(rec, id, ['INBOX'], []); return { id }; },
  label: async (rec, id, name) => { await modify(rec, id, [await labelId(rec, name, true)], []); return { id }; },
  unlabel: async (rec, id, name) => { const l = await labelId(rec, name, false); if (l) await modify(rec, id, [], [l]); return { id }; },
  /** Mail that arrived in the inbox since `cursor` (Gmail's history id); the first look takes the last two days. */
  async changes(rec, cursor) {
    const fresh = async () => {
      const p = await call(rec, 'GET', `${GM}/profile`);
      const j = await call(rec, 'GET', `${GM}/messages`, { query: { q: 'in:inbox newer_than:2d', maxResults: 25 } });
      return { ids: (j.messages || []).map(m => m.id), cursor: { historyId: String(p.historyId || '') } };
    };
    if (!cursor?.historyId) return fresh();
    const ids = new Set();
    let page = null, last = cursor.historyId;
    for (let i = 0; i < 5; i++) {
      let j;
      try { j = await call(rec, 'GET', `${GM}/history`, { query: { startHistoryId: cursor.historyId, historyTypes: 'messageAdded', labelId: 'INBOX', pageToken: page } }); }
      catch (e) { if (e.status === 404) return fresh(); throw e; }   // too old a history id: start again from now
      for (const h of j.history || []) for (const a of h.messagesAdded || []) if ((a.message?.labelIds || ['INBOX']).includes('INBOX')) ids.add(a.message.id);
      last = String(j.historyId || last);
      if (!(page = j.nextPageToken)) break;
    }
    return { ids: [...ids], cursor: { historyId: last } };
  },
};

module.exports = { calendar, mail };
