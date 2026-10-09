'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Update from the hub this client is paired with (TODO H6.5; api-v1/client-files.js): its manifest lists each file
 * with a sha256; what differs here is fetched as bytes over the pinned connection, checked against that sha256, and
 * only then written — the previous copy kept in the config folder. Returns what changed. doca-client.js hands it its
 * config and its pinned requests.
 */
module.exports = ({ load, request, configDir }) => async function update({ dir = __dirname } = {}) {
  const cfg = load();
  if (!cfg) throw new Error('Not paired: pair first, then update from that hub.');
  const m = await request(cfg, 'GET', '/api/v1/clients/node');
  if (m.status !== 200) throw new Error(`The hub has no client channel (${m.status}); it may be older than 2.191.0.`);
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const fetched = [];
  for (const f of m.body.files) {
    const here = path.join(dir, f.name);
    if (fs.existsSync(here) && sha(fs.readFileSync(here)) === f.sha256) continue;
    const res = await request(cfg, 'GET', `/api/v1/clients/node/${encodeURIComponent(f.name)}`, undefined, { stream: true });
    const bytes = Buffer.concat(await new Promise((resolve, reject) => { const parts = []; res.on('data', d => parts.push(d)); res.on('end', () => resolve(parts)); res.on('error', reject); }));
    if (res.statusCode !== 200 || sha(bytes) !== f.sha256) throw new Error(`${f.name} did not arrive intact; nothing was replaced.`);
    fetched.push({ name: f.name, bytes });
  }
  const keep = path.join(configDir(), 'previous');
  for (const f of fetched) {
    const here = path.join(dir, f.name);
    if (fs.existsSync(here)) { fs.mkdirSync(keep, { recursive: true }); fs.copyFileSync(here, path.join(keep, f.name)); }
    fs.writeFileSync(`${here}.new`, f.bytes);
    fs.renameSync(`${here}.new`, here);
  }
  return { version: m.body.version, changed: fetched.map(f => f.name) };
}
