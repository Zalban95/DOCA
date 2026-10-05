'use strict';

// Settings → System → System tools (modules/system-tools-catalog.js): each row found the same way on every OS and
// installed with this OS's own command — apt/dnf/pacman, Homebrew, winget — or only linked where there is none.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { SYSTEM_TOOLS, installFor, versionOf } = require('../modules/system-tools-catalog');

before(() => H.start());
after(() => H.stop());

test('every row says what it is for, how it is found, and a link; ids are unique', () => {
  assert.equal(new Set(SYSTEM_TOOLS.map(t => t.id)).size, SYSTEM_TOOLS.length);
  for (const t of SYSTEM_TOOLS) {
    assert.ok(['required', 'recommended', 'optional', 'clients'].includes(t.category), t.id);
    assert.ok(t.note && t.for && t.repo && t.detect, t.id);
  }
  for (const id of ['android-sdk', 'dotnet', 'jdk']) assert.equal(SYSTEM_TOOLS.find(t => t.id === id).category, 'clients', `${id}: for the apps, never needed to run DOCA`);
  assert.equal(SYSTEM_TOOLS.find(t => t.id === 'openclaw').category, 'optional', 'OpenClaw is a peer, not a prerequisite');
});

test('each OS gets its own command: no apt on a Mac, no bash on Windows', () => {
  for (const t of SYSTEM_TOOLS) {
    const mac = installFor(t, 'darwin'), win = installFor(t, 'win32'), linux = installFor(t, 'linux');
    if (mac) assert.ok(!/apt-get|dnf |pacman /.test(mac), `${t.id} on macOS`);
    if (win) assert.ok(!/\bsudo\b|apt-get|\|\s*bash|2>\/dev\/null/.test(win), `${t.id} on Windows`);
    if (linux) assert.ok(!/winget|brew install/.test(linux), `${t.id} on Linux`);
  }
  assert.match(installFor(SYSTEM_TOOLS.find(t => t.id === 'git'), 'linux'), /apt-get.*elif command -v dnf.*elif command -v pacman/, 'whichever package manager the machine has');
  assert.match(installFor(SYSTEM_TOOLS.find(t => t.id === 'dotnet'), 'win32'), /winget install --id Microsoft\.DotNet\.SDK\.9/);
  assert.match(installFor(SYSTEM_TOOLS.find(t => t.id === 'android-sdk'), 'linux'), /sdkmanager.*platforms;android-35/);
  assert.equal(installFor(SYSTEM_TOOLS.find(t => t.id === 'node'), 'linux'), null, 'the runtime the panel runs on is not replaced from inside it');
});

test('a version number, not a tool\'s whole first line', () => {
  assert.equal(versionOf({}, 'Docker Compose version v5.1.4'), '5.1.4');
  assert.equal(versionOf({}, 'ffmpeg version 8.0.1-3ubuntu2 Copyright (c) 2000-2025 the FFmpeg developers'), '8.0.1-3ubuntu2');
  assert.equal(versionOf({}, 'pip 25.1.1 from /usr/lib/python3/dist-packages/pip (python 3.14)'), '25.1.1');
  assert.equal(versionOf({}, 'rev 2fc0177 (6 months ago)'), 'rev 2fc0177 (6 months ago)', 'no number: the line');
  assert.equal(versionOf(SYSTEM_TOOLS.find(t => t.id === 'llama-server'), 'version: 9174 (59778f019)'), '9174');
});

test('the list as the panel reads it: this OS\'s command, a sudo password only where sudo is used', async () => {
  const r = await H.api(null, 'GET', '/api/system/tools');
  assert.equal(r.status, 200);
  assert.equal(r.body.platform, process.platform);
  const node = r.body.tools.find(t => t.id === 'node');
  assert.equal(node.detected, true);
  assert.equal(node.canUpdate, false);
  for (const t of r.body.tools) {
    if (process.platform === 'win32') assert.equal(t.needsSudo, false, t.id);
    if (t.installCmd) assert.equal(t.installCmd, installFor(SYSTEM_TOOLS.find(x => x.id === t.id)));
  }
  assert.equal((await H.api(null, 'POST', '/api/system/tools/install', { id: 'node' })).status, 400);
});
