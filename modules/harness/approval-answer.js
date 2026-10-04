'use strict';

/**
 * Answering an approval, from anywhere — the panel's card, the popup, a phone
 * or a watch — by one set of rules (docs/design/permissions.md §4):
 *
 *   - who: anyone holding host, or the person whose own turn asked;
 *   - "always" (this kind of call from now on): for a host, the panel's
 *     standing allowlist; for anyone else, their own approve: grant — a person
 *     without host does not set what other people's turns may do;
 *   - "approve all": this request and every other one waiting that the same
 *     person may answer;
 *   - a request that must be asked every time (a protected file, a re-ask
 *     after outside text, a computed command) is only ever allowed once.
 */
const approval = require('./approval');

const bad = (m, status) => Object.assign(new Error(m), { status });
const isHost = person => require('../auth/rights').can(person?.role, 'host');
const mayAnswer = (e, person) => isHost(person) || (!!e.req.personId && e.req.personId === person?.id);
const onceOnly = e => !e.req.keys || e.req.forced || e.req.recheck;

/** Answer one request as `person`. @returns {boolean} false when it is no longer waiting */
function answerAs({ id, decision, person }) {
  const e = approval.entry(id);
  if (!e) return false;
  if (!mayAnswer(e, person)) throw bad('This request belongs to someone else\'s turn; it is theirs, or a host\'s, to answer.', 403);
  if (decision === 'approve_all') return approveAll({ person, first: id }) > 0;
  if ((decision === 'always' || decision === 'always_tool') && onceOnly(e)) throw bad('This request can only be allowed once.', 400);
  if ((decision === 'always' || decision === 'always_tool') && !isHost(person)) {
    for (const k of decision === 'always' ? e.req.keys : [e.req.tool])
      require('../auth/grants').create({ subject: { kind: 'user', id: person.id }, permission: `approve:${k}`,
        by: { kind: 'user', id: person.id, user: person.id }, note: 'their own "always" answer' });
    return approval.decide(id, 'once');
  }
  return approval.decide(id, decision);
}

/** Approve, once, every waiting request this person may answer. @returns {number} how many */
function approveAll({ person, first = null }) {
  let n = 0;
  const ids = approval.pending().map(p => p.id);
  for (const id of first ? [first, ...ids.filter(x => x !== first)] : ids) {
    const e = approval.entry(id);
    if (e && mayAnswer(e, person) && approval.decide(id, 'once')) n++;
  }
  return n;
}

/** The choices a device is offered for a request, by what its owner may decide. */
function deviceChoices(req, person) {
  const host = isHost(person);
  return [
    { id: 'approve', label: 'Approve' },
    ...(!onceOnly({ req }) ? [{ id: 'always', label: `Always ${req.keys?.length === 1 ? req.keys[0].split(':').pop() : req.tool}` }] : []),
    ...(approval.pending().length > 1 ? [{ id: 'approve_all', label: 'Approve all' }] : []),
    { id: 'deny', label: 'Deny' },
    ...(host ? [{ id: 'full_auto', label: 'Full auto' }] : []),
  ];
}

module.exports = { answerAs, approveAll, deviceChoices, mayAnswer };
