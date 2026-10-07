'use strict';

/**
 * A skill read is a skill followed (TODO B7c (2): on the routing set DeepSeek read `android-app` and then improvised
 * Gradle and adb anyway). When this turn has read a skill (`skill` read — its text is in the turn's own tool rows),
 * its numbered steps come back in every step's readings as a short checklist, with what to do when departing from
 * one: say which step and why. Nothing is stored and nothing is re-read: the steps are taken from the text the turn
 * already holds, so a skill read in an earlier turn is not pressed on a new request.
 */
const MAX_STEPS = 12;

/** The numbered steps of a skill's body: their bold titles, else their first sentence. */
function stepsOf(body) {
  const out = [];
  for (const line of String(body || '').split('\n')) {
    const m = /^\s{0,2}(\d+)\.\s+(.*)$/.exec(line);
    if (!m) continue;
    const bold = /^\*\*(.+?)\*\*/.exec(m[2]);
    const title = (bold ? bold[1] : m[2].split(/(?<=[.:])\s/)[0]).replace(/[`*]/g, '').replace(/[.:]$/, '').trim();
    if (title) out.push(title.slice(0, 80));
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

/** "# Following …" for each skill this turn read that has steps; '' when none. `rows`: the turn's transcript rows. */
function block(rows = []) {
  const seen = new Map();
  for (const r of rows) {
    if (r.role !== 'tool' || r.name !== 'skill') continue;
    const m = /^# ([\w.-]+)\n([\s\S]*)$/.exec(String(r.content || ''));
    if (m && !seen.has(m[1])) seen.set(m[1], stepsOf(m[2]));
  }
  const out = [];
  for (const [name, steps] of seen) {
    if (!steps.length) continue;
    out.push(`# Following the skill ${name}: ${steps.map((s, i) => `${i + 1}. ${s}`).join(' · ')}`,
      'Work through these with the tools and commands the skill names. Where you do one another way, or skip it, say which step and why in your answer.');
  }
  return out.join('\n');
}

module.exports = { block, stepsOf };
