'use strict';

// A project's environment: the machine's, or its own venv — seen, chosen, and used by its commands (projects/env.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const projects = require('../modules/projects/store');
const env = require('../modules/projects/env');

const WIN = process.platform === 'win32';
let p, root;

before(async () => {
  await H.start();
  root = fs.mkdtempSync(path.join(H.tmp, 'envproj-'));
  const bin = path.join(root, '.venv', WIN ? 'Scripts' : 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(root, '.venv', 'pyvenv.cfg'), 'home = /usr/bin\nversion = 3.12.3\n');
  fs.writeFileSync(path.join(bin, WIN ? 'python.exe' : 'python'), '');
  fs.writeFileSync(path.join(root, 'requirements.txt'), 'requests\n');
  p = projects.create({ root, name: 'Env' });
});
after(() => H.stop());

test('the project\'s venv is found and used by default; the machine can be chosen instead', async () => {
  const r = await H.api(null, 'GET', `/api/projects/${p.id}/env`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.local.venvs, [{ dir: '.venv', version: '3.12.3', python: true }]);
  assert.ok(r.body.local.files.includes('requirements.txt'));
  assert.deepEqual(r.body.chosen, { kind: 'venv', dir: '.venv', version: '3.12.3' }, 'a venv in the project is used, the way an IDE opens it');
  assert.ok(r.body.runtimes.some(x => x.id === 'node' && x.detected), 'the machine\'s runtimes are listed (node runs this test)');

  const m = await H.api(null, 'POST', `/api/projects/${p.id}/env`, { python: 'machine' });
  assert.equal(m.body.chosen.kind, 'machine');
  assert.match(env.briefLine(projects.need(p.id)), /^Python: the machine's\./);
  await H.api(null, 'POST', `/api/projects/${p.id}/env`, { python: '.venv' });
  assert.match(env.briefLine(projects.need(p.id)), /the project's own venv \.venv \(3\.12\.3\)/);
  assert.equal((await H.api(null, 'POST', `/api/projects/${p.id}/env`, { python: '../etc' })).status, 400);
});

test('the project\'s commands run with its venv first on PATH', async () => {
  const cmd = WIN ? 'echo %VIRTUAL_ENV%' : 'echo "$VIRTUAL_ENV|$PATH"';
  projects.update(p.id, { commands: { where: cmd } });
  const r = await require('../modules/projects/run').run(p.id, 'where', { waitSec: 10 });
  assert.equal(r.job.code, 0);
  assert.match(r.output, new RegExp(path.join(root, '.venv').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
  if (!WIN) assert.ok(r.output.split('|')[1].startsWith(path.join(root, '.venv', 'bin')), 'its bin comes first');
});

test('setup: a venv with the machine\'s Python, pip into the chosen one, refusals that say why', () => {
  const pj = projects.need(p.id);
  if (require('../modules/shell').which('python3') || require('../modules/shell').which('python')) {
    const v = env.setupCommand(pj, 'venv', { dir: '.venv2' });
    assert.match(v.run, /^(python3|python|py) -m venv \.venv2$/);
    assert.deepEqual(v.then, { python: '.venv2' });
  }
  assert.match(env.setupCommand(pj, 'pip').run, /\.venv.*python.* -m pip install -r requirements\.txt$/, 'into the venv, not the machine');
  assert.throws(() => env.setupCommand(pj, 'npm'), /no package\.json/);
  assert.throws(() => env.setupCommand(pj, 'venv', { dir: '../x' }), /folder name/);
});
