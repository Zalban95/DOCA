'use strict';

/**
 * Every change the assistant makes in a person's own calendar or mail, written down with a mechanical way back (the
 * owner, 2026-10-12: "everything that can be reliably mechanical … every calendar/mail change the assistant makes is
 * written to an action log (who, what, before/after) with a mechanical Undo … and 'undo the undo' is possible"). No
 * model is involved: an undo is the opposite call, chosen by the kind of action, and is itself an action — so undoing
 * it is undoing the undo.
 *
 *   { id, personId, at, by: {kind: agent|person|reader, name, sessionId?}, accountId, act, target, before, after,
 *     summary, undoOf?, undoneBy?, undoable }
 *
 * The opposites:  calendar.create ↔ calendar.delete (re-made from what was kept), calendar.change → calendar.change
 * back to the kept fields, mail.archive ↔ mail.unarchive, mail.label ↔ mail.unlabel. A sent mail cannot be unsent,
 * which is why sending is the person's decision (drafts.js) — its line says so.
 * Kept in the store document `accounts-actions` (the last 2000 across everyone); heard on the live feed's topic
 * `everyday` by that person's pages alone.
 */
const crypto = require('crypto');
const store = require('../store');

const DOC = 'accounts-actions';
const KEEP = 2000;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const rows = () => store.readJson(DOC, { actions: [] }).actions || [];
const write = list => store.writeJson(DOC, { actions: list.slice(-KEEP) });

const OPPOSITE = { 'calendar.create': 'calendar.delete', 'calendar.delete': 'calendar.create', 'calendar.change': 'calendar.change',
  'mail.archive': 'mail.unarchive', 'mail.unarchive': 'mail.archive', 'mail.label': 'mail.unlabel', 'mail.unlabel': 'mail.label' };

const told = (personId, a, what) => require('../live').changed('everyday', a.id, what, { personId, kind: 'action', act: a.act });

/** Write one down. */
function record(personId, { by, accountId, act, target, before = null, after = null, summary, undoOf = null }) {
  const a = { id: `act_${crypto.randomBytes(5).toString('hex')}`, personId, at: new Date().toISOString(), by: by || { kind: 'agent' }, accountId, act,
    target: target || null, before, after, summary: String(summary || act).slice(0, 300), undoOf, undoneBy: null, undoable: !!OPPOSITE[act] };
  write([...rows(), a]);
  told(personId, a, 'new');
  return a;
}

/** This person's, newest first; `domain` calendar or mail. */
function list(personId, { domain, limit = 50 } = {}) {
  return rows().filter(a => a.personId === personId && (!domain || a.act.startsWith(`${domain}.`))).reverse().slice(0, limit);
}
const get = (personId, id) => rows().find(a => a.id === id && a.personId === personId) || null;

const snap = e => (e ? { id: e.id, title: e.title, start: e.start, end: e.end, allDay: !!e.allDay, where: e.where || '', note: e.note || '' } : null);

/** The opposite call: what it did, as {act, target, before, after, summary}. */
async function opposite(a, rec, ad) {
  const t = a.target || {};
  switch (a.act) {
    case 'calendar.create': {
      const was = snap(await ad.calendar.event(rec, t.id).catch(() => a.after));
      await ad.calendar.remove(rec, t.id);
      return { act: 'calendar.delete', target: { id: t.id }, before: was, after: null, summary: `Removed "${was?.title || a.after?.title || 'the event'}" again` };
    }
    case 'calendar.delete': {
      const b = a.before || {};
      const made = await ad.calendar.create(rec, { title: b.title, start: b.start, end: b.end, allDay: b.allDay, where: b.where, note: b.note });
      return { act: 'calendar.create', target: { id: made.id }, before: null, after: snap(made), summary: `Put "${b.title}" back` };
    }
    case 'calendar.change': {
      const now = snap(await ad.calendar.event(rec, t.id));
      const b = a.before || {};
      const back = await ad.calendar.update(rec, t.id, { title: b.title, start: b.start, end: b.end, allDay: b.allDay, where: b.where, note: b.note });
      return { act: 'calendar.change', target: { id: t.id }, before: now, after: snap(back), summary: `Put "${b.title}" back as it was` };
    }
    case 'mail.archive': { const r = await ad.mail.unarchive(rec, t.id); return { act: 'mail.unarchive', target: { id: r.id, subject: t.subject }, summary: `Back in the inbox: "${t.subject || 'the mail'}"` }; }
    case 'mail.unarchive': { const r = await ad.mail.archive(rec, t.id); return { act: 'mail.archive', target: { id: r.id, subject: t.subject }, summary: `Archived again: "${t.subject || 'the mail'}"` }; }
    case 'mail.label': await ad.mail.unlabel(rec, t.id, t.label); return { act: 'mail.unlabel', target: { ...t }, summary: `Took the label "${t.label}" off "${t.subject || 'the mail'}"` };
    case 'mail.unlabel': await ad.mail.label(rec, t.id, t.label); return { act: 'mail.label', target: { ...t }, summary: `Put the label "${t.label}" back on "${t.subject || 'the mail'}"` };
    default: throw bad(`"${a.summary}" cannot be undone: ${a.act === 'mail.send' ? 'a sent mail cannot be unsent' : 'there is no opposite for it'}.`, 409);
  }
}

/** Undo one of this person's actions. `by` is who asked: the person's click, or the agent on their behalf. */
async function undo(personId, id, by) {
  const a = get(personId, id);
  if (!a) throw bad('No such action.', 404);
  if (a.undoneBy) throw bad(`Already undone (by ${a.undoneBy}); undo that one to bring it back.`, 409);
  if (!a.undoable) throw bad(`"${a.summary}" cannot be undone: ${a.act === 'mail.send' ? 'a sent mail cannot be unsent' : 'there is no opposite for it'}.`, 409);
  const rec = require('./store').get(personId, a.accountId);
  if (!rec) throw bad('That account is no longer connected: connect it again to undo this.', 409);
  const ad = require('./adapter').of(rec);
  const done = await opposite(a, rec, ad);
  const u = record(personId, { by, accountId: a.accountId, ...done, undoOf: a.id });
  write(rows().map(x => (x.id === a.id ? { ...x, undoneBy: u.id } : x)));
  told(personId, a, 'undone');
  require('../activity').note({ from: 'accounts', what: `undid "${a.summary}"`, why: by?.kind === 'person' ? 'the person pressed Undo' : 'the person asked the agent', person: { id: personId } });
  return { undone: a.id, action: u };
}

module.exports = { record, list, get, undo, snap, OPPOSITE };
