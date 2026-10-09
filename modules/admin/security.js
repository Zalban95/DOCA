'use strict';

/**
 * Hub → Admin, Security: from the audit log (auth/store.js auditFind) — the guarded switches changed lately (which
 * switch, who, when; gate.js records the switch's name, never a value), sign-ins from an address or a device not seen
 * for that person in the 90 days before, and password changes. Who is a name from the accounts; nothing else of a
 * request is read.
 */
const { ago, line, DAY } = require('./words');

const SIGNINS = ['login', 'device sign-in'];
const PASSWORDS = ['password changed', 'password reset'];

async function read(now = Date.now()) {
  const store = require('../auth/store');
  const recent = new Date(now - 14 * DAY).toISOString();
  let changes = [], signins = [];
  try {
    changes = await store.auditFind({ since: recent, actions: PASSWORDS, switched: true, limit: 200 });
    signins = await store.auditFind({ since: new Date(now - 90 * DAY).toISOString(), actions: SIGNINS, limit: 5000 });
  } catch { /* no database: nothing to tell */ }
  const nameOf = id => { const u = id ? store.userById(id) : null; return u ? (u.name || u.email) : 'someone'; };
  const switches = changes.filter(e => e.switch && (!e.status || e.status < 300))
    .slice(0, 6).map(e => ({ what: e.switch, who: nameOf(e.actorId), at: e.at }));
  const passwords = changes.filter(e => PASSWORDS.includes(e.action)).slice(0, 4)
    .map(e => ({ who: nameOf(e.actorId), whose: e.action === 'password reset' ? nameOf(e.subjectId) : null, at: e.at }));
  // New places: a sign-in in the last week whose address (or device) this person had not signed in from before it.
  const week = new Date(now - 7 * DAY).toISOString();
  const older = [...signins].reverse();   // oldest first
  // A person's first sign-in in the window says nothing (it may be their usual place, older than 90 days).
  const seen = new Set(), known = new Set(), fresh = [];
  for (const e of older) {
    const where = e.action === 'login' ? `a:${e.ip || '?'}` : `d:${e.via || '?'}`;
    const k = `${e.actorId}|${where}`;
    if (!seen.has(k) && e.at >= week && known.has(e.actorId)) fresh.push({ who: nameOf(e.actorId), at: e.at, device: e.action !== 'login',
      from: e.action === 'login' ? (e.ip || 'an unknown address') : (require('../api-v1/devices').get(e.via)?.name || 'a device') });
    seen.add(k); known.add(e.actorId);
  }
  return { switches, passwords, fresh: fresh.reverse().slice(0, 5) };
}

function build(x, now = Date.now()) {
  const lines = [];
  for (const [i, s] of (x.switches || []).entries())
    lines.push(line(`switch-${i}`, `Changed: ${s.what}`, `${s.who}, ${ago(s.at, now)}`, 'info', 'chronicle'));
  if (!(x.switches || []).length) lines.push(line('switches', 'Guarded switches', 'none changed in 14 days', 'ok', 'chronicle'));
  for (const [i, f] of (x.fresh || []).entries())
    lines.push(line(`new-${i}`, f.device ? 'Sign-in from a new device' : 'Sign-in from a new address', `${f.who} from ${f.from}, ${ago(f.at, now)}`, 'info', f.device ? 'apikeys' : 'chronicle'));
  if (!(x.fresh || []).length) lines.push(line('new', 'Sign-ins from new places', 'none this week', 'ok', 'chronicle'));
  for (const [i, p] of (x.passwords || []).entries())
    lines.push(line(`password-${i}`, p.whose ? 'Password reset' : 'Password changed', p.whose ? `${p.whose}'s, by ${p.who}, ${ago(p.at, now)}` : `${p.who}, ${ago(p.at, now)}`, 'info', 'settings/users'));
  return { id: 'security', title: 'Security', lines };
}

module.exports = { read, build };
