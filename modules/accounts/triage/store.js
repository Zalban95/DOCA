'use strict';

/**
 * What the mail reading decided, per mail, and the person's own rules for it.
 *
 * Results (store document `accounts-triage`, the last 3000 across everyone):
 *   { personId, accountId, mailId, threadId, from: {name, address}, subject, snippet, date, type, verdict: needs-you|handled|filed,
 *     why, by: rules|reader|person, at, draftId? }
 * Read by the Focused view (GET /api/accounts/mail/triage) and the agent (`mail {action: triage}`); heard on the live
 * feed's topic `everyday` (kind `triage`) by that person's pages alone.
 *
 * Rules (store document `accounts-mail-rules`, per person): { senders: {"anna@x.it" | "@x.it": verdict}, notes } — the
 * senders learned from the person's corrections (`correct()`: moving a mail to another verdict keeps that sender's rule),
 * the notes their own words for the reader ("anything from school needs me").
 */
const store = require('../../store');

const DOC = 'accounts-triage';
const RULES = 'accounts-mail-rules';
const KEEP = 3000;
const VERDICTS = ['needs-you', 'handled', 'filed'];
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const rows = () => store.readJson(DOC, { mails: [] }).mails || [];
const write = list => store.writeJson(DOC, { mails: list.slice(-KEEP) });
const same = (a, b) => a.personId === b.personId && a.accountId === b.accountId && a.mailId === b.mailId;

const has = (personId, accountId, mailId) => rows().some(r => same(r, { personId, accountId, mailId }));

function put(row) {
  const r = { ...row, at: new Date().toISOString() };
  write([...rows().filter(x => !same(x, r)), r]);
  require('../../live').changed('everyday', r.mailId, 'triaged', { personId: r.personId, kind: 'triage', verdict: r.verdict });
  return r;
}

/** This person's, newest mail first. */
function list(personId, { verdict, accountId, limit = 100 } = {}) {
  return rows().filter(r => r.personId === personId && (!verdict || r.verdict === verdict) && (!accountId || r.accountId === accountId))
    .sort((a, b) => String(b.date || b.at).localeCompare(String(a.date || a.at))).slice(0, limit);
}

/** How many of each, for a count on a page. */
function counts(personId) {
  const c = { 'needs-you': 0, handled: 0, filed: 0 };
  for (const r of rows()) if (r.personId === personId && c[r.verdict] !== undefined) c[r.verdict]++;
  return c;
}

const rulesAll = () => store.readJson(RULES, {});
const rules = personId => ({ senders: {}, notes: '', ...(rulesAll()[personId] || {}) });

function setRules(personId, { senders, notes }) {
  const all = rulesAll(), cur = rules(personId);
  const next = { ...cur };
  if (senders && typeof senders === 'object') {
    next.senders = {};
    for (const [k, v] of Object.entries(senders)) {
      const key = String(k).trim().toLowerCase();
      if (!/^(@?[^\s@]+\.[^\s@]+|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(key)) throw bad(`"${k}" is a mail address or @domain.`);
      if (!VERDICTS.includes(v)) throw bad(`A rule is one of ${VERDICTS.join(', ')}.`);
      next.senders[key.startsWith('@') || key.includes('@') ? key : `@${key}`] = v;
    }
  }
  if (typeof notes === 'string') next.notes = notes.slice(0, 2000);
  all[personId] = next;
  store.writeJson(RULES, all);
  return next;
}

/** The person says a mail was misjudged: its row changes, and its sender gets a rule. */
function correct(personId, accountId, mailId, verdict) {
  if (!VERDICTS.includes(verdict)) throw bad(`verdict is one of ${VERDICTS.join(', ')}.`);
  const r = rows().find(x => same(x, { personId, accountId, mailId }));
  if (!r) throw bad('No such mail read.', 404);
  const out = put({ ...r, verdict, why: 'you moved it here', by: 'person' });
  if (r.from?.address) setRules(personId, { senders: { ...rules(personId).senders, [r.from.address]: verdict } });
  return out;
}

module.exports = { has, put, list, counts, rules, setRules, correct, VERDICTS };
