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
 * panel's own ports are never a preview.
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

function create({ port, title, sessionId = null }) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw bad('port is a number from 1 to 65535.');
  if (n === Number(PORT) || n === Number(CANVAS_PORT)) throw bad('The panel\'s own ports cannot be previewed.', 403);
  const p = {
    id: `prv_${crypto.randomBytes(6).toString('hex')}`, token: crypto.randomBytes(16).toString('base64url'),
    port: n, title: String(title || `localhost:${n}`).slice(0, 120), sessionId,
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
