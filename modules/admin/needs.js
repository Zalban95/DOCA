'use strict';

/**
 * Hub → Admin, Needs you: what waits for an admin, as counts with where each is answered. Devices waiting for
 * approval (devices-approval/), the agent's proposals (harness/settings.js, installs.js), tool calls waiting for an
 * answer and missions' held questions (approval.js, mission-asks-held.js), failed or paused missions, failed or stopped
 * teams, stopped work chats, sign-ins locked out or failing (auth/routes.js, the audit log), the licence's grace ending
 * (license/), and devices that belong to nobody. Never what a question says — only that it waits.
 */
const { ago, span, plural, line, DAY } = require('./words');

async function read(now = Date.now()) {
  const devices = require('../api-v1/devices');
  const all = devices.list().filter(d => !d.revokedAt);
  const pending = all.filter(d => devices.isPending(d));
  const missions = require('../agents/missions').list({ limit: 500 });
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  let teams = [];
  try { teams = require('../teams/store').list().filter(t => ['failed', 'stopped'].includes(t.state) && String(t.endedAt || '') >= weekAgo); } catch { /* none */ }
  let stopped = 0;
  try { stopped = require('../harness/stopped-work').stopped().length; } catch { /* none */ }
  const authStore = require('../auth/store');
  const users = authStore.listUsers();
  const byEmail = new Map(users.map(u => [String(u.email || '').toLowerCase(), u]));
  const locked = { accounts: [], addresses: 0 };
  for (const [k, f] of require('../auth/routes')._failures) {
    if (!(f.until > now)) continue;
    if (k.startsWith('e:')) { const u = byEmail.get(k.slice(2)); locked.accounts.push(u ? (u.name || u.email) : 'an unknown address'); } else if (k.startsWith('a:')) locked.addresses++;
  }
  let failedSignIns = [];
  try { failedSignIns = await authStore.auditFind({ since: new Date(now - DAY).toISOString(), actions: ['login failed'], limit: 1000 }); } catch { /* the database is not there */ }
  const known = failedSignIns.filter(e => byEmail.has(String(e.detail || '').toLowerCase()));
  const s = require('../license').status();
  return {
    devicesPending: { n: pending.length, oldest: pending.map(d => d.approval?.askedAt).filter(Boolean).sort()[0] || null },
    unowned: all.filter(d => !d.userId).length,
    settingsProposals: require('../harness/settings').list().pending.filter(p => !p.screen).length,
    installProposals: require('../harness/installs').list().pending.length,
    approvals: require('../harness/approval').pending().length,
    heldAsks: require('../harness/mission-asks-held').list().length,
    missionsFailed: missions.filter(m => m.state === 'failed' && !m.seenAt).length,
    missionsPaused: missions.filter(m => m.state === 'paused').length,
    teams: { failed: teams.filter(t => t.state === 'failed').length, stopped: teams.filter(t => t.state === 'stopped').length },
    stoppedWork: stopped,
    locked,
    failedSignIns: { n: failedSignIns.length, accounts: new Set(known.map(e => String(e.detail).toLowerCase())).size },
    grace: { source: s.source, until: s.grace?.active ? s.grace.until : null, lapsesAt: s.lapsesAt, graceDays: s.graceDays, readOnly: !!s.readOnly },
  };
}

function build(x, now = Date.now()) {
  const lines = [];
  const add = (cond, ...a) => { if (cond) lines.push(line(...a)); };
  const dp = x.devicesPending || { n: 0 };
  add(dp.n, 'devices-pending', 'Devices waiting for approval', plural(dp.n, 'device'), 'ask', 'apikeys', dp.oldest ? `the oldest asked ${ago(dp.oldest, now)}` : null);
  const props = (x.settingsProposals || 0) + (x.installProposals || 0);
  add(props, 'proposals', 'Proposals from the agent', plural(props, 'proposal'), 'ask', 'harness',
    [x.settingsProposals ? plural(x.settingsProposals, 'setting') : '', x.installProposals ? plural(x.installProposals, 'install') : ''].filter(Boolean).join(', '));
  add(x.approvals, 'approvals', 'Tool calls waiting for an answer', plural(x.approvals, 'question'), 'ask', 'settings/harness',
    x.heldAsks ? `${plural(x.heldAsks, 'mission')} held on a machine question` : null);
  add(!x.approvals && x.heldAsks, 'held', 'Missions held on a question', plural(x.heldAsks, 'mission'), 'ask', 'harness');
  add(x.missionsFailed, 'missions-failed', 'Missions that failed', plural(x.missionsFailed, 'mission'), 'err', 'harness', 'not opened yet');
  add(x.missionsPaused, 'missions-paused', 'Missions paused by a restart', plural(x.missionsPaused, 'mission'), 'ask', 'harness', 'carry on or drop');
  const t = x.teams || {};
  add(t.failed || t.stopped, 'teams', 'Teams that ended early', plural((t.failed || 0) + (t.stopped || 0), 'team'), t.failed ? 'err' : 'ask', 'harness',
    [t.failed ? `${t.failed} failed` : '', t.stopped ? `${t.stopped} stopped` : ''].filter(Boolean).join(', ') + ' this week');
  add(x.stoppedWork, 'stopped-work', 'Stopped work chats', plural(x.stoppedWork, 'work chat'), 'ask', 'harness', 'restart or drop');
  const l = x.locked || { accounts: [], addresses: 0 };
  add(l.accounts.length || l.addresses, 'locked', 'Sign-ins locked out', plural(l.accounts.length + l.addresses, 'lock'), 'err', 'chronicle',
    [l.accounts.length ? `accounts: ${[...new Set(l.accounts)].slice(0, 3).join(', ')}` : '', l.addresses ? plural(l.addresses, 'address', 'addresses') : ''].filter(Boolean).join(' · '));
  const f = x.failedSignIns || { n: 0 };
  add(f.n >= 5, 'failed-signins', 'Failed sign-ins today', plural(f.n, 'try', 'tries'), f.n >= 20 ? 'err' : 'ask', 'settings/users',
    f.accounts ? `on ${plural(f.accounts, 'account')} that exist` : 'none on an account that exists');
  const g = x.grace || {};
  if (g.readOnly) lines.push(line('grace', 'Licensed features', 'read-only', 'err', 'settings/system'));
  else if (g.until && Date.parse(g.until) - now < 14 * DAY) lines.push(line('grace', 'Licence grace ends', `in ${span(Date.parse(g.until) - now)}`, 'ask', 'settings/system', 'add a licence before then'));
  else if (g.lapsesAt) {
    const end = Date.parse(g.lapsesAt) + (g.graceDays || 0) * DAY;
    if (end - now < 14 * DAY) lines.push(line('grace', 'Licence lapsed', end > now ? `read-only in ${span(end - now)}` : 'read-only now', 'err', 'settings/system', 'renew it'));
  }
  add(x.unowned, 'unowned', 'Devices that belong to nobody', plural(x.unowned, 'device'), 'ask', 'apikeys', 'give each to a person in the Devices list');
  return { id: 'needs', title: 'Needs you', lines };
}

module.exports = { read, build };
