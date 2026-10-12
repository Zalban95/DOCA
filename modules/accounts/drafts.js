'use strict';

/**
 * Mail waiting for its person (the owner, 2026-10-12: "Sending mail is outward: it stays a person's decision — a draft
 * is made; Send is the person's click or an explicit 'send it' in their own turn; never from a mission/automatic turn").
 * The agent's `mail draft|reply` and the mail reader make a draft here; it is sent only by
 *   - the person's Send (`POST /api/accounts/drafts/:id/send`, their own drafts alone), or
 *   - the agent's `mail send` on the person's own turn with `asked: true` (tool-calls.js `byPerson`: a person writing,
 *     not an automatic turn, a mission or a specialist) — mail.js refuses every other turn and leaves the draft.
 * A sent mail cannot be unsent, so its line in the action log (actions.js) says so and offers no Undo.
 *
 *   { id, personId, accountId, to, cc, subject, body, reply?: {id, threadId, subject, from, headers}, by, state: waiting|sent|discarded,
 *     at, sentAt?, why? }
 */
const crypto = require('crypto');
const store = require('../store');

const DOC = 'accounts-drafts';
const KEEP = 1000;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const rows = () => store.readJson(DOC, { drafts: [] }).drafts || [];
const write = list => store.writeJson(DOC, { drafts: list.slice(-KEEP) });
const told = (personId, d, what) => require('../live').changed('everyday', d.id, what, { personId, kind: 'draft' });
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function addrs(v) {
  const out = [].concat(v || []).flatMap(x => String(typeof x === 'string' ? x : x?.address || '').split(/[,;]/)).map(s => s.trim()).filter(Boolean)
    .map(s => require('./mime').address(s).address);
  const badOne = out.find(a => !EMAIL.test(a));
  if (badOne) throw bad(`"${badOne}" is not a mail address.`);
  return out;
}

/** A new draft for this person, on one of their accounts. */
function make(personId, accountId, { to, cc, subject, body, reply = null, why = '' }, by) {
  if (!require('./store').get(personId, accountId)) throw bad('No such account.', 404);
  const d = { id: `drf_${crypto.randomBytes(5).toString('hex')}`, personId, accountId, to: addrs(to || (reply ? [reply.headers?.replyTo || reply.from?.address] : [])),
    cc: addrs(cc), subject: String(subject || (reply ? `Re: ${String(reply.subject || '').replace(/^re:\s*/i, '')}` : '')).slice(0, 300),
    body: String(body || '').slice(0, 50000), reply: reply ? { id: reply.id, threadId: reply.threadId || null, subject: reply.subject || '', from: reply.from || null, headers: reply.headers || {} } : null,
    by: by || { kind: 'agent' }, state: 'waiting', at: new Date().toISOString(), why: String(why || '').slice(0, 300) };
  if (!d.to.length) throw bad('A mail needs someone to go to.');
  write([...rows(), d]);
  told(personId, d, 'new');
  return d;
}

const list = (personId, { state = 'waiting' } = {}) => rows().filter(d => d.personId === personId && (!state || d.state === state)).reverse();
const get = (personId, id) => rows().find(d => d.id === id && d.personId === personId) || null;

/** The person changes what it says before sending. */
function edit(personId, id, f) {
  const d = get(personId, id);
  if (!d || d.state !== 'waiting') throw bad('No such draft waiting.', 404);
  const next = { ...d, ...(f.to !== undefined ? { to: addrs(f.to) } : {}), ...(f.cc !== undefined ? { cc: addrs(f.cc) } : {}),
    ...(typeof f.subject === 'string' ? { subject: f.subject.slice(0, 300) } : {}), ...(typeof f.body === 'string' ? { body: f.body.slice(0, 50000) } : {}) };
  write(rows().map(x => (x.id === id ? next : x)));
  told(personId, next, 'changed');
  return next;
}

function discard(personId, id) {
  const d = get(personId, id);
  if (!d || d.state !== 'waiting') throw bad('No such draft waiting.', 404);
  write(rows().map(x => (x.id === id ? { ...x, state: 'discarded' } : x)));
  told(personId, d, 'discarded');
  return { discarded: id };
}

/** Send it — called only for the person's decision (above). */
async function send(personId, id, by) {
  const d = get(personId, id);
  if (!d || d.state !== 'waiting') throw bad('No such draft waiting.', 404);
  const rec = require('./store').get(personId, d.accountId);
  if (!rec) throw bad('Its account is no longer connected.', 409);
  if (!require('./scopes').can(rec).mailSend) throw bad(`${rec.account || rec.provider} was connected read-only: connect it again with "read and act" to send from it.`, 409);
  const out = await require('./adapter').of(rec).mail.send(rec, { to: d.to, cc: d.cc, subject: d.subject, body: d.body, reply: d.reply });
  write(rows().map(x => (x.id === id ? { ...x, state: 'sent', sentAt: new Date().toISOString() } : x)));
  const a = require('./actions').record(personId, { by, accountId: d.accountId, act: 'mail.send', target: { id: out.id, draft: d.id, to: d.to, subject: d.subject },
    summary: `Sent "${d.subject}" to ${d.to.join(', ')}` });
  require('../activity').note({ from: 'accounts', what: `sent "${d.subject}" from ${rec.account || rec.provider}`, why: by?.kind === 'person' ? 'the person pressed Send' : 'the person said to send it', person: { id: personId } });
  told(personId, d, 'sent');
  return { sent: id, action: a.id };
}

module.exports = { make, list, get, edit, discard, send };
