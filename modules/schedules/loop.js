'use strict';

/**
 * A loop in a conversation (asked 2026-10-09: "being able to call loops … in the same chat"): `/loop 10m <prompt>`
 * typed in a chat runs the prompt again and again in THAT conversation, as the person who typed it — their level,
 * their approvals — until it is done. A schedule of kind `loop` (schedules/index.js) bound to the conversation:
 *
 *   when {every: minutes}   every N minutes                 /loop 10m check the build
 *   when {self: true}       again as soon as a run ended    /loop self finish the migration
 *
 * It ends when an answer says so — its last line is DONE ("[loop done]"; every run's message tells the agent) — after
 * `max` runs (20 unless `x5` says otherwise), or when the person stops it (/loop stop, ■ in the chat's bar, Harness →
 * Schedules). Typed by the person, it is their decision and starts on (S1); the agent can only propose a repeating
 * turn with the `schedule` tool, which a person switches on.
 */
const DONE = '[loop done]';
const MAX = 20, MAX_CEILING = 200;
const UNITS = { s: 1 / 60, sec: 1 / 60, m: 1, min: 1, mins: 1, h: 60, hr: 60, hrs: 60, d: 1440 };
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** "10m", "2h", "30" (minutes), "self" → a schedule's `when`; null when the word is not an interval. */
function interval(word) {
  const w = String(word || '').toLowerCase();
  if (['self', 'auto', 'until-done', 'done'].includes(w)) return { self: true };
  const m = /^(\d+(?:\.\d+)?)(s|sec|m|min|mins|h|hr|hrs|d)?$/.exec(w);
  if (!m) return null;
  const minutes = Number(m[1]) * UNITS[m[2] || 'm'];
  if (minutes < 1) throw bad('A loop runs at most once a minute: 1m or more, or "self" to go again as soon as a run ends.');
  return { every: Math.round(minutes) };
}

/** `/loop <interval> [xN] <prompt>` arguments → { when, max, prompt }. */
function parse(args) {
  const text = String(args || '').trim();
  const when = interval(text.split(/\s+/)[0]);
  if (!when) throw bad('Write it as /loop <interval> <what to do>: /loop 10m check the build, or /loop self finish the tests (again as soon as a run ends). /loop stop ends it.');
  let prompt = text.replace(/^\S+\s*/, ''), max = MAX;
  const times = /^x(\d+)(\s+|$)/i.exec(prompt);
  if (times) { max = Math.min(MAX_CEILING, Math.max(1, Number(times[1]))); prompt = prompt.slice(times[0].length); }
  if (!prompt) throw bad('What should each run do? /loop 10m <what to do>.');
  return { when, max, prompt: prompt.slice(0, 4000) };
}

/** What each run sends: the prompt, and how the agent says it is finished. A slash command is sent as it is. */
function message(s) {
  if (s.message.startsWith('/')) return s.message;
  return `${s.message}\n\n[Loop run ${(s.runs || 0)} of at most ${s.max}, in this conversation. When what this loop is for is `
    + `finished, end your answer with the line ${DONE} — the loop then stops. Otherwise say briefly what changed since the last run.]`;
}

/** Whether an answer ends the loop. */
const finished = text => String(text || '').toLowerCase().includes(DONE);

/** After a run: done (by its answer or its count), or when it goes next. */
function after(s, last, now = new Date()) {
  if (finished(last?.text)) return { state: 'done', nextAt: null, ended: 'its answer said it is done' };
  if ((s.runs || 0) >= s.max) return { state: 'done', nextAt: null, ended: `it ran ${s.max} times` };
  if (s.when.self) return { nextAt: new Date(now.getTime() + 2000).toISOString() };
  return {};
}

/** Start one in a conversation, as the person who typed it. */
function start(sessionId, args, person) {
  const { when, max, prompt } = parse(args);
  const s = require('./index').create({ kind: 'loop', message: prompt, max, ...when, sessionId }, { person, madeBy: 'person' });
  return { schedule: s, text: `Loop started in this conversation: ${require('./when').describe(s.when)}, at most ${max} runs — "${prompt.slice(0, 120)}". `
    + `It stops when an answer ends with ${DONE}, after ${max} runs, or with /loop stop.` };
}

/** The loops running in a conversation. */
const forSession = sessionId => require('./index').all().filter(s => s.kind === 'loop' && s.sessionId === sessionId && s.state === 'on');

/** Stop every loop in a conversation. */
function stop(sessionId) {
  const list = forSession(sessionId);
  for (const s of list) require('./index').remove(s.id);
  return list.length ? `Stopped ${list.length === 1 ? 'the loop' : `${list.length} loops`} in this conversation.` : 'No loop runs in this conversation.';
}

module.exports = { DONE, MAX, interval, parse, message, finished, after, start, forSession, stop };
