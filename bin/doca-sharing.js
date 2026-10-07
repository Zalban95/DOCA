#!/usr/bin/env node
'use strict';

/**
 * `node bin/doca-sharing.js on|off|status` — the owner's answer to "offer what the agents learn to the project?"
 * (CONSTITUTION §0, step 4; modules/sharing.js), recorded by the installers when they ask it (scripts/install.*) and
 * changeable later in Settings → Packs. Writes the settings file directly: run it while the panel is stopped.
 */
const sharing = require('../modules/sharing');
const arg = String(process.argv[2] || 'status').toLowerCase();
if (arg === 'on' || arg === 'off') sharing.set({ contribute: arg === 'on' });
else if (arg !== 'status') { console.error('Usage: node bin/doca-sharing.js on|off|status'); process.exit(2); }
const s = sharing.state();
console.log(!s.decided ? 'Sharing with the project: not decided (Settings → Packs asks).' : `Sharing with the project: ${s.contribute ? 'on — nothing is sent without your click' : 'off'}.`);
