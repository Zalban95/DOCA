'use strict';

/**
 * Ended teams put away by themselves (asked 2026-10-10, Agents → Teams: "running first, then recent, then finished —
 * archived after N days"): a team that ended (done, failed, stopped) more than `teams.archiveAfterDays` (7) ago goes
 * to the Archive — `teams.archive`, quiet for devices, its missions, document and branches untouched. 0 keeps them.
 * One a person brought back from the Archive (`putAwayBy` without `archivedAt`) is left alone after that, as missions
 * are. Run with the missions' tidy-up (agents/tidy.js, every 30 minutes); one activity line when any went.
 */
const store = require('./store');

function sweep(now = Date.now()) {
  let days = 0;
  try { days = Number(require('../settings-schema').value('teams.archiveAfterDays')) || 0; } catch { /* the default */ }
  if (days <= 0) return [];
  const gone = [];
  for (const r of store.list()) {
    if (r.state === 'running' || !r.endedAt || now - Date.parse(r.endedAt) < days * 864e5) continue;
    const team = store.get(r.id);
    if (!team || team.putAwayBy) continue;   // brought back by a person once: theirs to put away
    try { team.putAwayBy = 'tidy'; store.save(team); require('./index').archive(r.id, true); gone.push(r.id); } catch { /* the next pass */ }
  }
  if (gone.length) try {
    require('../activity').note({ from: 'teams', what: `put away ${gone.length} ended team${gone.length === 1 ? '' : 's'}`,
      why: `ended more than teams.archiveAfterDays (${days} days) ago; in the Archive` });
  } catch { /* a line, never a failure */ }
  return gone;
}

module.exports = { sweep };
