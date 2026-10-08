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

test('the boot entries: Task Scheduler at logon (test/windows-task.test.js), a launchd agent at login, both running the launcher', () => {
  assert.equal(L.TASK, 'DOCA');
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

// Deep test B (B5): the installers' "start it now" died with the terminal it ran in — `nohup node` is undone by Node,
// which resets an ignored SIGHUP. `start --detach` puts the launcher in a session of its own; a hang-up sent to the
// whole group of the shell that ran it (what a closing terminal does) must leave DOCA running.
test('start --detach outlives a hang-up of the shell that started it', { skip: process.platform === 'win32' && 'POSIX sessions' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  const pidFile = path.join(dir, 'server.pid');
  fs.writeFileSync(path.join(dir, 'server.js'), `require('fs').writeFileSync(${JSON.stringify(pidFile)}, process.pid + ' ' + process.ppid); setInterval(() => {}, 1000);`);
  const launcher = path.join(__dirname, '..', 'bin', 'doca-launch.js');
  const shell = spawn('/bin/sh', ['-c', `"${process.execPath}" "${launcher}" start --detach --log "${path.join(dir, 'doca.log')}"; sleep 30`],
    { env: { ...process.env, DOCA_LAUNCH_DIR: dir }, detached: true, stdio: 'ignore' });
  let pids = null;
  for (let i = 0; i < 100 && !pids; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { pids = fs.readFileSync(pidFile, 'utf8').split(' ').map(Number); } catch {}
  }
  assert.ok(pids, 'the server started');
  process.kill(-shell.pid, 'SIGHUP');
  await new Promise(r => setTimeout(r, 800));
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const [server, launch] = pids;
  try {
    assert.ok(alive(server), 'the server survived the hang-up');
    assert.ok(alive(launch), 'the launcher survived the hang-up');
  } finally {
    for (const p of [launch, server]) { try { process.kill(p, 'SIGTERM'); } catch {} }
    try { process.kill(-shell.pid, 'SIGKILL'); } catch {}
  }
});
