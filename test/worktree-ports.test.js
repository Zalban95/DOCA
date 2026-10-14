'use strict';

// A block of ports per git worktree (modules/projects/ports.js; fit audit 2026-10-14, item 13): parallel worktrees
// get different blocks, a port already taken is skipped, removing gives the block back, and a named command run in
// the worktree gets PORT and PORT_BLOCK.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('./helpers');

let repo, base;
before(async () => {
  await H.start();
  const utils = require('../modules/utils');
  base = 50000 + Math.floor(Math.random() * 1000) * 10;   // a range of its own, away from other suites' ports
  utils.savePrefs({ ...utils.loadPrefs(), projects: { portBase: base } });
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-wtp-'));
  const g = (...a) => execFileSync('git', a, { cwd: repo });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  g('add', '.'); g('commit', '-qm', 'first');
});
after(async () => { await H.stop(); fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(`${repo}.worktrees`, { recursive: true, force: true }); });

const listen = port => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(port, '127.0.0.1', () => resolve(s)); });

test('two worktrees get different blocks; a busy port is skipped; removing frees the block', async () => {
  const projects = require('../modules/projects/store');
  const worktrees = require('../modules/projects/worktrees');
  const p = projects.create({ root: repo, name: 'ports' });
  const busy = await listen(base);   // something already listens on the first block's first port
  try {
    const one = projects.newChat(p.id), two = projects.newChat(p.id);
    const [a, b] = await Promise.all([worktrees.create(one.id), worktrees.create(two.id)]);
    assert.ok(a.ports && b.ports, 'both have a block');
    assert.notEqual(a.ports.from, b.ports.from, 'not the same block');
    for (const w of [a, b]) {
      assert.equal(w.ports.to - w.ports.from, 9, 'a block of 10');
      assert.notEqual(w.ports.from, base, 'the busy port is skipped');
      assert.ok(w.ports.from > base && (w.ports.from - base) % 10 === 0);
    }
    const brief = await require('../modules/projects/brief').forSession(one.id);
    assert.match(brief, new RegExp(`PORT=${a.ports.from}`), 'the brief says the port');
    const freed = a.ports.from;
    await worktrees.remove(one.id);
    const three = projects.newChat(p.id);
    const c = await worktrees.create(three.id);
    assert.equal(c.ports.from, freed, 'the removed worktree\'s block is given again');
    await worktrees.remove(two.id); await worktrees.remove(three.id);
  } finally { busy.close(); }
});

test('a named command in the worktree runs with PORT and PORT_BLOCK', async () => {
  const projects = require('../modules/projects/store');
  const p = projects.create({ root: repo, name: 'ports-run' });
  projects.update(p.id, { commands: { ports: 'node -e "console.log(\'got\', process.env.PORT, process.env.PORT_BLOCK)"' } });
  const chat = projects.newChat(p.id);
  const wt = await require('../modules/projects/worktrees').create(chat.id);
  const r = await require('../modules/projects/run').run(p.id, 'ports', { sessionId: chat.id, waitSec: 20 });
  assert.equal(r.job.code, 0, JSON.stringify(r.job));
  assert.match(r.output, new RegExp(`got ${wt.ports.from} ${wt.ports.from}-${wt.ports.to}`));
  const main = await require('../modules/projects/run').run(p.id, 'ports', { waitSec: 20 });
  assert.doesNotMatch(main.output, new RegExp(`got ${wt.ports.from}`), 'the main folder\'s run has no block of the worktree');
  await require('../modules/projects/worktrees').remove(chat.id);
});
