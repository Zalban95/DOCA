'use strict';

/**
 * The game starter (skills/make-a-browser-game, 2026-10-17): a new game is a git repository with the title in place,
 * its level and plan tests pass on the starter, and the plan makes stand-ins that the plan test lists as todo until
 * real — and `npm run test:full` fails while any is left. The browser half of the game's tests needs a real Phaser
 * and Chrome; it is run by the game itself (`npm test`), not here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SKILL = path.join(__dirname, '..', 'skills', 'make-a-browser-game');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-game-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The game's own test runner, reporting as text: without NODE_TEST_CONTEXT it does not take this run for its parent.
const nodeTest = (dir, files, env = {}) => {
  const { NODE_TEST_CONTEXT, ...rest } = process.env;
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: dir, encoding: 'utf8', env: { ...rest, ...env } });
};

test('a new game: the starter in a git repository, its title in place, its content tests green', () => {
  const phaser = path.join(tmp, 'phaser.min.js');
  fs.writeFileSync(phaser, '/* Phaser stand-in for the test */');
  const dir = path.join(tmp, 'comet');
  execFileSync(process.execPath, [path.join(SKILL, 'scripts', 'new-game.js'), dir, '--title', "Comet's Run", '--phaser', phaser], { encoding: 'utf8' });
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /<title>Comet’s Run<\/title>/);
  assert.match(fs.readFileSync(path.join(dir, 'src', 'config.js'), 'utf8'), /TITLE = 'Comet’s Run'/);
  assert.match(fs.readFileSync(path.join(dir, 'src', 'systems', 'save.js'), 'utf8'), /'comet-s-run-save'/);
  assert.ok(fs.existsSync(path.join(dir, '.gitignore')) && !fs.existsSync(path.join(dir, 'gitignore')));
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }), '', 'everything is in the first commit');
  assert.match(execFileSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' }), /Starter for Comet's Run/);
  const r = nodeTest(dir, ['test/levels.test.js', 'test/plan.test.js']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.throws(() => execFileSync(process.execPath, [path.join(SKILL, 'scripts', 'new-game.js'), dir, '--phaser', phaser], { stdio: 'pipe' }), /not empty/);
});

test('the plan: stand-ins for every planned entity, listed as todo, and the full test fails until they are real', () => {
  const dir = path.join(tmp, 'comet');
  fs.copyFileSync(path.join(dir, 'docs', 'plan.example.json'), path.join(dir, 'docs', 'plan.json'));
  const out = execFileSync(process.execPath, ['scripts/plan.js'], { cwd: dir, encoding: 'utf8' });
  assert.match(out, /Stand-ins made: src\/entities\/enemies\/bat\.js, src\/entities\/items\/feather\.js, src\/entities\/bosses\/golem\.js/);
  assert.match(fs.readFileSync(path.join(dir, 'src', 'entities', 'enemies', 'index.js'), 'utf8'), /import Bat from '\.\/bat\.js';/);
  assert.match(fs.readFileSync(path.join(dir, 'src', 'levels', 'world2', 'index.js'), 'utf8'), /name: "Crystal Caves".*levels: \[\]/);
  let r = nodeTest(dir, ['test/levels.test.js', 'test/plan.test.js']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /enemies: bat # TODO bat is still a stand-in/);
  assert.match(r.stdout, /world "Crystal Caves": 3 levels # TODO 0 of 3 levels/);
  r = nodeTest(dir, ['test/levels.test.js', 'test/plan.test.js'], { GAME_PLAN: 'full' });
  assert.notEqual(r.status, 0, 'the full test fails while the plan has stand-ins');
  // Made real: the stand-in mark gone, the todo with it.
  const bat = path.join(dir, 'src', 'entities', 'enemies', 'bat.js');
  fs.writeFileSync(bat, fs.readFileSync(bat, 'utf8').replace('  static stub = true;\n', ''));
  assert.notEqual(nodeTest(dir, ['test/plan.test.js'], { GAME_PLAN: 'items' }).status, 0, 'a part\'s own gate fails while its stand-ins remain');
  r = nodeTest(dir, ['test/plan.test.js']);
  assert.doesNotMatch(r.stdout, /enemies: bat # TODO/);
  assert.equal(nodeTest(dir, ['test/plan.test.js'], { GAME_PLAN: 'enemies' }).status, 0, 'the enemies part is real: its gate passes, the rest still todo');
});
