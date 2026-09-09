#!/usr/bin/env node
'use strict';

/**
 * Issue, list, rotate and revoke /api/v1 device tokens from the host.
 * This is how the first admin/agent tokens are minted (no UI needed).
 *
 *   npm run token -- issue --name phone --preset phone
 *   npm run token -- issue --name agent --preset agent
 *   npm run token -- issue --name kiosk --scopes read:system.*,interact
 *   npm run token -- list
 *   npm run token -- rotate dev_ab12cd34ef56
 *   npm run token -- revoke dev_ab12cd34ef56
 *
 * Tokens are printed once and never stored in plaintext.
 */
const devices = require('../modules/api-v1/devices');
const { PRESETS, FAMILIES } = require('../modules/api-v1/scopes');
const { DATA_DIR } = require('../modules/api-v1/store');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

function usage() {
  console.log(`doca-token — manage /api/v1 device tokens (data dir: ${DATA_DIR})

  issue  --name <n> (--preset <p> | --scopes a,b,c) [--kind agent|device] [--expires <ISO>] [--json]
  list
  rotate <deviceId>
  revoke <deviceId>
  scopes

Presets: ${Object.keys(PRESETS).join(', ')}`);
}

switch (cmd) {
  case 'issue': {
    const name = opt('name');
    const preset = opt('preset');
    const scopes = opt('scopes') ? opt('scopes').split(',') : preset ? PRESETS[preset] : null;
    if (!name || !scopes) { usage(); process.exit(1); }
    const r = devices.create({ name, scopes, kind: opt('kind') || (preset === 'agent' ? 'agent' : 'device'), expiresAt: opt('expires') || null, caps: { formFactor: preset === 'agent' ? 'headless' : 'other' } });
    if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`\nDevice  ${r.device.id}  (${r.device.name})\nScopes  ${r.device.scopes.join(' ')}\n\nToken (shown once):\n\n  ${r.token}\n\nUse:  curl -k -H "Authorization: Bearer ${r.token}" https://<host>:4242/api/v1/capabilities\n`);
    }
    break;
  }
  case 'list':
    for (const d of devices.list()) console.log(`${d.id}  ${d.revokedAt ? 'REVOKED ' : ''}${d.name.padEnd(20)} ${d.kind.padEnd(7)} ${d.scopes.join(' ')}`);
    break;
  case 'rotate': {
    const r = devices.rotate(args[1]);
    if (!r) { console.error('unknown device'); process.exit(1); }
    console.log(`New token (old one valid until ${r.previousValidUntil}):\n\n  ${r.token}\n`);
    break;
  }
  case 'revoke':
    console.log(devices.revoke(args[1]) ? `revoked ${args[1]}` : 'unknown device');
    break;
  case 'scopes':
    for (const [f, d] of Object.entries(FAMILIES)) console.log(`${f.padEnd(10)} ${d}`);
    console.log('\nPresets:'); for (const [p, s] of Object.entries(PRESETS)) console.log(`  ${p.padEnd(8)} ${s.join(' ')}`);
    break;
  default: usage(); process.exit(cmd ? 1 : 0);
}
