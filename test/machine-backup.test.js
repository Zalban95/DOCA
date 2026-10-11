'use strict';

/**
 * This machine's files, backed up (modules/machine-backup) — the parts that need no restic: the folders suggested per
 * OS (a Mac and a Windows box described from here), where a copy from one OS lands on another, the schedule's catch-up,
 * the argv restic is given (no shell, the password never on it), and the destination's "is the disk mounted" check.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const H = require('./helpers');   // first: it points the settings at a temporary folder
const folders = require('../modules/machine-backup/folders');
const schedule = require('../modules/machine-backup/schedule');
const restic = require('../modules/machine-backup/restic');
const runner = require('../modules/machine-backup/runner');
const restore = require('../modules/machine-backup/restore');
const destination = require('../modules/machine-backup/destination');

const machine = (platform, home, have, extra = {}) => ({
  platform, home, dataDir: null, workspace: null, env: extra.env || {},
  exists: p => have.includes(p), list: dir => (dir === home ? extra.dirs || [] : []), read: p => (extra.files || {})[p] || '',
});

test('Linux: the known folders, projects found by name, settings files; ticked where they exist; XDG names followed', () => {
  const home = '/home/ann';
  const s = folders.suggestions(machine('linux', home, [`${home}/Documenti`, `${home}/Pictures`, `${home}/code`, `${home}/.ssh`, `${home}/.bashrc`, `${home}/.config`],
    { dirs: ['code', 'Pictures', 'notes'], files: { [`${home}/.config/user-dirs.dirs`]: 'XDG_DOCUMENTS_DIR="$HOME/Documenti"\n' } }));
  const by = Object.fromEntries(s.map(x => [x.path, x]));
  assert.equal(by[`${home}/Documenti`].role, 'documents', 'a Documents folder in the person\'s language is still documents');
  assert.equal(by[`${home}/Documenti`].on, true);
  assert.equal(by[`${home}/Videos`].on, false, 'suggested, not ticked, where it does not exist');
  assert.equal(by[`${home}/code`].role, 'projects');
  assert.ok(!by[`${home}/notes`], 'a folder whose name does not say projects is not guessed');
  assert.equal(by[`${home}/.ssh`].role, 'ssh');
  assert.equal(by[`${home}/.config`].on, true);
  assert.ok(!s.some(x => /Downloads/.test(x.path)), 'Downloads is never suggested');
});

test('macOS: Movies is the videos folder; Windows: Known Folders and %APPDATA% picks, backslashes', () => {
  const mac = folders.suggestions(machine('darwin', '/Users/ann', ['/Users/ann/Movies']));
  assert.equal(mac.find(x => x.role === 'videos').path, '/Users/ann/Movies');
  assert.equal(mac.find(x => x.role === 'videos').on, true);
  const home = 'C:\\Users\\ann', appdata = 'C:\\Users\\ann\\AppData\\Roaming';
  const win = folders.suggestions(machine('win32', home, [`${home}\\Documents`, `${appdata}\\Code\\User`], { env: { APPDATA: appdata } }));
  assert.equal(win.find(x => x.role === 'documents').path, 'C:\\Users\\ann\\Documents');
  assert.equal(win.find(x => x.path === `${appdata}\\Code\\User`).on, true);
  assert.ok(!win.some(x => x.role === 'config'), 'no ~/.config on Windows');
});

test('a copy lands in the same role on another OS; a folder outside that home has no place', () => {
  const from = { home: '/home/ann', platform: 'linux' };
  assert.equal(folders.mapHome('/home/ann/Documents/tax', from, { home: 'C:\\Users\\ann', platform: 'win32' }), 'C:\\Users\\ann\\Documents\\tax');
  assert.equal(folders.mapHome('/home/ann/Videos', from, { home: '/Users/ann', platform: 'darwin' }), '/Users/ann/Movies');
  assert.equal(folders.mapHome('/C/Users/Ann/Movies', { home: 'C:\\Users\\ann', platform: 'win32' }, { home: '/home/ann', platform: 'linux' }), '/home/ann/Movies',
    'restic\'s /C/… path matches a C:\\ home, ignoring case on Windows; Movies is only a role on a Mac');
  assert.equal(folders.mapHome('/srv/data', from, { home: '/home/bob', platform: 'linux' }), null);
  assert.equal(folders.toLocal('/C/Users/ann/Documents', 'win32'), 'C:\\Users\\ann\\Documents');
  assert.equal(folders.toLocal('/home/ann', 'linux'), '/home/ann');
});

test('the schedule: daily at its time, caught up when the destination comes back, once a day, an hour between failed tries', () => {
  const at = '03:00';
  const day = h => new Date(2026, 9, 11, h, 0, 0).getTime();
  const base = { enabled: true, at, catchUp: true, enabledAt: new Date(day(0) - 86400e3).toISOString(), reachable: true };
  assert.equal(schedule.due({ ...base, now: day(2), lastOkAt: new Date(day(3) - 86400e3 + 60e3).toISOString() }).run, false, 'before its time, with yesterday\'s done');
  assert.match(schedule.due({ ...base, now: day(2) }).why, /catching up/, 'yesterday\'s never ran: caught up now');
  assert.equal(schedule.due({ ...base, now: day(3) + 60e3 }).why, 'its time came');
  assert.match(schedule.due({ ...base, now: day(14), reachable: false }).why, /waiting for the destination/);
  const back = schedule.due({ ...base, now: day(15) });
  assert.equal(back.run, true);
  assert.match(back.why, /catching up/);
  assert.equal(schedule.due({ ...base, now: day(15), lastOkAt: new Date(day(14)).toISOString() }).run, false, 'once a day');
  assert.equal(schedule.due({ ...base, now: day(15), lastTriedAt: new Date(day(14) + 40 * 60e3).toISOString() }).run, false, 'a failed try waits an hour');
  assert.equal(schedule.due({ ...base, now: day(15), lastTriedAt: new Date(day(13)).toISOString() }).run, true);
  assert.equal(schedule.due({ ...base, now: day(15), catchUp: false }).run, false, 'catching up off: a missed day waits for tomorrow');
  assert.equal(schedule.due({ ...base, now: day(15), enabledAt: new Date(day(10)).toISOString() }).run, false, 'switched on after today\'s time');
  assert.equal(schedule.due({ ...base, now: day(15), draining: true }).run, false, 'never while DOCA waits to restart');
  assert.equal(schedule.due({ ...base, now: day(15), enabled: false }).run, false);
});

test('argv only: the backup, keeping and restoring are argument lists; the password is never on them nor a value in the environment', () => {
  const args = runner.backupArgs({ paths: ['/home/ann/Documents', '-weird'], exclude: ['node_modules', '*.gguf'], home: '/home/ann', platform: 'linux', host: 'desk', skip: ['/media/ann/disk/repo'] });
  assert.deepEqual(args.slice(0, 2), ['backup', '--json']);
  assert.ok(args.includes('doca-home=/home/ann') && args.includes('doca-os=linux'));
  assert.equal(args[args.indexOf('--') + 2], '-weird', 'a path that starts with a dash comes after --, so it is never read as a flag');
  assert.ok(args.includes('/media/ann/disk/repo'), 'the destination is never backed up into itself');
  assert.deepEqual(runner.forgetArgs({ keepDaily: 7, keepWeekly: 4, host: 'desk' }).slice(-5), ['--keep-daily', 7, '--keep-weekly', 4, '--prune']);
  assert.deepEqual(restore.restoreArgs('abcd1234', '/home/ann/Documents/tax.pdf', '/home/ann/Documents/Restored'),
    ['restore', '--json', 'abcd1234:/home/ann/Documents', '--target', '/home/ann/Documents/Restored', '--include', '/tax.pdf', '--overwrite', 'never']);

  const secret = 'correct-horse-battery';
  const s = restic.spec(['snapshots', '--json'], { repo: '/r', passwordFile: '/tmp/x/pw', base: { PATH: '/bin', RESTIC_PASSWORD: secret, RESTIC_PASSWORD_COMMAND: 'echo hi' } });
  assert.ok(!s.args.some(a => a.includes(secret)));
  assert.ok(!Object.values(s.env).some(v => String(v).includes(secret)), 'an inherited RESTIC_PASSWORD never reaches restic');
  assert.equal(s.env.RESTIC_PASSWORD_FILE, '/tmp/x/pw');
  assert.equal(s.env.RESTIC_PASSWORD_COMMAND, undefined);
  assert.deepEqual(restic.backendEnv('s3:s3.example.com/b', { id: 'AK', secret: 'SK' }), { AWS_ACCESS_KEY_ID: 'AK', AWS_SECRET_ACCESS_KEY: 'SK' });
  assert.deepEqual(restic.backendEnv('/media/disk', { id: 'AK', secret: 'SK' }), {}, 'a folder gets no keys');
});

test('the password file: private, holding the password, gone afterwards — even when the command fails', async () => {
  const fs = require('fs');
  let seen = null;
  await assert.rejects(restic.withPasswordFile('s3cret-pass', async file => {
    seen = file;
    assert.equal(fs.readFileSync(file, 'utf8'), 's3cret-pass');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    throw new Error('restic failed');
  }), /restic failed/);
  assert.equal(fs.existsSync(seen), false);
  assert.equal(fs.existsSync(path.dirname(seen)), false);
});

test('an empty mount point is a disk that is not mounted; a missing drive letter likewise; a real folder is reachable', () => {
  const st = map => p => (p in map ? { dev: map[p], isDirectory: () => true } : null);
  const empty = destination.check('/media/ann/Backup/doca', { platform: 'linux', stat: st({ '/media/ann': 1, '/media/ann/Backup': 1, '/media/ann/Backup/doca': 1 }), statfs: () => null });
  assert.equal(empty.reachable, false);
  assert.match(empty.note, /empty mount point/);
  const mounted = destination.check('/media/ann/Backup/doca', { platform: 'linux', stat: st({ '/media/ann': 1, '/media/ann/Backup': 2 }), statfs: () => ({ bavail: 10, bsize: 4096 }) });
  assert.equal(mounted.reachable, true);
  assert.equal(mounted.freeBytes, 40960);
  assert.equal(mounted.initialized, false);
  assert.match(destination.check('E:\\Backup', { platform: 'win32', stat: st({}) }).note, /not connected/);
  assert.equal(destination.check('sftp:me@nas:/backup').kind, 'remote');
  assert.equal(destination.check('').set, false);
});

test('the routes are an admin\'s, and setting up, joining, a new password and restoring ask for the password', async () => {
  await H.start();
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/machine-backup', undefined, { Cookie: member.cookie })).status, 403);
  const r = await H.api(null, 'POST', '/api/machine-backup/restore', { snapshot: 'latest', path: '/x' }, { 'X-Doca-Password': '' });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'password_required');
  for (const p of ['setup', 'connect', 'password']) assert.equal((await H.api(null, 'POST', `/api/machine-backup/${p}`, {}, { 'X-Doca-Password': '' })).status, 401, p);
  const s = await H.api(null, 'GET', '/api/machine-backup');
  assert.equal(s.status, 200);
  assert.equal(s.body.config.enabled, false, 'off by default');
  assert.equal(s.body.setUp, false);
  assert.equal('password' in s.body, false, 'never a secret, only whether there is one');
  const bad = await H.api(null, 'POST', '/api/machine-backup/settings', { enabled: true });
  assert.equal(bad.status, 400, 'switched on with nowhere to go is refused');
  await H.stop();
});

test('the agent\'s machine_backup only reads, is an admin\'s, and is not refused to missions', async () => {
  const tools = require('../modules/harness/tools');
  const t = tools.schemas().find(s => s.function.name === 'machine_backup');
  assert.deepEqual(t.function.parameters.properties.action.enum, ['status', 'history', 'find']);
  assert.ok(!require('../modules/agents/registry').NEVER.includes('machine_backup'));
  assert.equal(require('../modules/harness/approval').FREE.has('machine_backup'), false, 'not free: asked in Manual like other reads that are not');
  assert.equal(require('../modules/harness/kits').kitOf('machine_backup'), 'panel');
  const out = await tools.call('machine_backup', { action: 'status' }, [], { user: null, sessionId: null });
  assert.match(out, /not set up yet|restic is not installed/);
});
