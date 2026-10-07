'use strict';

/**
 * Previews: a server running on this machine (a dev server, a served project,
 * an MCP app's UI), shown in a canvas window through the canvas origin.
 *
 * A dev server usually listens on localhost only, so a phone on the tailnet
 * could not reach it at all; and it must never be framed from the panel's own
 * origin, where /api runs shell commands. A preview is a token for one port on
 * 127.0.0.1, issued by the panel (or the agent's canvas tool) and good for
 * TTL_H hours. The canvas origin proxies to that port and nothing else; the
 * panel's own ports are never a preview, nor an agents' computer's control or
 * screen ports (a token and a password guard those, and a preview would not).
 * A computer's page is previewed by naming the computer: its page port
 * (computers SERVE, published on the hub's 127.0.0.1 as `servePort`) — what a
 * repository run inside it serves (TODO H10.18).
 *
 * Stored in `<DATA_DIR>/canvas/previews.json`.
 */
const crypto = require('crypto');
const store  = require('../store');
const { PORT, CANVAS_PORT } = require('../paths');

const TTL_H = 12;
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function rows() {
  const now = Date.now();
  return store.readJson('canvas/previews', { previews: [] }).previews.filter(p => Date.parse(p.expiresAt) > now);
}

/** The hub port of a computer's page (its SERVE port inside), or why there is none. */
function computerPort(id) {
  const computers = require('../computers');
  const c = computers.need(id);
  if (!c.servePort) throw bad(`Computer ${c.id} was made before computers had a page port: make a new one to serve a page from it.`, 409);
  return { n: c.servePort, where: `port ${computers.SERVE} in computer ${c.id} "${c.name}"`, computer: c.id };
}

function create({ port, computer, title, sessionId = null }) {
  const at = computer ? computerPort(computer) : null;
  const n = at ? at.n : Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw bad('port is a number from 1 to 65535.');
  if (n === Number(PORT) || n === Number(CANVAS_PORT)) throw bad('The panel\'s own ports cannot be previewed.', 403);
  if (!at && require('../computers').all().some(c => [c.mcpPort, c.vncPort].includes(n)))
    throw bad('That port is an agents\' computer\'s control or screen: watch a computer from the Computers tab.', 403);
  const where = at ? at.where : `localhost:${n}`;
  const p = {
    id: `prv_${crypto.randomBytes(6).toString('hex')}`, token: crypto.randomBytes(16).toString('base64url'),
    port: n, title: String(title || where).slice(0, 120), where, ...(at ? { computer: at.computer } : {}), sessionId,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TTL_H * 3600e3).toISOString(),
  };
  store.writeJson('canvas/previews', { previews: [...rows(), p].slice(-50) });
  return p;
}

function get(id) { return rows().find(p => p.id === id) || null; }

function byToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const y = Buffer.from(String(token));
  return rows().find(p => { const x = Buffer.from(p.token); return x.length === y.length && crypto.timingSafeEqual(x, y); }) || null;
}

module.exports = { create, get, byToken, TTL_H };
