#!/usr/bin/env node
'use strict';

/**
 * The host's side of updating a hive that runs the image (deploy/hive.sh update; modules/update-channel/hold.js). Run
 * inside the hive's container with docker exec, as the hive's own user, so it reaches the hive's data and nothing else:
 *
 *   node bin/doca-update.js hold [--timeout SECONDS]   ask the hive to stop once nothing runs; waits, printing what it
 *                                                      waits on, and exits 0 when the hive is ready (it then stops by
 *                                                      itself), 2 when the time ran out (the request stays: release it)
 *   node bin/doca-update.js release                    call the request off: the hive keeps running as it was
 *   node bin/doca-update.js latest                     what the hive's update channel found, verified (JSON): the
 *                                                      version, its image and digest, urgent, applyBy
 *   node bin/doca-update.js verify < doca-update.json  an update file's signed manifest (update-channel/update-file.js),
 *                                                      checked against the release keys this hive trusts: its version,
 *                                                      whether it is newer than what runs, its image and the image
 *                                                      tarball's sha256 (JSON), or exit 1 saying why not
 */
const fs = require('fs');
const path = require('path');

const store = require('../modules/store');
const dir = path.join(store.DATA_DIR, 'update-channel');
const REQ = path.join(dir, 'hold-request.json'), STATE = path.join(dir, 'hold-state.json');
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };

async function hold() {
  const timeout = Number(arg('--timeout', 6 * 3600)) * 1000;
  fs.mkdirSync(dir, { recursive: true });
  const at = new Date().toISOString();
  fs.writeFileSync(REQ, JSON.stringify({ at, by: arg('--by', 'deploy/hive.sh update') }));
  const until = Date.now() + timeout;
  let said = '';
  for (;;) {
    const s = read(STATE);
    if (s?.state === 'ready') { console.log('ready: nothing is running; the hive stops now'); return 0; }
    const line = s?.state === 'waiting' && s.on?.length ? `waiting for: ${s.on.join('; ')}` : 'waiting for the hive to answer';
    if (line !== said) { console.log(line); said = line; }
    if (Date.now() > until) { console.log('the time ran out; the hive is still working (release the request, or wait again)'); return 2; }
    await new Promise(r => setTimeout(r, 1000));
  }
}

function latest() {
  const s = store.readJson('update-channel/state', {});
  const l = s.latest;
  process.stdout.write(`${JSON.stringify(l ? { version: l.version, image: l.manifest.image || null, imageDigest: l.manifest.imageDigest || null,
    urgent: !!l.manifest.urgent, applyBy: s.urgent?.applyBy || null, checked: s.lastCheck || null } : { version: null, checked: s.lastCheck || null, error: s.lastError || null })}\n`);
  return 0;
}

/** The hive's own trust decides, not the host's: the keys are in the code this hive runs. */
async function verify() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { console.error('not an update file\'s doca-update.json'); return 1; }
  const m = require('../modules/update-channel/manifest');
  try {
    const { manifest, keyId } = m.verify(body.manifest, body.signature, require('../modules/update-channel/keys').RELEASE_KEYS);
    const running = require('../package.json').version;
    process.stdout.write(`${JSON.stringify({ version: manifest.version, running, newer: m.cmp(manifest.version, running) > 0, keyId,
      image: manifest.image || null, imageSha256: manifest.imageSha256 || null, dataFormat: manifest.dataFormat || 1 })}\n`);
    return 0;
  } catch (e) { console.error(e.message); return 1; }
}

const cmd = process.argv[2];
(async () => {
  if (cmd === 'hold') return hold();
  if (cmd === 'release') { fs.rmSync(REQ, { force: true }); console.log('released: the hive carries on'); return 0; }
  if (cmd === 'latest') return latest();
  if (cmd === 'verify') return verify();
  console.log('node bin/doca-update.js hold [--timeout SECONDS] | release | latest | verify < doca-update.json');
  return 1;
})().then(code => process.exit(code), e => { console.error(e.message); process.exit(1); });
