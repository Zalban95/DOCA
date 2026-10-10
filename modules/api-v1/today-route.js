'use strict';

/**
 * GET /api/v1/harness/today — the person's day at a glance, for a watch face and a tile (DocaWear 1.5.2, asked
 * 2026-10-10: "jobs done out of requested", "the teams' percentages"). Read-only, under `harness:chat` like
 * `GET /harness/missions`, and counted from what that route already shows a device — never another person's work:
 *
 * - `jobs`: the specialists' missions and the work chats started since midnight on the person's own clock
 *   (timezones.js; the hub's when none of their screens said), by state. `requested` is all of them, `done` those that
 *   finished with a result — a team's tasks are missions, so they are counted here too. Archived ones count: putting
 *   finished work away does not undo it.
 * - `teams`: every team this person may see that runs now or started or ended today, newest first (at most 8), with
 *   its mechanical progress (tasks done of tasks, every task weighing the same — teams/board.js; no agent writes it).
 *
 * Its own file because router.js is past the size the structure test allows to grow.
 */
const { requireScope } = require('./auth');

const MAX_TEAMS = 8;

/** Midnight today on `tz`'s clock, as the real moment. */
function midnight(now, tz) {
  const zones = require('../timezones');
  const wall = zones.toWall(now, tz);
  return zones.fromWall(new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())), tz);
}

function today(device, { now = new Date() } = {}) {
  const zones = require('../timezones');
  const person = require('../harness/turn/client').deviceOwner(device);
  const tz = zones.of(device.userId) || zones.hostZone();
  const since = midnight(now, tz);
  const from = since.toISOString();
  const hears = id => { try { return require('../harness/session-access').hears(device, id); } catch { return false; } };

  const rows = [];
  try { rows.push(...require('../agents/missions').list({ all: true, limit: 1000 }).filter(m => hears(m.sessionId || m.by || m.id))); } catch { /* no missions yet */ }
  try { const wv = require('../harness/workview'); rows.push(...wv.workChats({ all: true }).map(wv.payloadOf).filter(p => hears(p.missionId))); } catch { /* no work chats */ }
  const mine = rows.filter(r => String(r.startedAt || '') >= from);
  const count = s => mine.filter(r => r.state === s).length;
  const jobs = { requested: mine.length, done: count('done'), running: count('running'), failed: count('failed'),
    stopped: count('cancelled'), paused: count('paused') };

  let teams = [];
  try {
    const t = require('../teams');
    teams = t.visible(person, { all: true })
      .filter(r => r.state === 'running' || String(r.createdAt || '') >= from || String(r.endedAt || '') >= from)
      .slice(0, MAX_TEAMS)
      .map(r => {
        let v = null;
        try { v = t.view(t.get(r.id)); } catch { /* a board that cannot be read: its index row */ }
        const p = (v || r).progress || {};
        return { teamId: r.id, title: (v || r).title || '', state: (v || r).state,
          progress: { done: p.done || 0, total: p.total || 0, percent: p.percent || 0 },
          startedAt: r.createdAt || undefined, endedAt: r.endedAt || undefined, archivedAt: r.archivedAt || undefined };
      });
  } catch { /* teams not available */ }

  return { day: zones.iso(now, tz).slice(0, 10), tz, since: from, jobs, teams };
}

function mount(router) {
  router.get('/harness/today', requireScope('harness:chat'), (req, res) => {
    try { res.json(today(req.device)); }
    catch (e) { res.status(500).json({ error: { code: 'internal', message: e.message } }); }
  });
}

function openapi({ obj, str, int, arr, json, std }) {
  const n = d => int({ description: d });
  return {
    '/harness/today': { get: { tags: ['Harness'], summary: 'This person\'s day at a glance: jobs done of requested, and the teams\' progress', operationId: 'harnessToday', 'x-scope': 'harness:chat',
      description: 'Counted from what GET /harness/missions shows this device, since midnight on the person\'s own clock (the hub\'s when none of their screens said). Mechanical: nothing in it is written by an agent.',
      responses: { 200: json(obj({
        day: str({ description: 'The person\'s date, YYYY-MM-DD.' }), tz: str({ description: 'The IANA zone the day is read on.' }), since: str({ format: 'date-time' }),
        jobs: obj({ requested: n('Missions and work chats started today, archived ones included.'), done: n('Of those, finished with a result.'),
          running: int(), failed: int(), stopped: n('Stopped or dropped by a person.'), paused: int() }),
        teams: arr(obj({ teamId: str(), title: str(), state: str({ enum: ['running', 'done', 'failed', 'stopped'] }),
          progress: obj({ done: int(), total: int(), percent: int() }, { description: 'Tasks done of tasks, every task weighing the same.' }),
          startedAt: str({ format: 'date-time' }), endedAt: str({ format: 'date-time' }), archivedAt: str({ format: 'date-time' }) }),
        { description: 'Running now, or started or ended today; newest first, at most 8.' }) })), ...std(401, 403) } } },
  };
}

module.exports = { mount, openapi, today, midnight };
