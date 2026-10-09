'use strict';

const H = require('./helpers');   // first, as every test (it pins the settings paths); nothing here starts the app
void H;

/**
 * The deploy kit (Dockerfile, .dockerignore, deploy/): what the image carries and how a hive is made. The image is
 * built and run for real by CI's `image` job; this holds the parts that must not drift in between.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the image runs DOCA hosted, unprivileged, with its data in /data and a health check', () => {
  const d = read('Dockerfile');
  for (const want of [/DOCA_PROFILE=hosted/, /DOCA_HOME=\/data\b/, /DOCA_DATA_DIR=\/data\/doca/, /WORKSPACE_DIR=\/data\/workspace/,
    /^USER node$/m, /^VOLUME \/data$/m, /npm ci --omit=dev/, /HEALTHCHECK[\s\S]*\/api\/branding/, /ENTRYPOINT \["\/usr\/bin\/tini", "--"\]/,
    /CMD \["node", "server\.js"\]/, /chmod -R a-w \/app/, /\/usr\/bin\/sh/])
    assert.match(d, want);
  // Every runtime path is inside the volume, so a hosted hive's roots (modules/hosted.js) are never the code's folder.
  const env = Object.fromEntries([...d.matchAll(/^\s+([A-Z_]+)=(\S+?)(?: \\)?$/gm)].map(m => [m[1], m[2]]));
  for (const k of ['WORKSPACE_DIR', 'ATTACHMENTS_DIR', 'AGENTS_DIR', 'HOME', 'DOCA_BACKUP_DIR']) assert.match(env[k], /^\/data\//, k);
});

test('the image carries no tests, history, notes or install leftovers', () => {
  const ignore = read('.dockerignore').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const p of ['.git', 'test', 'docs', 'node_modules', '*.md', '.env', '.doca', '.certs', 'skills/doca-dev-cycle', 'deploy', 'scripts'])
    assert.ok(ignore.includes(p), `${p} is not left out`);
  for (const keep of ['!skills/**/*.md', '!specialists/*.md']) assert.ok(ignore.includes(keep), `${keep} is not kept`);
});

test('a compose hive answers on 127.0.0.1 by default, and its template holds no secret', () => {
  const c = read('deploy/compose.yml');
  assert.match(c, /\$\{HIVE_BIND:-127\.0\.0\.1\}:\$\{HIVE_PORT:-4310\}:\$\{HIVE_PORT:-4310\}/);
  assert.match(c, /name: \$\{HIVE_NAME:-hive\}-data/, 'named as hive.sh names a volume');
  for (const k of ['read_only: true', 'cap_drop: [ALL]', 'no-new-privileges:true', 'pids_limit']) assert.ok(c.includes(k), k);
  const env = read('deploy/hive.env.example');
  for (const line of env.split('\n').filter(l => /^[A-Z_]+=/.test(l)))
    assert.doesNotMatch(line, /(TOKEN|KEY|SECRET|PASSWORD)=\S/, `a secret in the template: ${line}`);
});

test('hive.sh reads, and refuses a bad name before touching Docker', { skip: process.platform === 'win32' && 'bash is not the shell here' }, () => {
  const sh = path.join(ROOT, 'deploy', 'hive.sh');
  assert.strictEqual(spawnSync('bash', ['-n', sh]).status, 0);
  const help = spawnSync('bash', [sh, 'help'], { encoding: 'utf8' });
  assert.match(help.stdout, /new <name>/);
  const bad = spawnSync('bash', [sh, 'new', 'Bad_Name'], { encoding: 'utf8', env: { ...process.env, DOCKER: 'false' } });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /lower-case letters/);
});
