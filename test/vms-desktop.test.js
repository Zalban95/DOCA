'use strict';

// Hyper-V, UTM and Parallels beside libvirt and VirtualBox (modules/vms-desktop.js, TODO H1.7). The samples are
// written in each tool's documented output shape — none of the three runs on the machines this is built on.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHyperV, parseUtm, parseParallels } = require('../modules/vms-desktop');
const { normalizeState } = require('../modules/vms');

test('Get-VM\'s JSON, one VM or many, states by name or number', () => {
  const one = parseHyperV('{"Name":"Win11 Dev","State":"Running","Id":{"Guid":"1b4e28ba-2fa1-11d2-883f-0016d3cca427"}}');
  assert.deepEqual(one, [{ name: 'Win11 Dev', id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', hypervisor: 'hyperv', stateRaw: 'Running', display: null }]);
  const many = parseHyperV('[{"Name":"a","State":3,"Id":"x"},{"Name":"b","State":9,"Id":"y"}]');
  assert.deepEqual(many.map(v => normalizeState(v.stateRaw)), ['stopped', 'paused']);
  assert.deepEqual(parseHyperV(''), []);
});

test('utmctl list, a name with spaces included', () => {
  const out = 'UUID                                 Status   Name\n'
    + 'B6D84E6E-4D4A-4C8B-9E1A-5A0B6C2D1E3F started  Ubuntu Server\n'
    + '0C2C2D7A-11E3-4B65-8F43-8A5B1B9E4C21 stopped  macOS Sonoma\n';
  assert.deepEqual(parseUtm(out).map(v => [v.name, normalizeState(v.stateRaw)]), [['Ubuntu Server', 'running'], ['macOS Sonoma', 'stopped']]);
});

test('prlctl list --all --json', () => {
  const out = '[{"uuid":"{a1}","status":"running","ip_configured":"-","name":"Windows 11"},{"uuid":"{b2}","status":"stopped","name":"Kali"}]';
  assert.deepEqual(parseParallels(out).map(v => [v.name, normalizeState(v.stateRaw)]), [['Windows 11', 'running'], ['Kali', 'stopped']]);
});

test('a hypervisor that cannot exist on this OS is not listed as missing', async () => {
  const listed = await new Promise(resolve => require('../modules/vms').handleList({}, { json: o => resolve(o.hypervisors.map(h => h.id)) }));
  if (process.platform !== 'win32') assert.ok(!listed.includes('hyperv'));
  if (process.platform !== 'darwin') assert.ok(!listed.includes('utm') && !listed.includes('parallels'));
  assert.ok(listed.includes('libvirt') && listed.includes('virtualbox'));
});
