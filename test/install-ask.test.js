'use strict';

/**
 * An install says what it downloads and asks first (deep test B, R5: one click cloned OpenClaw into the home folder,
 * and nothing said how big the Android SDK or a service's image is).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
require('./helpers');
const frontend = require('./frontend');

function load() {
  const asked = [];
  const sandbox = { appConfirm: (message, ok) => asked.push({ message, ok }) };
  vm.createContext(sandbox);
  vm.runInContext(frontend.source('lib/install-ask.js'), sandbox);
  return { ...sandbox, asked, INSTALL_SIZES: vm.runInContext('INSTALL_SIZES', sandbox) };
}

test('an install names its size and runs only on yes', () => {
  const { installAsk, asked } = load();
  let ran = 0;
  installAsk('tool', 'android-sdk', 'Android SDK', () => { ran++; }, { note: 'The command-line tools.' });
  assert.equal(ran, 0, 'nothing starts before the answer');
  assert.match(asked[0].message, /^Install Android SDK\?\n\nIt downloads about 1 GB\.\n\nThe command-line tools\.$/);
  asked[0].ok();
  assert.equal(ran, 1);
  installAsk('harness', 'openclaw', 'OpenClaw', () => {});
  assert.match(asked[1].message, /home folder/);
  installAsk('tool', 'something-new', 'Something', () => {});
  assert.match(asked[2].message, /size is not known here/);
});

test('every installable system tool and service has a size said', () => {
  const { INSTALL_SIZES } = load();
  const services = require('../modules/services');
  const ids = services.INFERENCE_SERVICES.map(s => s.id);
  assert.ok(ids.length);
  for (const id of ids) assert.ok(INSTALL_SIZES[`service:${id}`], `service ${id} has no size`);
  const tools = require('../modules/system-tools-catalog');
  const rows = tools.SYSTEM_TOOLS;
  for (const t of rows.filter(t => t.install && t.update !== false)) assert.ok(INSTALL_SIZES[`tool:${t.id}`], `tool ${t.id} has no size`);
});
