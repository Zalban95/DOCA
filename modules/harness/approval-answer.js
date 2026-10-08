'use strict';

/**
 * Answering an approval, from anywhere — the panel's card, the popup, a phone
 * or a watch — by one set of rules (docs/design/permissions.md §4):
 *
 *   - who: anyone holding host, or the person whose own turn asked;
 *   - "always" (this kind of call from now on): for a host, the panel's
 *     standing allowlist; for anyone else, their own approve: grant — a person
 *     without host does not set what other people's turns may do. A question
 *     asked because of the person's level is not governed by the allowlist,
 *     so a host's "always" on it is an approve: grant to that person (the
 *     host must be able to give it — live test 2026-10-04);
 *   - "approve all": this request and every other one waiting that the same
 *     person may answer;
 *   - a request that must be asked every time (a protected file, a re-ask
 *     after outside text, a computed command) is only ever allowed once;
 *   - a mission's machine question (mission-asks.js) is answered alone:
 *     "approve all" never sweeps it up.
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
  // A mission's machine question (mission-asks.js) is answered on its own, once: never swept up by "approve all".
  if (decision === 'approve_all' && e.req.machine) throw bad('A machine is asked each time it is used: allow this one once, or deny it.', 400);
  if (decision === 'approve_all') return approveAll({ person, first: id }) > 0;
  if ((decision === 'always' || decision === 'always_tool') && onceOnly(e)) throw bad('This request can only be allowed once.', 400);
  const forOther = e.req.level && e.req.personId && e.req.personId !== person?.id;
  if ((decision === 'always' || decision === 'always_tool') && (!isHost(person) || forOther)) {
    const to = forOther ? e.req.personId : person.id;
    const perms = (decision === 'always' ? e.req.keys : [e.req.tool]).map(k => `approve:${k}`);
    if (forOther) {
      const permits = require('../auth/permits');
      for (const permission of perms) {
        const why = permits.mayGrant({ giver: person, subject: { kind: 'user', id: to }, permission });
        if (why) throw bad(`Not remembered: ${why}. Approve it once instead.`, 403);
      }
    }
    for (const permission of perms)
      require('../auth/grants').create({ subject: { kind: 'user', id: to }, permission,
        by: { kind: 'user', id: person.id, user: person.id }, note: forOther ? `"always", answered by ${person.name || person.email || 'a host'}` : 'their own "always" answer' });
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
    if (e && !e.req.machine && mayAnswer(e, person) && approval.decide(id, 'once')) n++;
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
    // No "Full auto" any more (2.281.0): the approval mode is a safety switch, changed only with the password
    // (auth/guarded.js; CONSTITUTION S14), which a wrist cannot type. Approve all is the quick answer.
  ];
}

module.exports = { answerAs, approveAll, deviceChoices, mayAnswer };
