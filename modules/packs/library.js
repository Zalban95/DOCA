'use strict';

/**
 * The pack library (TODO H4.5): every pack this hive keeps, whatever made it — saved from Settings → Packs, saved by
 * the agent (the `pack` tool), or received from another hub (POST /api/v1/packs). One `.dpack` and one small JSON
 * beside it per pack under DATA_DIR/packs. Nothing in the library is applied: bringing one in is the same dry run as
 * any pack, a host's click (import.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = () => path.join(require('../store').DATA_DIR, 'packs');
const ID = /^pk_[a-f0-9]{12}$/;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Keep a pack: `origin` made | agent | received, `from` who sent or made it. */
function save(buffer, { origin = 'made', from = null } = {}) {
  let manifest = null;
  try { const f = require('./zip').read(buffer).find(x => x.name === 'pack.json'); manifest = f ? JSON.parse(f.data.toString()) : null; } catch (e) { throw bad(`Not a pack: ${e.message}`); }
  const id = `pk_${crypto.randomBytes(6).toString('hex')}`;
  const meta = { id, name: String(manifest?.name || 'pack').slice(0, 80), description: String(manifest?.description || '').slice(0, 500),
    contents: (manifest?.contents || []).map(c => ({ kind: c.kind, id: c.id || null })).slice(0, 200), native: !manifest,
    origin, from: from ? String(from).slice(0, 120) : null, bytes: buffer.length, savedAt: new Date().toISOString() };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${id}.dpack`), buffer);
  fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify(meta, null, 2));
  return meta;
}

function list() {
  try { return fs.readdirSync(dir()).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8'))).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); }
  catch { return []; }
}

function get(id) {
  if (!ID.test(String(id))) throw bad('No such pack in the library.', 404);
  const f = path.join(dir(), `${id}.dpack`);
  if (!fs.existsSync(f)) throw bad('No such pack in the library.', 404);
  return { meta: JSON.parse(fs.readFileSync(path.join(dir(), `${id}.json`), 'utf8')), buffer: fs.readFileSync(f) };
}

/** Publish a pack to hubs holding packs:read (the registry, experiments.packRegistry), or take it back. */
function publish(id, on = true) {
  const { meta } = get(id);
  meta.published = !!on;
  fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify(meta, null, 2));
  return meta;
}
const published = () => list().filter(p => p.published);

function remove(id) {
  get(id);
  for (const ext of ['dpack', 'json']) fs.rmSync(path.join(dir(), `${id}.${ext}`), { force: true });
  return { removed: id };
}

module.exports = { save, list, get, remove, publish, published };
