'use strict';

/**
 * A mission's machine question while it waits (mission-asks.js, `missionAskTimeout: hold`): the mission's row says so
 * — `asking: {id, what, machine, since}`, so the missions bar shows it waiting for its person rather than working — and
 * a small note is kept on disk, because the question itself lives in memory (approval.js) and a restart drops it.
 *
 * After a restart the mission is paused and carried on (agents/carry-on.js, missions.resume); `resumeNote()` is the
 * sentence it then reads: the question was cut off unanswered, and making the same call again asks its person again.
 * Nothing it would have typed is kept — only what the card said (what, on which machine).
 */
const store = require('../store');

const DOC = 'harness/held-asks';
const all = () => store.readJson(DOC, {}) || {};
const write = map => store.writeJson(DOC, map);

/** The row's `asking`, set or cleared, and the screens and devices told (ephemeral: progress, not news). */
function mark(missionId, asking) {
  try {
    const missions = require('../agents/missions');
    const row = missions.patch(missionId, { asking });
    if (row) missions.announce(row, { ephemeral: true });
  } catch { /* a mission's bookkeeping never breaks the mission */ }
}

/** A question is open for this mission. */
function asking(missionId, { id, sessionId, tool, what, machine }) {
  if (!missionId) return;
  const since = new Date().toISOString();
  write({ ...all(), [missionId]: { id, sessionId, tool, what, machine, since } });
  mark(missionId, { id, what, machine, since });
}

/** It was answered, stopped or timed out: nothing waits any more. */
function answered(missionId) {
  if (!missionId) return;
  const map = all();
  if (map[missionId]) { delete map[missionId]; write(map); }
  mark(missionId, null);
}

/**
 * What a mission resumed after a restart reads about the question it was waiting on, or '' — and the note is gone,
 * since it has now been told.
 */
function resumeNote(missionId) {
  const map = all(), q = map[missionId];
  if (!q) return '';
  delete map[missionId]; write(map);
  mark(missionId, null);
  return `\n\nWhen the panel restarted you were waiting for your person to allow you to ${q.what} on ${q.machine}; the `
    + 'question was not answered and went with the restart. If you still need it, make that call again — your person '
    + 'will be asked again, and you wait for their answer.';
}

/** The questions kept on disk now: one per mission waiting on its person. */
const list = () => Object.entries(all()).map(([missionId, q]) => ({ missionId, ...q }));

module.exports = { asking, answered, resumeNote, list };
