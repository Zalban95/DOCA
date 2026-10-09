'use strict';

/**
 * Hub → Admin, Spending today: what the hive spent today (UTC, as Settings → Spending counts it), and each person whose
 * budget for today is set, used against it — the panel draws those with the usage meter's bar and heat. From
 * spending/spent.js and budgets.js, the same reads as Settings → Spending; nothing new is stored.
 */
const { plural, line } = require('./words');

const k = n => { n = Number(n) || 0; return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)); };
const money = (n, cur) => `${(Number(n) || 0).toFixed(2)} ${cur || ''}`.trim();

async function read(at = Date.now()) {
  const now = new Date(at);
  const spent = require('../spending/spent'), budgets = require('../spending/budgets'), d = require('../spending/store').load();
  const m = await spent.month(spent.monthOf(now));
  const day = now.toISOString().slice(0, 10);
  const blank = { calls: 0, tokens: 0, money: 0, unpriced: 0 };
  const total = { ...blank };
  for (const p of Object.values(m.people)) { const t = p.days[day]; if (t) for (const f of Object.keys(blank)) total[f] += t[f]; }
  const monthTotal = Object.values(m.people).reduce((a, p) => ({ tokens: a.tokens + p.tokens, money: a.money + p.money }), { tokens: 0, money: 0 });
  const store = require('../auth/store'), org = store.defaultOrg();
  const people = [];
  for (const u of store.listUsers()) {
    if (u.suspendedAt) continue;
    const person = { id: u.id, role: org ? store.membership(org.id, u.id)?.role : null };
    const b = budgets.effective(person, d);
    if (!b?.tokensPerDay && !b?.moneyPerDay) continue;
    const t = m.people[u.id]?.days[day] || blank;
    people.push({ name: u.name || u.email, tokens: t.tokens, money: t.money,
      tokenLimit: b.tokensPerDay?.limit ?? null, moneyLimit: b.moneyPerDay?.limit ?? null });
  }
  return { currency: m.currency, today: total, month: monthTotal, people };
}

function build(x) {
  const t = x.today || { calls: 0, tokens: 0, money: 0, unpriced: 0 };
  const lines = [line('today', 'Today', `${k(t.tokens)} tokens · ${money(t.money, x.currency)}`, 'ok', 'settings/spending',
    `${plural(t.calls, 'model call')}${t.unpriced ? `, ${t.unpriced} without a price` : ''}`)];
  lines.push(line('month', 'This month', `${k(x.month?.tokens)} tokens · ${money(x.month?.money, x.currency)}`, 'ok', 'settings/spending'));
  for (const [i, p] of (x.people || []).entries()) {
    const tok = p.tokenLimit ? p.tokens / p.tokenLimit : 0, mon = p.moneyLimit ? p.money / p.moneyLimit : 0;
    const byMoney = mon > tok;
    const used = byMoney ? p.money : p.tokens, max = byMoney ? p.moneyLimit : p.tokenLimit;
    const f = used / max;
    lines.push({ ...line(`person-${i}`, p.name, byMoney ? `${money(used, x.currency)} of ${money(max, x.currency)}` : `${k(used)} of ${k(max)} tokens`,
      f >= 1 ? 'err' : f >= 0.8 ? 'ask' : 'ok', 'settings/spending', 'their budget for today'),
    meter: { used, max, unit: byMoney ? 'money' : 'tokens' } });
  }
  if (!(x.people || []).length) lines.push(line('budgets', 'Daily budgets', 'none set', 'info', 'settings/spending'));
  return { id: 'spending', title: 'Spending today', lines };
}

module.exports = { read, build };
