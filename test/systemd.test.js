'use strict';

/**
 * In a container systemctl may be installed while systemd does not run, and every call wrote two lines of complaint
 * into doca.log on every Settings visit (deep test B, R8). Decided once, said once.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const systemd = require('../modules/systemd');

test('no systemd: said once, then never asked again', { skip: process.platform !== 'linux' && 'systemd is Linux' }, () => {
  systemd._reset();
  const lines = [];
  let asked = 0;
  const exists = () => { asked++; return false; };
  assert.equal(systemd.running({ exists, log: l => lines.push(l) }), false);
  assert.equal(systemd.running({ exists, log: l => lines.push(l) }), false);
  assert.equal(asked, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /not running on this machine/);
  systemd._reset();
  assert.equal(systemd.running({ exists: f => f === '/run/systemd/system', log: () => assert.fail('nothing to say') }), true);
  systemd._reset();
});
