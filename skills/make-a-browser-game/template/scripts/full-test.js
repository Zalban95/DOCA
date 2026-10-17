// npm run test:full — every test, and everything docs/plan.json names must be real (no todo left): the check for the
// game as a whole, after the parts are put together.
import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000'], { stdio: 'inherit', env: { ...process.env, GAME_PLAN: 'full' } });
process.exit(r.status ?? 1);
