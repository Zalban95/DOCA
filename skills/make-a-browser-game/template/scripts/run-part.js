// npm run test:part -- <part> — every test, with one part of docs/plan.json required to be real (no todo left for it):
// a team member's own gate. Parts: enemies, items, bosses, a world's folder (world1…) or worlds (all of them), art (the
// pictures), audio (sounds and tunes), story; several at once: enemies,items. `npm run test:full` requires them all.
// (Not named *-test.js: the test runner would take it for a test.)
import { spawnSync } from 'node:child_process';

const part = process.argv.slice(2).join(',').trim();
if (!part) { console.error('Name the part: npm run test:part -- enemies   (enemies, items, bosses, world1…, worlds, art, audio, story)'); process.exit(2); }
const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000'], { stdio: 'inherit', env: { ...process.env, GAME_PLAN: part } });
process.exit(r.status ?? 1);
