'use strict';
/**
 * DOCA's Task Scheduler entry (bin/lib/windows-task.js), as run on a real Windows 11 desk (H1.9): creatable without
 * elevation, never stopped by a time limit, no window, and known by the launcher it starts. The XML and the reading of
 * an entry are pure, so they are held on every OS; CI's Windows runner creates nothing.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const W = require('../bin/lib/windows-task');

const entry = { node: 'C:\\Program Files\\nodejs\\node.exe', script: 'D:\\doca\\bin\\doca-launch.js', dir: 'D:\\doca', log: 'D:\\doca\\restart.log', user: 'PORTAL\\ann' };

test('the entry: at this account\'s sign-in, not elevated, no time limit, no window, output to a log', () => {
  const x = W.taskXml(entry);
  // A trigger for one account is that person's own to create; "any user" (schtasks /SC ONLOGON) needs an administrator.
  assert.match(x, /<LogonTrigger><Enabled>true<\/Enabled><UserId>PORTAL\\ann<\/UserId><\/LogonTrigger>/);
  assert.match(x, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(x, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/, 'Task Scheduler\'s default of 72 hours stopped DOCA after three days');
  assert.match(x, /<Command>conhost\.exe<\/Command><Arguments>--headless &quot;C:\\Program Files\\nodejs\\node\.exe&quot; &quot;D:\\doca\\bin\\doca-launch\.js&quot; start --log &quot;D:\\doca\\restart\.log&quot;<\/Arguments>/);
  assert.match(x, /<WorkingDirectory>D:\\doca<\/WorkingDirectory>/);
  assert.match(W.taskXml({ ...entry, dir: 'D:\\a&b<c' }), /D:\\a&amp;b&lt;c/, 'a folder name is escaped');
});

test('an entry is known by the launcher it starts', () => {
  assert.equal(W.TASK, require('../bin/doca-launch').TASK, 'one name, in the launcher and the entry');
  assert.equal(W.launcherOf(W.taskXml(entry)), entry.script, 'its own XML, as schtasks /Query /XML gives it back');
  assert.equal(W.launcherOf('<Arguments>"C:\\node.exe" "E:\\other\\bin\\doca-launch.js" start</Arguments>'), 'E:\\other\\bin\\doca-launch.js', 'an entry the old schtasks /TR made');
  assert.equal(W.launcherOf('<Arguments>something else</Arguments>'), null);
  const q = xml => () => ({ ok: true, out: xml });
  assert.deepEqual(W.owner(entry.script, () => ({ ok: false, out: 'ERROR: The system cannot find the file specified.' })), { exists: false, ours: false, elsewhere: null });
  assert.deepEqual(W.owner(entry.script, q(W.taskXml(entry))), { exists: true, ours: true, elsewhere: null });
  assert.deepEqual(W.owner('d:\\DOCA\\bin\\doca-launch.js', q(W.taskXml(entry))).ours, true, 'Windows paths compare without case');
  assert.deepEqual(W.owner(entry.script, q(W.taskXml({ ...entry, script: 'E:\\trial\\bin\\doca-launch.js' }))), { exists: true, ours: false, elsewhere: 'E:\\trial' });
});
