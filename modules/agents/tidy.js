'use strict';

/**
 * Finished missions put away by themselves (the owner, 2026-10-08, looking at eight "Tester done" rows from earlier
 * test rounds: "the done ones not relevant can be archived automatically").
 *
 * A finished mission (done, failed, cancelled) goes to the Archive — `missions.archive`, which announces quietly, so a
 * device takes the row off and nobody is notified — when it is no longer relevant:
 *
 *   - its person opened it (`seenAt`, harness/seen.js) more than `missions.archiveSeenAfterMin` ago (30), or
 *   - it finished more than `missions.archiveAfterHours` ago (24), seen or not.
 *
 * 0 turns either rule off. Never put away: one whose leader has not had its result yet (the Orchestrator or the work
 * chat that sent it reads it in its readings — `announcedToAgentAt` — and archiving would hide it from notices() for
 * good), one with something open for a person (a machine question, a tool call waiting for an answer, a plan to
 * approve, a settings or install proposal), and one a person kept (📌, `pinned`). Archived is not deleted: the row and
 * its log stay, and the Archive brings it back — one brought back is left alone after that.
 *
 * A sweep every 30 minutes (the computers' tidy-up's rhythm), started in boot.afterListen, writes one activity line
 * when it put anything away. "Put away finished" in the missions bar does the same at once for what its person may
 * open, whatever the age — still keeping what is kept above.
 *
 *   GET  /api/harness/missions/tidy        { putAway, settings } — how many were put away in the last day, for the bar
 *   POST /api/harness/missions/tidy        put away the person's finished missions now
 *   POST /api/harness/missions/:id/pin     { on } — keep one out of the tidy-up
 */
const SWEEP_MS = 30 * 60 * 1000;
const FINISHED = ['done', 'failed', 'cancelled'];
const DAY_MS = 24 * 3600000;

const setting = key => require('../settings-schema').value(`missions.${key}`);
const missions = () => require('./missions');
const safe = fn => { try { return fn(); } catch { return null; } };

/** Its leader is still there to read it: a conversation not archived, and a work chat whose job is not over. */
function leaderWaits(m) {
  const org = require('../harness/organization');
  const lead = safe(() => org.session(m.by || require('../harness/memory').mainSession().id));
  if (!lead || lead.archivedAt) return false;
  const job = lead.job;
  if (lead.kind === 'work' && job && (org.FINAL.includes(job.state) || ['stopped', 'dropped'].includes(job.state))) return false;
  return true;
}

/** Why this mission stays, or null. */
function keptBecause(m) {
  if (m.pinned) return 'kept by a person';
  if (m.putAwayBy && !m.archivedAt) return 'brought back from the Archive';   // a person wanted it: the tidy-up leaves it
  if (m.asking) return 'waits for its person on a machine question';
  if (!m.announcedToAgentAt && leaderWaits(m)) return 'its leader has not read its result yet';
  const sid = m.sessionId;
  if (sid) {
    if ((safe(() => require('../harness/approval').pending()) || []).some(a => a.sessionId === sid)) return 'a question waits for an answer';
    if (safe(() => require('../harness/memory').getSession(sid))?.plan?.state === 'proposed') return 'a plan waits for approval';
    const proposed = [...(safe(() => require('../harness/settings').list().pending) || []), ...(safe(() => require('../harness/installs').list().pending) || [])];
    if (proposed.some(p => p.sessionId === sid)) return 'a proposal waits for a decision';
  }
  return null;
}

/** Why this finished mission is due to be put away now, or null. */
function dueBecause(m, now = Date.now()) {
  if (!FINISHED.includes(m.state) || m.archivedAt) return null;
  const seenMin = Number(setting('archiveSeenAfterMin')) || 0, afterH = Number(setting('archiveAfterHours')) || 0;
  if (seenMin > 0 && m.seenAt && now - Date.parse(m.seenAt) > seenMin * 60000) return `seen more than ${seenMin} min ago`;
  if (afterH > 0 && m.endedAt && now - Date.parse(m.endedAt) > afterH * 3600000) return `finished more than ${afterH} h ago`;
  return null;
}

function putAway(m, by) {
  missions().patch(m.id, { putAwayBy: by });
  missions().archive(m.id);   // quiet: devices drop the row, nobody is notified
}

/** The hub's own pass: every finished mission that is due and not kept. One activity line when any went. */
function sweep(now = Date.now()) {
  const gone = [];
  for (const m of missions().list({ limit: 1000 })) {
    if (!dueBecause(m, now) || keptBecause(m)) continue;
    try { putAway(m, 'tidy'); gone.push(m.id); } catch { /* one that cannot be put away is left for the next pass */ }
  }
  if (gone.length) require('../activity').note({ from: 'missions', what: `put away ${gone.length} finished mission${gone.length === 1 ? '' : 's'}`,
    why: `seen more than missions.archiveSeenAfterMin (${setting('archiveSeenAfterMin')} min) ago, or finished more than missions.archiveAfterHours (${setting('archiveAfterHours')} h) ago; in the Archive` });
  return gone;
}

/** A person's "Put away finished": what they may open, finished and not kept, whatever its age. */
function now(person) {
  const access = require('../harness/session-access');
  const gone = [], kept = [];
  for (const m of missions().list({ limit: 1000 })) {
    if (!FINISHED.includes(m.state) || (person?.id && !access.mayUse(person, m.sessionId || m.by))) continue;
    const why = keptBecause(m);
    if (why) { kept.push({ id: m.id, label: m.label, why }); continue; }
    try { putAway(m, 'person'); gone.push(m.id); } catch { /* left as it was */ }
  }
  return { putAway: gone, kept };
}

/** 📌: keep one out of the tidy-up, or let it go again. */
function pin(id, on, person) {
  const m = missions().get(id);
  if (!m || (person?.id && !require('../harness/session-access').mayUse(person, m.sessionId || m.by)))
    throw Object.assign(new Error(`No mission called "${id}".`), { status: 404 });
  const row = missions().patch(id, { pinned: on ? new Date().toISOString() : null });
  missions().announce(row, { quiet: true });
  return row;
}

/** How many of this person's missions were put away in the last day — the bar's quiet "N put away". */
function recent(person, at = Date.now()) {
  const access = require('../harness/session-access');
  return missions().list({ all: true, limit: 1000 }).filter(m => m.archivedAt && m.putAwayBy && at - Date.parse(m.archivedAt) < DAY_MS
    && (!person?.id || access.mayUse(person, m.sessionId || m.by))).length;
}

let _sweeper = null;
function start() {
  if (_sweeper) return;
  _sweeper = setInterval(() => { try { sweep(); } catch { /* the next pass tries again */ } }, SWEEP_MS);
  _sweeper.unref?.();
}

function mount(app) {
  const who = req => require('../harness/turn/client').dashboardClient(req).user;
  const h = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/harness/missions/tidy', h(req => ({ putAway: recent(who(req)),
    settings: { archiveSeenAfterMin: setting('archiveSeenAfterMin'), archiveAfterHours: setting('archiveAfterHours') } })));
  app.post('/api/harness/missions/tidy', h(req => now(who(req))));
  app.post('/api/harness/missions/:id/pin', h(req => ({ ok: true, mission: pin(req.params.id, req.body?.on !== false, who(req)) })));
}

module.exports = { sweep, now, pin, recent, keptBecause, dueBecause, start, mount, SWEEP_MS };
