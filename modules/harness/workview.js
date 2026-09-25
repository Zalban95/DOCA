'use strict';

/**
 * Work chats, as a device sees missions.
 *
 * A watch or a phone learns what the harness is doing from `agent.mission`
 * events and `GET /api/v1/harness/missions` — and those carried only the
 * specialists' missions. The work that actually runs is mostly work chats (the
 * orchestrator's subordinates), so a watch showed a picture that was always
 * behind and could not say "the Laya job is running". Found on 2026-09-25.
 *
 * So a work chat is published in the shape a device already draws: `missionId`
 * is the conversation's id, `agentId` is `work`, `label` its title. States map:
 *   running  → running
 *   idle     → done      (its last brief as the result)
 *   failed   → failed    (its last error)
 *   cancelled→ cancelled
 *   paused   → failed    "Stopped by a panel restart" — a turn a restart cut
 *              off, which no longer runs and would otherwise stay "running" on
 *              a watch until the event expired
 * No client update is needed: DocaWear and DocaMobile already render this shape.
 */
const memory = require('./memory');

const RESTARTED = 'Stopped by a panel restart. Open it in the Harness to continue.';

function payloadOf(s) {
  const map = { running: 'running', idle: 'done', failed: 'failed', cancelled: 'cancelled', paused: 'failed' };
  const state = map[s.state] || 'done';
  return {
    missionId: s.id, agentId: 'work', label: s.title || 'Work chat', kind: 'work',
    task: String(s.title || '').slice(0, 200),
    state,
    startedAt: s.createdAt,
    endedAt: state === 'running' ? undefined : s.updatedAt,
    result: state === 'done' && s.brief ? String(s.brief).slice(0, 600) : undefined,
    error: s.state === 'paused' ? RESTARTED : state === 'failed' ? (s.lastError || undefined) : undefined,
    archivedAt: s.archivedAt || undefined,
  };
}

/** The work chats a device should see, resolved through organization (which knows "paused"). */
function workChats({ all = false } = {}) {
  const organization = require('./organization');
  const out = [];
  for (const row of memory.listSessions().sessions) {
    let s;
    try { s = organization.session(row.id); } catch { continue; }
    if (s.kind !== 'work' || (!all && s.archivedAt)) continue;
    out.push(s);
  }
  return out;
}

/** GET /api/v1/harness/missions: specialists' missions and work chats, newest first. */
function forDevices(query = {}) {
  const missions = require('../agents/missions');
  const enabled = require('../agents/registry').enabled();
  const all = query.all === '1';
  const limit = Math.min(50, parseInt(query.limit, 10) || 20);
  const rows = [
    ...(enabled ? missions.list({ state: query.state, all, limit }) : []),
    ...workChats({ all }).map(payloadOf).filter(p => !query.state || p.state === query.state),
  ].sort((a, b) => String(b.endedAt || b.startedAt || '').localeCompare(String(a.endedAt || a.startedAt || '')))
    .slice(0, limit);
  // `enabled` said "specialists are on"; a watch reads false-and-empty as
  // switched off. With work chats listed there is something to show either way.
  return { enabled: enabled || rows.length > 0, missions: rows };
}

/** Tell every device that follows the harness where one work chat stands. */
function announce(sessionId) {
  let s;
  try { s = require('./organization').session(sessionId); } catch { return; }
  if (s.kind !== 'work') return;
  const bus = require('../api-v1/bus');
  const devices = require('../api-v1/devices');
  const { hasScope } = require('../api-v1/scopes');
  bus.publishWhere(devices.list(), d => hasScope(d.scopes, 'harness:chat'), 'agent.mission', payloadOf(s));
}

/**
 * After a restart: every work chat a restart cut off mid-turn is told to the
 * devices as stopped, so none of them keeps showing it as running.
 */
function recover() {
  const cut = workChats().filter(s => s.state === 'paused');
  for (const s of cut) announce(s.id);
  return cut.map(s => s.id);
}

module.exports = { payloadOf, workChats, forDevices, announce, recover, RESTARTED };
