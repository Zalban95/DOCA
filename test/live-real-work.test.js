'use strict';

/**
 * Live and the Workstream on real work (asked 2026-10-10 from the owner's phone: "Still nothing automatically on Live or
 * Workstream"): the sentinel held from a phone's page, the folders `workstream.roots` adds, an edit made outside DOCA
 * labelled so with the process working there, the lines for work outside DOCA, an Android emulator's tile through a
 * stand-in adb, and a computer container no record names shown as a computer.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ws = require('../modules/workstream');
const sentinel = require('../modules/workstream/sentinel');
const roots = require('../modules/workstream/roots');

test.before(() => H.start());
test.after(() => H.stop());

async function stream(cookie) {
  const ctrl = new AbortController();
  const res = await fetch(`${H.base}/api/live/stream`, { headers: { Cookie: cookie }, signal: ctrl.signal });
  const got = []; let buf = '', hello = null;
  const pump = (async () => { const r = res.body.getReader(); try { for (;;) { const { value, done } = await r.read(); if (done) return; buf += new TextDecoder().decode(value);
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); if (!l.startsWith('data: ')) continue; const c = JSON.parse(l.slice(6)); if (c.hello) hello = c; else got.push(c); } } } catch { /* closed */ } })();
  for (let i = 0; i < 100 && !hello; i++) await H.sleep(20);
  return { got, hello, close: async () => { ctrl.abort(); await pump; } };
}
const MAC = process.platform === 'darwin';
const until = async (fn, ms = MAC ? 12000 : 5000) => { for (const end = Date.now() + ms; Date.now() < end; await H.sleep(25)) if (fn()) return true; return false; };

test('a phone\'s page (DocaMobile\'s WebView, its device token) holds the sentinel once its person confirms the password', async () => {
  const { device, token } = H.mkDevice('Phone', 'phone', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(device.id, { userId: H.owner.user.id, orgId: H.owner.orgId });
  const page = await fetch(`${H.base}/`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0 (Linux; Android 15) DocaMobile/1.3.0' }, redirect: 'manual' });
  const cookie = String(page.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'the app\'s page request opened a session');
  const s = await stream(cookie);
  try {
    assert.ok(s.hello?.screen);
    const capped = await H.api(null, 'POST', '/api/workstream/hold', { screen: s.hello.screen, on: true }, { Cookie: cookie });
    assert.equal(capped.status, 401);
    assert.equal(capped.body.code, 'step_up_required', 'a device\'s session stops at its scopes until the password: the page asks, never fails silently');
    assert.equal((await H.api(null, 'POST', '/api/auth/step-up', { password: H.owner.password }, { Cookie: cookie })).status, 200);
    const held = await H.api(null, 'POST', '/api/workstream/hold', { screen: s.hello.screen, on: true }, { Cookie: cookie });
    assert.equal(held.status, 200);
    assert.equal(held.body.sentinel.on, true);
    assert.ok(Array.isArray(held.body.sentinel.where) && held.body.sentinel.where.some(r => r.from === 'workspace'), 'it says which folders and why');
    const stale = await H.api(null, 'POST', '/api/workstream/hold', { screen: 'gone', on: true }, { Cookie: cookie });
    assert.equal(stale.status, 404, 'a stream the hub forgot is said, so the page opens a new one');
  } finally { await s.close(); }
  assert.ok(await until(() => !sentinel.status().on));
});

test('workstream.roots: ".." is the folder DOCA is installed in unless that is too wide; a folder a person adds is watched first', async () => {
  const wide = roots.fromSetting({ workstream: { roots: ['..'] } });
  assert.equal(path.resolve(roots.install(), '..'), path.resolve(os.tmpdir()), 'the tests\' install is in the temporary folder');
  assert.deepEqual(wide, [], 'the default is left out where it is the temporary folder (or the home folder, or the root)');
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-roots-'));
  try {
    const listed = roots.fromSetting({ workstream: { roots: ['..', mine, '/'] } });
    assert.deepEqual(listed.map(r => r.path), [mine], 'a named folder is kept; the root itself never is');
    await H.api(null, 'POST', '/api/prefs', { workstream: { roots: ['..', mine] } });
    const all = roots.list();
    assert.ok(all.some(r => r.path === mine && r.from === 'setting'));
    assert.ok(all.findIndex(r => r.path === mine) < all.length && all.find(r => r.from === 'workspace'), 'with the workspace beside it');
  } finally { await H.api(null, 'POST', '/api/prefs', { workstream: null }); fs.rmSync(mine, { recursive: true, force: true }); }
});

test('an edit made outside DOCA is labelled so, with the process working there; one an agent made, with its conversation', { skip: process.platform !== 'linux' && 'the process table\'s working folders are read on Linux here' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-outside-'));
  fs.mkdirSync(path.join(dir, '.git'));   // a repository: the file's own, and where the process works
  // An agent's session outside DOCA, by its name — started by a shell that leaves, so it is not below this process (the hub).
  const fakePid = Number(require('node:child_process').execFileSync('bash', ['-c', '(exec -a claude sleep 30) > /dev/null 2>&1 & echo $!'], { cwd: dir, encoding: 'utf8' }).trim());
  const fake = { pid: fakePid, kill: () => { try { process.kill(fakePid); } catch { /* gone */ } } };
  await until(() => { try { return fs.readFileSync(`/proc/${fakePid}/cmdline`, 'utf8').startsWith('claude'); } catch { return false; } });   // exec'd as itself
  try {
    await H.api(null, 'POST', '/api/prefs', { workstream: { roots: [dir] } });
    const s = await stream(H.owner.cookie);
    await H.api(null, 'POST', '/api/workstream/hold', { screen: s.hello.screen, on: true });
    assert.ok(sentinel.status().roots.includes(dir));
    const file = path.join(dir, 'notes.md');
    fs.writeFileSync(file, 'one\n');
    assert.ok(await until(() => s.got.some(c => c.what === 'file' && c.path === file)), 'heard');
    const by = s.got.find(c => c.what === 'file' && c.path === file).by;
    assert.equal(by.by, 'outside');
    assert.match(by.text, /^outside .+ · claude \(pid \d+\) works here$/);
    assert.equal(by.process.pid, fake.pid);
    // The same folder written by an agent's tool: its conversation.
    const sess = require('../modules/harness/memory').createSession('Notes', { activate: false });
    const other = path.join(dir, 'agent.md');
    ws.onEvent({ sessionId: sess.id, type: 'tool_call', name: 'write_file', args: { path: other, content: 'x' } });
    fs.writeFileSync(other, 'by the agent\n');
    assert.ok(await until(() => s.got.some(c => c.what === 'file' && c.path === other)));
    const mine = s.got.find(c => c.what === 'file' && c.path === other).by;
    assert.equal(mine.by, 'doca'); assert.match(mine.text, / agent · Notes$/);
    // The session outside is a line of its own, by where it works.
    assert.ok(await until(() => s.got.some(c => c.what === 'activity' && c.kind === 'outside' && /Claude Code session/.test(c.text) && c.who === path.basename(dir)), 25000),
      'the agent\'s session outside is said, under its repository');
    await s.close();
  } finally {
    fake.kill();
    await H.api(null, 'POST', '/api/prefs', { workstream: null });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('notable processes: agents\' sessions, builds and tests, emulators, headless browsers — not a VM, not a browser\'s own helpers', () => {
  const { kindOf } = require('../modules/workstream/notable');
  const k = (name, args) => kindOf({ name, args })?.kind || null;
  assert.equal(k('claude', ['claude', '--resume']), 'agent');
  assert.equal(k('node', ['node', '/usr/local/bin/gemini']), 'agent');
  assert.equal(k('npm', ['npm', 'test']), 'build');
  assert.equal(k('node', ['node', '--test', 'test/a.test.js']), 'build');
  assert.equal(k('java', ['java', '-cp', 'gradle-wrapper.jar', 'org.gradle.wrapper.GradleWrapperMain', 'assembleDebug']), 'build');
  assert.equal(k('docker', ['docker', 'build', '-t', 'x', '.']), 'build');
  assert.equal(k('qemu-system-x86', ['/sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64', '-avd', 'medium_phone']), 'emulator');
  assert.equal(k('qemu-system-x86', ['qemu-system-x86_64', '-name', 'win11']), null, 'a VM is Machines → VMs\' own');
  assert.equal(k('chrome', ['chrome', '--headless=new', '--remote-debugging-port=0']), 'browser');
  assert.equal(k('chrome', ['chrome', '--type=renderer', '--headless=new']), null);
  assert.equal(k('bash', ['bash']), null);
});

test('an Android emulator is a Live tile through adb; a real phone only when the owner allows it', async () => {
  const emu = require('../modules/machines/emulators'), cmd = require('../modules/machines/cmd-shots');
  const real = { adb: emu.adb, run: emu.run, exec: cmd.exec };
  const png = require('../modules/machines/png').encode({ width: 4, height: 8, rgb: Buffer.alloc(4 * 8 * 3, 200) });
  const calls = [];
  emu.adb = () => '/sdk/platform-tools/adb';
  emu.run = async (_bin, args) => { calls.push(args.join(' ')); return args[0] === 'devices'
    ? 'List of devices attached\nemulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:3\nR58N12ABC    device usb:1-1 product:x model:SM_S918B device:dm3q transport_id:4\n\n'
    : 'medium_phone\nOK\n'; };
  cmd.exec = async (bin, args) => { calls.push(`${bin} ${args.join(' ')}`); return Buffer.concat([Buffer.from('noise\n'), png]); };
  emu._reset();
  try {
    let d = (await H.api(null, 'GET', '/api/machines?shots=1')).body;
    assert.deepEqual(d.emulators.map(e => [e.serial, e.name]), [['emulator-5554', 'medium_phone']], 'only the emulator: a phone is a person\'s');
    assert.equal(d.emulators[0].origin.outside, true, 'started outside DOCA');
    await cmd.round();
    assert.ok(calls.includes('/sdk/platform-tools/adb -s emulator-5554 exec-out screencap -p'));
    const shot = await fetch(`${H.base}/api/machines/shots/${encodeURIComponent(d.emulators[0].key)}`, { headers: { Cookie: H.owner.cookie } });
    assert.equal(shot.status, 200); assert.equal(shot.headers.get('content-type'), 'image/png');
    const rows = (await require('../modules/machines/rows').rows({ fresh: true })).rows.filter(r => r.kind === 'emulator');
    assert.deepEqual(rows.map(r => [r.id, r.live]), [['emulator-5554', true]], 'and a row in the status column');
    await H.api(null, 'POST', '/api/prefs', { machines: { adbDevices: true } });
    emu._reset();
    d = (await H.api(null, 'GET', '/api/machines')).body;
    assert.deepEqual(d.emulators.map(e => e.serial).sort(), ['R58N12ABC', 'emulator-5554'], 'the owner allowed devices');
  } finally {
    Object.assign(emu, { adb: real.adb, run: real.run }); cmd.exec = real.exec; cmd.stop(); emu._reset();
    await H.api(null, 'POST', '/api/prefs', { machines: null });
  }
});

test('a computer container no record names is a computer tile and row that says so, pictured from inside it', async () => {
  const strays = require('../modules/computers/strays'), sc = require('../modules/machines/stray-computers'), cmd = require('../modules/machines/cmd-shots');
  const real = { docker: strays.docker, exec: cmd.exec };
  strays.docker = async args => (args[0] === 'ps' ? 'doca-computer-f5b60600\trunning\t2026-10-09 22:29:58 +0200 CEST\t52d356019c3e\tUp 3 hours\ndoca-computer-0ld\texited\t2026-10-01 10:00:00 +0200 CEST\t\tExited (0)\n' : '');
  const png = require('../modules/machines/png').encode({ width: 4, height: 4, rgb: Buffer.alloc(48, 90) });
  const calls = [];
  cmd.exec = async (bin, args) => { calls.push(args.slice(0, 2).join(' ')); return png; };
  sc._reset();
  try {
    const d = (await H.api(null, 'GET', '/api/machines?shots=1')).body;
    const c = d.computers.find(x => x.id === 'doca-computer-f5b60600');
    assert.ok(c, 'the running one is a computer tile');
    assert.equal(c.stray, true); assert.match(c.detail, /^not .+'s record · made by another .+ install$/);
    assert.equal(c.origin.outside, true);
    assert.ok(!d.computers.some(x => x.id === 'doca-computer-0ld'), 'a stopped one is not pictured');
    await cmd.round();
    assert.ok(calls.includes('exec doca-computer-f5b60600'), 'its own screen, from inside it');
    require('../modules/machines/rows')._reset();
    const row = (await require('../modules/machines/rows').rows({ fresh: true })).rows.find(r => r.id === 'doca-computer-f5b60600');
    assert.deepEqual([row.kind, row.stray, row.live], ['computer', true, true]);
  } finally { strays.docker = real.docker; cmd.exec = real.exec; cmd.stop(); sc._reset(); }
});
