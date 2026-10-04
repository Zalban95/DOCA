'use strict';

// The launcher in Node, the same on Linux, Windows and macOS (bin/doca-launch.js, hive.md §7).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const L = require('../bin/doca-launch');

test('.env is read the way the shell read it', () => {
  assert.deepEqual(L.parseEnv('# c\nA=1\nexport B="two words" # note\nC=\'x\'\nD=plain # trailing\n\nbad line'),
    { A: '1', B: 'two words', C: 'x', D: 'plain' });
});

test('the version to start: .releases/current when installed, else the checkout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-'));
  assert.equal(L.releaseDir(dir), dir);
  fs.mkdirSync(path.join(dir, '.releases', 'v9'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.releases', 'current'), 'v9\n');
  assert.equal(L.releaseDir(dir), dir, 'named but not installed');
  fs.writeFileSync(path.join(dir, '.releases', 'v9', 'server.js'), '');
  assert.equal(L.releaseDir(dir), path.join(dir, '.releases', 'v9'));
});

test('the boot entries: Task Scheduler at logon, a launchd agent at login, both running the launcher', () => {
  const args = L.schtasksCreateArgs();
  assert.deepEqual(args.slice(0, 6), ['/Create', '/TN', 'DOCA', '/SC', 'ONLOGON', '/RL']);
  assert.match(args.at(-1), /doca-launch\.js" start$/);
  const plist = L.launchdPlist();
  assert.match(plist, /<key>Label<\/key><string>tech\.doca\.panel<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /doca-launch\.js<\/string><string>start<\/string>/);
});

test('a switched-to version that does not answer is put back, and the previous one started', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-'));
  const port = await new Promise(r => { const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  for (const v of ['v1', 'v2']) fs.mkdirSync(path.join(dir, '.releases', v, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.releases', 'v1', 'server.js'), `require('http').createServer((q, r) => r.end('v1')).listen(${port}, '127.0.0.1');`);
  fs.writeFileSync(path.join(dir, '.releases', 'v2', 'server.js'), 'process.exit(3);');
  fs.writeFileSync(path.join(dir, '.releases', 'current'), 'v2\n');
  fs.writeFileSync(path.join(dir, '.releases', 'pending'), 'v2 v1\n');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'doca-launch.js'), 'start'],
    { env: { ...process.env, DOCA_LAUNCH_DIR: dir, DOCA_LAUNCH_WATCH_SECONDS: '6', PORT: String(port) }, stdio: 'ignore' });
  let body = null;
  for (let i = 0; i < 60 && body !== 'v1'; i++) {
    await new Promise(r => setTimeout(r, 200));
    body = await new Promise(r => http.get({ host: '127.0.0.1', port, path: '/' }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => r(b)); }).on('error', () => r(null)));
  }
  child.kill('SIGTERM');
  await new Promise(r => child.on('exit', r));
  assert.equal(body, 'v1');
  assert.equal(fs.readFileSync(path.join(dir, '.releases', 'current'), 'utf8').trim(), 'v1');
  assert.ok(!fs.existsSync(path.join(dir, '.releases', 'pending')));
  assert.match(fs.readFileSync(path.join(dir, '.releases', 'log.jsonl'), 'utf8'), /"event":"revert","to":"v1","from":"v2"/);
});
