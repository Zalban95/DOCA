'use strict';

/**
 * What was spent, per person (docs/design/spending.md §2): the usage ledger's rows, each given to the person whose
 * conversation it is (session-access.ownerOf, through the parent chain — a mission's calls are its person's), priced
 * with the owner's list when reading (harness/prices.js). Attribution is read, never stored, so history from before
 * spending existed counts too. Days and months are UTC.
 */
const NOBODY = '';   // calls of no conversation, or of one nobody owns (a one-off ask, a probe, before accounts)

const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

/** The first instant of a month and of the next: [since, until). */
function bounds(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw Object.assign(new Error('month is YYYY-MM.'), { status: 400 });
  const [y, m] = month.split('-').map(Number);
  return { since: new Date(Date.UTC(y, m - 1, 1)).toISOString(), until: new Date(Date.UTC(y, m, 1)).toISOString() };
}

const blank = () => ({ calls: 0, tokens: 0, money: 0, unpriced: 0 });
function add(into, r, cost) {
  into.calls += r.calls;
  into.tokens += r.prompt + r.completion;
  if (cost === null) into.unpriced += r.calls; else into.money += cost;
}

/**
 * One month's spend: per person, each with its days. People are keyed by user id; '' is nobody's.
 * @returns {Promise<{ month, currency, people: Record<string, { calls, tokens, money, unpriced, days: Record<string, object> }> }>}
 */
async function month(m = monthOf()) {
  const { since, until } = bounds(m);
  const rows = await require('../harness/usage').byConversation({ since, until });
  const prices = require('../harness/prices');
  const list = prices.load();
  const access = require('../harness/session-access');
  const owners = new Map();
  const ownerOf = s => {
    if (!s) return NOBODY;
    if (!owners.has(s)) { let o = null; try { o = access.ownerOf(s); } catch { /* a conversation since removed */ } owners.set(s, o || NOBODY); }
    return owners.get(s);
  };
  const people = {};
  for (const r of rows) {
    const who = ownerOf(r.session);
    const p = people[who] || (people[who] = { ...blank(), days: {} });
    const cost = prices.cost(r, list);
    add(p, r, cost);
    add(p.days[r.day] || (p.days[r.day] = blank()), r, cost);
  }
  return { month: m, currency: list.currency, people };
}

/** One person's spend today and this month, for a budget: { today, month, currency }. */
async function of(personId, now = new Date()) {
  const m = await month(monthOf(now));
  const p = m.people[personId] || { ...blank(), days: {} };
  const { days, ...total } = p;
  return { today: days[now.toISOString().slice(0, 10)] || blank(), month: total, currency: m.currency };
}

module.exports = { NOBODY, monthOf, bounds, month, of };
