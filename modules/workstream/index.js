'use strict';

/**
 * The Workstream (TODO H10.9; asked 2026-10-06): a page that shows the agents' work as it happens, organically — not
 * what an agent chooses to report. Two streams, both on the live feed (topic `workstream`), and only to the pages that
 * hold the Workstream open (a host's: it is the machine's files and every conversation's thinking):
 *   file       a file changed in a folder the agents work in, with what changed (sentinel.js, diff.js)
 *   activity   each conversation's thinking and answer as they stream (gathered every 300 ms), the commands it runs and
 *              the first line of what came back — from agent.events, so every turn on every device is in it; and the
 *              machines' changes (machines/busy.js: busy, idle, a process started outside DOCA's tools)
 * Mechanical, all of it (the owner's rule, 2026-10-08): events and OS readings in fixed words — no model is asked, and
 * no agent tool posts here.
 * The sentinel runs only while a page holds the Workstream; the last page to let go stops it. A short backlog of both
 * is kept in memory so a page that opens mid-work starts with what just happened.
 */
const path = require('path');
const live = require('../live');
const sentinel = require('./sentinel');

const BACKLOG = () => require('../log-keep').limit('logs.workstreamLines');   // activity lines kept (Settings → System → Logs)
const FLUSH_MS = 300;
const _holders = new Set();    // live-stream screens holding the Workstream open
const _activity = [];          // the last activity lines
const _files = [];             // the last file changes (without their hunks after the newest few)
const _buf = new Map();        // `${sessionId}\t${kind}` → { text, timer }
let _listening = false;

const title = id => { try { return require('../harness/memory').getSession(id)?.title || id; } catch { return id; } };
const keep = (list, row, n = BACKLOG()) => { list.push(row); if (list.length > n) list.splice(0, list.length - n); };

function say(sessionId, kind, text, extra = {}) {
  const row = { at: Date.now(), sessionId, who: title(sessionId), kind, text: String(text).slice(0, 4000), ...extra };
  keep(_activity, row);
  if (_holders.size) live.changed('workstream', sessionId, 'activity', row);
}

/**
 * A machine's line (machines/busy.js): busy, idle again, a process started outside DOCA's tools — readings put in fixed
 * words there, never a model's or an agent's. Its `who` is the machine; it belongs to no conversation.
 */
function machine(name, text, extra = {}) {
  const row = { at: Date.now(), sessionId: null, who: String(name || 'a machine'), kind: 'machine', text: String(text).slice(0, 400), ...extra };
  keep(_activity, row);
  if (_holders.size) live.changed('workstream', null, 'activity', row);
}

/** Thinking and text arrive a token at a time: gathered per conversation and said every FLUSH_MS. */
function gather(sessionId, kind, delta) {
  const key = `${sessionId}\t${kind}`;
  const b = _buf.get(key) || { text: '', timer: null };
  b.text += delta;
  if (!b.timer) b.timer = setTimeout(() => { _buf.delete(key); if (b.text.trim()) say(sessionId, kind, b.text); }, FLUSH_MS);
  _buf.set(key, b);
}

/** One line for a tool call: a shell command as typed, a file by its path, anything else by its name and arguments' names. */
function command(name, args = {}) {
  if (/(^|__)shell(_job)?$/.test(name) && args.command) return `$ ${String(args.command).slice(0, 600)}`;
  if (args.path) return `${name} ${args.path}`;
  if (args.url) return `${name} ${args.url}`;
  const keys = Object.keys(args || {}).filter(k => !/pass|token|secret|key|content|body/i.test(k));
  return `${name}(${keys.join(', ')})`;
}

function onEvent(evt) {
  if (!evt?.sessionId) return;
  if (evt.type === 'thinking' && evt.text) return gather(evt.sessionId, 'thinking', evt.text);
  if (evt.type === 'text' && evt.text) return gather(evt.sessionId, 'text', evt.text);
  if (evt.type === 'tool_call') {
    let args = evt.args;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    if ((evt.name === 'write_file' || /__(files?_)?write/.test(evt.name || '')) && args?.path) sentinel.include(path.dirname(String(args.path)));
    // Experiment riskTiers: the call's tier and its way back, so what can be undone is seen as the work happens.
    const risk = evt.risk ? { tier: evt.risk.tier, way: evt.risk.way || null, why: evt.risk.why || null } : {};
    return say(evt.sessionId, 'command', command(evt.name || 'tool', args || {}), { tool: evt.name || null, ...risk });
  }
  if (evt.type === 'tool_result') {
    const first = String(evt.result ?? '').split('\n').find(l => l.trim()) || '(no output)';
    return say(evt.sessionId, 'result', first.slice(0, 200), { tool: evt.name || null, failed: /^Error|^✗|refused|exit [1-9]/i.test(first) });
  }
}

function fileChanged(change) {
  const row = { at: Date.now(), ...change };
  keep(_files, row, 60);
  for (const old of _files.slice(0, -8)) delete old.hunks;   // the backlog keeps what changed, not every line of it
  live.changed('workstream', null, 'file', row);
}

/** A page holds the Workstream open (or lets go). The sentinel runs while anyone holds it. */
function hold(screen, on = true) {
  if (on) _holders.add(screen); else _holders.delete(screen);
  if (_holders.size) sentinel.start(fileChanged); else sentinel.stop();
  if (_holders.size) require('../machines/busy').want();   // the machines are looked at while it is shown (busy.js)
  return { holding: _holders.has(screen), sentinel: sentinel.status() };
}

function start() {
  if (_listening) return;
  _listening = true;
  require('../harness/agent').events.on('event', e => { try { onEvent(e); } catch { /* the work never waits on its watchers */ } });
  live.feed.on('screen-closed', screen => { if (_holders.has(screen)) hold(screen, false); });
}

const holds = screen => _holders.has(screen);
const holding = () => _holders.size > 0;
const snapshot = () => ({ sentinel: sentinel.status(), files: _files.slice(-40), activity: _activity.slice(-150) });

/** How much the activity holds now (log-keep.js usage). */
const size = () => ({ lines: _activity.length, bytes: Buffer.byteLength(JSON.stringify(_activity)) });

module.exports = { start, hold, holds, holding, machine, snapshot, onEvent, command, fileChanged, size };
