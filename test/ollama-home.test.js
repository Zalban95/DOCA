'use strict';

/** Telling Ollama where its models live (modules/ollama-home.js; the owner, 2026-10-11). Command lines only: nothing runs. */
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const oh = require('../modules/ollama-home');

test('a folder must be a plain full path', () => {
  assert.throws(() => oh.checkDir('models'), /full path/);
  assert.throws(() => oh.checkDir('/data/x"; rm -rf /'), /quotes/);
  if (process.platform !== 'win32') assert.throws(() => oh.checkDir('/data/$(id)'), /\$/);
  assert.equal(oh.checkDir('/data/ollama/'), '/data/ollama');
});

test('on a systemd host Ollama gets a drop-in, its models copied first, its user owning the folder, a restart', () => {
  const cmd = oh.commandFor('systemd', '/data/ollama', '/usr/share/ollama/.ollama/models', { user: 'ollama' });
  assert.match(cmd, /sudo rsync -a '\/usr\/share\/ollama\/\.ollama\/models\/' '\/data\/ollama\/'/);
  assert.match(cmd, /sudo chown -R ollama:ollama '\/data\/ollama'/);
  assert.match(cmd, /Environment="OLLAMA_MODELS=\/data\/ollama"/);
  assert.match(cmd, new RegExp(`sudo tee ${oh.DROP_IN.replace(/[./]/g, '\\$&')}`));
  assert.match(cmd, /sudo systemctl restart ollama$/);
  assert.doesNotMatch(oh.commandFor('systemd', '/data/ollama', '/data/ollama'), /rsync/, 'the same folder: nothing to copy');
});

test('a Mac and Windows are told their own way; a hand-started Ollama is not', () => {
  assert.match(oh.commandFor('macos', '/Volumes/Big/ollama', '/Users/a/.ollama/models'), /launchctl setenv OLLAMA_MODELS '\/Volumes\/Big\/ollama'/);
  assert.match(oh.commandFor('windows', 'D:\\Ollama', 'C:\\Users\\a\\.ollama\\models'), /SetEnvironmentVariable\('OLLAMA_MODELS', 'D:\\Ollama', 'User'\)/);
  assert.equal(oh.commandFor('manual', '/x', '/y'), null);
  assert.equal(oh.how({ platform: 'darwin' }), 'macos');
  assert.equal(oh.how({ platform: 'linux', systemd: () => false }), 'manual');
});
