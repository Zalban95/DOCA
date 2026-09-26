'use strict';

/**
 * Canvases: pages the agent opens, writes into and keeps.
 *
 * A canvas is a page, not a message — a small tool it made, a diagram, a
 * report that reads better laid out than as markdown. Each belongs to the
 * conversation that made it, keeps its last revisions (like attachments, a
 * later write never changes what an earlier message pointed at), and is served
 * only from the canvas origin (./origin.js), never from the panel's.
 *
 * The `token` is the page's address on that origin. It is the only thing that
 * lets a browser load it: the canvas origin has no sessions and no cookies, so
 * the address itself is the permission — 128 random bits, never logged.
 *
 * Stored as `<DATA_DIR>/canvas/<id>.json`.
 */
const crypto = require('crypto');
const store  = require('../store');

const MAX_HTML = 2 * 1024 * 1024;   // one revision; a page bigger than this is an app, not a canvas
const MAX_REVS = 20;

const ID_RE = /^cnv_[a-z0-9]{12}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

const key = id => `canvas/${id}`;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function checkHtml(html) {
  const s = String(html ?? '');
  if (!s.trim()) throw bad('A canvas needs some HTML.');
  if (Buffer.byteLength(s) > MAX_HTML) throw bad(`A canvas revision is capped at ${MAX_HTML / 1024 / 1024} MB.`);
  return s;
}

/** A new canvas with its first revision. */
function create({ title, html, sessionId = null, by = 'agent' }) {
  const id = `cnv_${crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 12)}`;
  const at = new Date().toISOString();
  const c = {
    id, token: crypto.randomBytes(16).toString('base64url'),
    title: String(title || 'Canvas').slice(0, 120), sessionId, createdAt: at, updatedAt: at,
    revisions: [{ rev: 1, at, by, html: checkHtml(html) }],
  };
  store.writeJson(key(id), c);
  return c;
}

function get(id) {
  if (!ID_RE.test(String(id))) return null;
  return store.readJson(key(id), null);
}

/** A new revision; the oldest go past MAX_REVS. */
function write(id, { html, title, by = 'agent' }) {
  const c = get(id);
  if (!c) throw bad(`No canvas "${id}".`, 404);
  const rev = (c.revisions.at(-1)?.rev || 0) + 1;
  const at = new Date().toISOString();
  c.revisions = [...c.revisions, { rev, at, by, html: checkHtml(html) }].slice(-MAX_REVS);
  if (title) c.title = String(title).slice(0, 120);
  c.updatedAt = at;
  store.writeJson(key(id), c);
  return c;
}

/** The canvas a token names, for the canvas origin. */
function byToken(token) {
  if (!TOKEN_RE.test(String(token))) return null;
  for (const c of list({ withToken: true })) {
    const x = Buffer.from(c.token), y = Buffer.from(String(token));
    if (x.length === y.length && crypto.timingSafeEqual(x, y)) return get(c.id);
  }
  return null;
}

/** Every canvas, newest first, without their pages. */
function list({ sessionId, withToken = false } = {}) {
  const fs = require('fs'), path = require('path');
  const dir = store.dir('canvas');
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const c = get(path.basename(f, '.json'));
    if (!c || (sessionId && c.sessionId !== sessionId)) continue;
    out.push(summary(c, { withToken }));
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function summary(c, { withToken = false } = {}) {
  return {
    id: c.id, title: c.title, sessionId: c.sessionId, createdAt: c.createdAt, updatedAt: c.updatedAt,
    revisions: c.revisions.map(r => ({ rev: r.rev, at: r.at, by: r.by, bytes: Buffer.byteLength(r.html) })),
    ...(withToken ? { token: c.token } : {}),
  };
}

/** One revision's page (the latest when `rev` is omitted). */
function page(c, rev) {
  const r = rev ? c.revisions.find(x => x.rev === Number(rev)) : c.revisions.at(-1);
  return r ? r.html : null;
}

function remove(id) {
  if (!get(id)) throw bad(`No canvas "${id}".`, 404);
  store.removeJson(key(id));
}

module.exports = { create, get, write, byToken, list, summary, page, remove, MAX_HTML, MAX_REVS };
