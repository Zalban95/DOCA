'use strict';

/**
 * A block of ports per git worktree (fit audit 2026-10-14, item 13): conversations working in parallel worktrees of
 * one project each start the same dev server, and every one of them took the same port. Each worktree gets a block
 * of SIZE ports from `projects.portBase` up — the first block no other worktree, of any project, holds and whose
 * first port is free on this machine right now — kept on the worktree (`ports: {from, to}`) and given back when the
 * worktree is removed. Named commands get it as PORT and PORT_BLOCK (run.js), and the brief says it.
 *
 * Who holds which block is one store document keyed by the worktree's folder, so a team's worktrees (teams/place.js,
 * not on a session) count too; a folder that no longer exists gives its block back the next time one is taken.
 */
const fs = require('fs');
const net = require('net');
const store = require('../store');

const DOC = 'worktree-ports';
const SIZE = 10;
const TOP = 65535;

const read = () => store.readJson(DOC, {}) || {};

/** Whether something answers a connection on loopback at `port` (within a second). */
const answers = port => new Promise(resolve => {
  const sock = net.connect({ port, host: '127.0.0.1', timeout: 1000 });
  const done = v => { sock.destroy(); resolve(v); };
  sock.once('connect', () => done(true)); sock.once('error', () => done(false)); sock.once('timeout', () => done(false));
});

/**
 * Whether nothing listens on `port` now: nothing answers on loopback, and a test listen on every address works (closed
 * at once). Both, because macOS and Windows let a listen on every address succeed while a server holds the port on
 * 127.0.0.1 alone (CI, 2026-10-14) — a dev server usually binds one or the other.
 */
const free = async port => !(await answers(port)) && new Promise(resolve => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen({ port, exclusive: true }, () => srv.close(() => resolve(true)));
});

let chain = Promise.resolve();   // one taking at a time: two worktrees made together must not get the same block
const serial = fn => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

/** Take a block for the worktree at `at`: `{from, to}`, or null when none is free below the top port. */
function take(at) {
  return serial(async () => {
    const held = read();
    for (const k of Object.keys(held)) if (k !== at && !fs.existsSync(k)) delete held[k];
    if (held[at]) return held[at];
    const base = Number(require('../settings-schema').value('projects.portBase')) || 41000;
    const used = new Set(Object.values(held).map(b => b.from));
    for (let from = base; from + SIZE - 1 <= TOP; from += SIZE) {
      if (used.has(from) || !(await free(from))) continue;
      held[at] = { from, to: from + SIZE - 1 };
      store.writeJson(DOC, held);
      return held[at];
    }
    store.writeJson(DOC, held);
    return null;
  });
}

/** Give the block of the worktree at `at` back. */
function release(at) {
  return serial(() => {
    const held = read();
    if (!held[at]) return false;
    delete held[at];
    store.writeJson(DOC, held);
    return true;
  });
}

/** The variables a command in a worktree with block `b` runs with: neutral names a dev server already reads. */
const vars = b => (b ? { PORT: String(b.from), PORT_BLOCK: `${b.from}-${b.to}` } : {});

/** One line for the brief. */
const briefLine = b => (b ? `Ports: this worktree has ${b.from}–${b.to} of its own, so a dev server does not take another conversation's port — the project's commands run with PORT=${b.from} and PORT_BLOCK=${b.from}-${b.to}; in your own shell commands use ${b.from} (or another of the block), never the usual default.` : '');

module.exports = { take, release, vars, briefLine, SIZE, free };
