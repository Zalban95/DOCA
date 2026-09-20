'use strict';

/**
 * Virtual machines.
 *
 * Parsers use captured real output. The route must report both hypervisors
 * whether this machine has their CLIs and VMs installed or not.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const vms = require('../modules/vms');

before(H.start);
after(H.stop);

test('virsh list output becomes machines, ids and normalised states', () => {
  // Real `virsh list --all` output, trailing spaces and all.
  const out = [
    ' Id   Name        State',
    '-----------------------------',
    ' 1    win11       running',
    ' 3    builder     paused',
    ' -    ubuntu-24   shut off',
    '',
  ].join('\n');

  assert.deepEqual(vms.parseVirshList(out), [
    { id: '1',  name: 'win11',     state: 'running', stateRaw: 'running' },
    { id: '3',  name: 'builder',   state: 'paused',  stateRaw: 'paused' },
    { id: null, name: 'ubuntu-24', state: 'stopped', stateRaw: 'shut off' },
  ]);
});

test('a libvirt host with nothing defined is empty, not a parse error', () => {
  assert.deepEqual(vms.parseVirshList(' Id   Name   State\n--------------------\n\n'), []);
});

test('VBoxManage list output becomes machines with their uuids', () => {
  const out = '"Windows 11" {f6e3a1bc-1111-4b0e-9c22-1d2f3a4b5c6d}\n"kali linux" {0a1b2c3d-2222-4c1f-8d33-4e5f6a7b8c9d}\n';
  assert.deepEqual(vms.parseVboxList(out), [
    { name: 'Windows 11', id: 'f6e3a1bc-1111-4b0e-9c22-1d2f3a4b5c6d' },
    { name: 'kali linux', id: '0a1b2c3d-2222-4c1f-8d33-4e5f6a7b8c9d' },
  ]);
});

test('VirtualBox remote display is reported as RDP, because that is what VRDE is', () => {
  const info = ['VMState="running"', 'vrde="on"', 'vrdeport="3389"', 'vrdeaddress="0.0.0.0"'].join('\n');
  assert.deepEqual(vms.parseVboxDisplay(info), {
    uri: 'rdp://0.0.0.0:3389', protocol: 'rdp', host: '0.0.0.0', port: 3389,
  });

  // Switched off, or listening on nothing, means there is no address to show.
  assert.equal(vms.parseVboxDisplay('vrde="off"\nvrdeport="3389"'), null);
  assert.equal(vms.parseVboxDisplay('vrde="on"\nvrdeport="0"'), null);
});

test('the state words each hypervisor uses collapse to the three the UI draws', () => {
  for (const running of ['running', 'RUNNING', 'up']) assert.equal(vms.normalizeState(running), 'running');
  for (const stopped of ['shut off', 'poweroff', 'PowerOff'])  assert.equal(vms.normalizeState(stopped), 'stopped');
  for (const paused  of ['paused', 'suspended'])   assert.equal(vms.normalizeState(paused),  'paused');
  assert.equal(vms.normalizeState(''), 'unknown');
});

test('the panel reports both hypervisors, including any that are missing', async () => {
  const { status, body } = await H.api(null, 'GET', '/api/vms');
  assert.equal(status, 200);

  const ids = body.hypervisors.map(h => h.id);
  assert.deepEqual(ids, ['libvirt', 'virtualbox']);

  for (const hv of body.hypervisors) {
    assert.ok(Array.isArray(hv.vms));
    if (!hv.available) {
      assert.deepEqual(hv.vms, [], 'nothing to list without the CLI');
      assert.match(hv.error, /not found/, 'says why, rather than an empty panel');
    }
    // Each is reported on its own so one missing CLI cannot hide the other.
    assert.ok(hv.label && hv.bin);
  }
});

test('actions are refused unless the hypervisor, the action and the machine all exist', async () => {
  const bad = await H.api(null, 'POST', '/api/vms/nope/action', { name: 'x', action: 'start' });
  assert.equal(bad.status, 404);

  const badAction = await H.api(null, 'POST', '/api/vms/libvirt/action', { name: 'x', action: 'rm -rf' });
  assert.equal(badAction.status, 400);
  assert.match(badAction.body.error, /Unknown action/);

  const noName = await H.api(null, 'POST', '/api/vms/libvirt/action', { action: 'start' });
  assert.equal(noName.status, 400);

  // A name is checked against the machines that exist before it reaches argv,
  // so `--all` is a missing VM rather than a flag. Without virsh installed the
  // lookup fails outright, which is a 404 or a 500 — never a 200.
  const flag = await H.api(null, 'POST', '/api/vms/libvirt/action', { name: '--all', action: 'start' });
  assert.notEqual(flag.status, 200);
});

test('the libvirt connection URI is settable, since qemu:///session hides system VMs', async () => {
  const saved = await H.api(null, 'POST', '/api/vms/settings', { libvirtUri: 'qemu:///system' });
  assert.equal(saved.status, 200);
  assert.equal((await H.api(null, 'GET', '/api/vms')).body.libvirtUri, 'qemu:///system');

  assert.equal((await H.api(null, 'POST', '/api/vms/settings', {})).status, 400);

  // Clearing it goes back to whatever virsh itself defaults to.
  await H.api(null, 'POST', '/api/vms/settings', { libvirtUri: '' });
  assert.equal((await H.api(null, 'GET', '/api/vms')).body.libvirtUri, '');
});
