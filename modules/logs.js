'use strict';

/**
 * Where the Logs tab gets its lines.
 *
 * One source per harness, because "show me the log" means whatever is answering
 * you, not the container that happens to be running. The three kinds are not
 * equally served and pretending otherwise is how a selector ends up offering a
 * stream that stays empty forever:
 *
 *   builtin  The DOCA harness. No process and no file to tail — but every turn
 *            already emits structured events (`agent.events`), so this source
 *            is a subscriber rather than a reader, and its lines carry a level
 *            that was decided by the thing that knew what it was saying.
 *   stack    `docker compose logs --follow`, which is all `/api/logs` used to be.
 *   cli      Nothing, today. A terminal harness is launched by the *browser*
 *            typing into a PTY (`public/js/harness.js` → `modules/terminal.js`):
 *            this process never sees lines, only bytes belonging to one tab,
 *            and they end when that tab closes. Offering it as a source would
 *            mean DOCA owning the launch. It is listed as unavailable, with
 *            that reason, so the answer is on screen instead of in this file.
 *
 * A line is an object — `{ ts, source, label, level, text }` — not a string.
 * The old shape was a bare string and the browser scanned the whole of it for
 * the word "error" to pick a colour, which cannot survive a source tag: one
 * harness named "error-handler" would paint every line it ever wrote red. The
 * level is decided here now, and the tag is never part of what gets scanned.
 */
const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

const agent   = require('./harness/agent');
const catalog = require('./harness/catalog');
const { COMPOSE_DIR } = require('./paths');
const { sseHeaders }  = require('./utils');

/** Longest a single line may be. A tool result can be a whole directory. */
const MAX_TEXT = 400;

/** Lines kept from before anyone opened the tab. */
const RING = 500;

/* ── Line shape ───────────────────────────────────────── */

function line(src, level, text) {
  return {
    ts: new Date().toISOString(),
    source: src.id,
    label: src.label,
    level,
    text: String(text == null ? '' : text).replace(/\s+$/, ''),
  };
}

/**
 * The level of a line nobody labelled.
 *
 * Only for text sources — docker, mostly — where the words are all there is.
 * It is applied to the text alone and never to the source tag, which is the
 * whole reason it lives on this side now.
 */
const ERROR_RE = /\[stderr\]|\b(error|err|fatal|panic|exception|traceback|failed)\b/i;
const WARN_RE  = /\b(warn|warning|deprecated)\b/i;

function levelOf(text) {
  if (ERROR_RE.test(text)) return 'error';
  if (WARN_RE.test(text))  return 'warn';
  return 'info';
}

function clip(s, max = MAX_TEXT) {
  const one = String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ⏎ ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/* ── Source: the built-in harness ─────────────────────── */

const SELF = { id: catalog.BUILTIN_ID, label: 'DOCA Harness' };

/**
 * One harness event as one line, or null for the ones that are not log
 * material.
 *
 * `text` is dropped on purpose: those are streaming deltas, and a log with one
 * line per token is the conversation retyped badly. Read the conversation in
 * the chat; read here what the conversation *did*.
 *
 * Tool arguments are reduced to their parameter names. `/api/logs` has no auth
 * in front of it — only `/api/v1` does — so anything this function puts in a
 * line is readable by any peer on the tailnet, and an argument is exactly where
 * a key or a password would be sitting. The names answer "which tool, called
 * how", which is what a log is for; the values are in the transcript, behind
 * the panel.
 */
function fromHarness(evt) {
  switch (evt && evt.type) {
    case 'session':
      return line(SELF, 'info', `session ${evt.sessionId}`);

    case 'tools':
      return evt.count === evt.was ? null
        : line(SELF, 'info', `tools: ${evt.count} available (was ${evt.was}) at step ${evt.step}`);

    case 'usage': {
      const ctx = evt.contextWindow
        ? `, context ${evt.contextTokens}/${evt.contextWindow} (${evt.contextPercent}%)`
        : `, context ${evt.contextTokens}`;
      return line(SELF, 'info',
        `step ${evt.step}: ${evt.totalTokens} tokens `
        + `(${evt.promptTokens} in, ${evt.completionTokens} out, ${evt.source})${ctx}`);
    }

    case 'warning':
      return line(SELF, 'warn', evt.text || `${evt.kind} warning`);

    case 'tool_call':
      return line(SELF, 'info', `step ${evt.step} → ${evt.name}(${argNames(evt.args)})`);

    case 'tool_result':
      return line(SELF, isFailure(evt.result) ? 'error' : 'info',
        `step ${evt.step} ← ${evt.name}: ${clip(evt.result)}`);

    case 'proposal':
      return line(SELF, 'info',
        `proposal ${evt.proposal?.id || '?'}: ${evt.proposal?.key || '(unnamed)'} — waiting for the user`);

    case 'compacted':
      return line(SELF, 'warn',
        `compacted at step ${evt.at} — ${evt.contextTokens} of ${evt.contextWindow} tokens`);

    default:
      return null;
  }
}

function argNames(args) {
  if (!args || typeof args !== 'object') return '';
  return Object.keys(args).join(', ');
}

/** What `tools.call()` returns when a tool failed, and what `mcp` returns. */
function isFailure(result) {
  return /^\s*(error|✗|failed)\b/i.test(String(result || ''));
}

/**
 * The ring, filled from require time.
 *
 * Subscribed here rather than when somebody opens the tab, because the harness
 * works whether or not anyone is watching and a log you can only see if you
 * were already looking is not much of a log. This starts no process and writes
 * no file — it is one in-process listener and a bounded array — which is why it
 * does not belong behind the listen path the way MCP autostart does.
 */
const ring = [];

function remember(l) {
  ring.push(l);
  if (ring.length > RING) ring.shift();
}

agent.events.on('event', evt => {
  try { const l = fromHarness(evt); if (l) remember(l); } catch { /* never break a turn */ }
});

function openBuiltin(src, tail, onLine) {
  for (const l of ring.slice(-tail)) onLine(l);
  onLine(line(src, 'info', ring.length
    ? '— live —'
    : 'Listening. The DOCA harness writes here as it works; nothing has happened yet this boot.'));

  const handler = evt => { try { const l = fromHarness(evt); if (l) onLine(l); } catch {} };
  agent.events.on('event', handler);
  return () => agent.events.off('event', handler);
}

/* ── Source: a Compose stack ──────────────────────────── */

function composeFile() {
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    try { if (fs.existsSync(path.join(COMPOSE_DIR, name))) return name; } catch { /* unreadable */ }
  }
  return null;
}

function openStack(src, tail, onLine) {
  const child = spawn('docker', ['compose', 'logs', '--follow', '--tail', String(tail)], { cwd: COMPOSE_DIR });
  const feed = (chunk, forced) => String(chunk).split('\n').forEach(t => {
    if (t.trim()) onLine(line(src, forced || levelOf(t), t));
  });

  child.stdout.on('data', c => feed(c));
  child.stderr.on('data', c => feed(c, 'error'));
  child.on('error', err => onLine(line(src, 'error',
    `${err.message}. Docker is optional — the stack log is empty without it.`)));

  return () => { try { child.kill(); } catch {} };
}

/* ── The registry ─────────────────────────────────────── */

const CLI_REASON =
  'A terminal harness is launched from the browser into a PTY, so the panel never sees its output — '
  + 'watch it in the Harness tab instead.';

/**
 * Every harness, and whether it can actually be followed.
 *
 * Unavailable sources are returned rather than hidden: "why is claude not in
 * the list" is a worse question than a greyed-out row that says why.
 */
function sources() {
  const selected = catalog.defaultId();
  const file = composeFile();
  return catalog.all().map(h => {
    const row = { id: h.id, label: h.label, kind: h.kind, selected: h.id === selected, available: false, reason: null };
    if (h.kind === 'builtin') { row.available = true; return row; }
    if (h.kind === 'stack') {
      row.available = !!file;
      row.reason = file ? null : `No compose file in ${COMPOSE_DIR} — nothing to follow.`;
      return row;
    }
    row.reason = CLI_REASON;
    return row;
  });
}

/** Resolve what the client asked for. `auto` is whichever harness is selected. */
function resolve(spec) {
  const all = sources();
  const wanted = String(spec || 'auto').split(',').map(s => s.trim()).filter(Boolean);
  if (!wanted.length || wanted.includes('auto')) {
    const sel = all.find(s => s.selected) || all.find(s => s.available);
    return sel ? [sel] : [];
  }
  return wanted.map(id => all.find(s => s.id === id)
    || { id, label: id, kind: null, available: false, reason: `Unknown log source "${id}".` });
}

/**
 * Follow one or more sources at once. Returns the function that stops them.
 * Order is not merged by timestamp: lines arrive as they arrive, which is the
 * only ordering that is true of two processes on one machine anyway.
 */
function open(spec, { tail = 200 } = {}, onLine) {
  const stops = [];
  for (const src of resolve(spec)) {
    if (!src.available) { onLine(line(src, 'warn', src.reason)); continue; }
    stops.push(src.kind === 'builtin' ? openBuiltin(src, tail, onLine) : openStack(src, tail, onLine));
  }
  if (!stops.length) onLine(line({ id: 'panel', label: 'panel' }, 'warn',
    'Nothing to follow. Pick a source above.'));
  return () => { for (const stop of stops) { try { stop(); } catch {} } };
}

/* ── Routes ───────────────────────────────────────────── */

/** GET /api/logs/sources */
function handleSources(_req, res) {
  res.json({ sources: sources(), selected: catalog.defaultId() });
}

/** GET /api/logs?sources=auto|a,b&tail=200 — SSE, one JSON line per event. */
function handleLogs(req, res) {
  sseHeaders(res);
  const tail = Math.min(2000, Math.max(0, parseInt(req.query.tail, 10) || 200));
  const write = l => { try { res.write(`data: ${JSON.stringify(l)}\n\n`); } catch { /* client gone */ } };
  const stop = open(req.query.sources, { tail }, write);
  req.on('close', stop);
}

module.exports = { sources, resolve, open, levelOf, fromHarness, handleLogs, handleSources, _ring: ring };
