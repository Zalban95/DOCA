'use strict';

/**
 * Live's "VMs" switch (modules/machines/vm-all.js, vm-facts.js; asked 2026-10-15): every VM on this host, running or
 * not, against a stand-in virsh — never this machine's real VMs. A running one whose picture fails is a lock with its
 * readings; a stopped one says what it is given, when it last ran, and that Start brings it up; a VNC screen that does
 * not answer is a lock tile; the route is the `machines-all` feature's and a host's. The other hypervisors' readings
 * (VirtualBox's showvminfo, Hyper-V's Get-VM) and QEMU's start time from /proc are read from samples.
 */
const H = require('./helpers');   // first: it points the settings at a temporary folder
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

test.after(() => H.stop());

test('domstats with --vcpu --block: what a VM is given, its ISO left out', () => {
  const m = require('../modules/machines/busy-read').parseDomstats("Domain: 'a'\n  balloon.current=4194304\n  balloon.maximum=8388608\n  vcpu.current=4\n  block.count=2\n"
    + '  block.0.path=/vm/a disk.qcow2\n  block.0.allocation=1073741824\n  block.0.capacity=21474836480\n  block.1.path=/iso/x.ISO\n  block.1.allocation=5\n  block.1.capacity=5\n');
  assert.deepEqual(m.get('a'), { cpuTime: null, rssKiB: 4194304, maxKiB: 8388608, vcpus: 4, disks: [{ used: 1073741824, size: 21474836480 }] });
});

test('VirtualBox and Hyper-V say what they give', () => {
  const { parseVboxFacts } = require('../modules/vms');
  const info = 'memory=4096\ncpus=2\nVMStateChangeTime="2026-10-15T08:00:00.000000000"\n';
  assert.deepEqual(parseVboxFacts(info, 'running'), { given: { vcpus: 2, maxKiB: 4194304 }, startedAt: Date.parse('2026-10-15T08:00:00.000Z') });
  assert.equal(parseVboxFacts(info, 'stopped').stoppedAt, Date.parse('2026-10-15T08:00:00.000Z'));
  const [hv] = require('../modules/vms-desktop').parseHyperV('{"Name":"w","State":"Running","Id":"x","CPUUsage":7,"MemoryAssigned":2147483648,"MemoryStartup":4294967296,"ProcessorCount":4,"Uptime":{"TotalSeconds":120}}');
  assert.deepEqual([hv.given, hv.live], [{ vcpus: 4, maxKiB: 4194304 }, { cpu: 7, memUsedKiB: 2097152 }]);
  assert.ok(Math.abs(Date.now() - 120000 - hv.startedAt) < 5000);
  const facts = require('../modules/machines/vm-facts');
  assert.match(facts.reads('utm'), /no CPU or memory reading/);
  assert.equal(facts.reads('libvirt'), null);
});

test('a QEMU process\'s start, from /proc', t => {
  if (process.platform !== 'linux') return t.skip('/proc is Linux\'s');
  const root = path.join(H.tmp, 'fake-proc');
  fs.mkdirSync(path.join(root, '4242'), { recursive: true });
  fs.mkdirSync(path.join(root, '77'), { recursive: true });
  fs.writeFileSync(path.join(root, 'stat'), 'cpu 1 2 3\nbtime 1760000000\n');
  fs.writeFileSync(path.join(root, '4242', 'cmdline'), '/usr/bin/qemu-system-x86_64\0-name\0guest=dev,,box,debug-threads=on\0-m\0' + '4096\0');
  fs.writeFileSync(path.join(root, '4242', 'stat'), `4242 (qemu-system-x86) S 1 ${'0 '.repeat(17)}50000 0 0`.replace(/ +/g, ' '));
  fs.writeFileSync(path.join(root, '77', 'cmdline'), 'bash\0');
  const starts = require('../modules/machines/vm-facts').qemuStarts(['dev,box', 'other'], root);
  assert.deepEqual([...starts], [['dev,box', 1760000000 * 1000 + 500 * 1000]]);
});

test('every VM in Live: a lock with readings, a stopped one with Start, a VNC screen that does not answer; a host\'s; the licence\'s', async t => {
  if (process.platform === 'win32') return t.skip('the stand-in virsh is a sh script');
  const bin = path.join(H.tmp, 'fake-virsh');
  fs.mkdirSync(bin, { recursive: true });
  const calls = path.join(bin, 'calls');
  fs.writeFileSync(calls, '');
  fs.writeFileSync(path.join(bin, 'virsh'), `#!/bin/sh
echo "$*" >> "${calls}"
case "$*" in
  --version) echo 10.0.0 ;;
  "list --all") printf ' Id   Name     State\\n------------------------\\n 1    devbox   running\\n -    oldbox   shut off\\n' ;;
  "domstats --balloon --vcpu --block") printf "Domain: 'devbox'\\n  balloon.current=4194304\\n  balloon.maximum=4194304\\n  vcpu.current=4\\n  block.0.path=/vm/devbox.qcow2\\n  block.0.allocation=1073741824\\n  block.0.capacity=21474836480\\nDomain: 'oldbox'\\n  balloon.maximum=2097152\\n  vcpu.current=2\\n" ;;
  domstats*) printf "Domain: 'devbox'\\n  cpu.time=5\\n  balloon.rss=1048576\\n" ;;
  dumpxml*) echo '<libosinfo:os id="http://ubuntu.com/ubuntu/24.04"/>' ;;
  screenshot*) echo "error: the display is locked" >&2; exit 1 ;;
  *) : ;;
esac
`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  t.after(() => { process.env.PATH = saved; require('../modules/machines/vm-shots').stop(); });
  await H.start();
  require('../modules/machines/vm-list')._reset();

  // A VNC screen nothing answers at.
  const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  assert.ok([200, 201].includes((await H.api(null, 'POST', '/api/machines/vnc', { name: 'Old desk', host: '127.0.0.1', port })).status));

  // Live asks for pictures (as the page does), and the hypervisor's screenshot fails.
  assert.equal((await H.api(null, 'GET', '/api/machines?shots=1')).status, 200);
  await require('../modules/machines/vm-shots').round();
  // Someone stops oldbox from the panel: the line says who and when it last ran.
  assert.equal((await H.api(null, 'POST', '/api/vms/libvirt/action', { name: 'oldbox', action: 'stop' })).status, 200);
  require('../modules/machines/origin')._reset();

  const r = await H.api(null, 'GET', '/api/machines/vms/all');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [dev, old] = r.body.vms;
  assert.deepEqual([dev.name, dev.state, dev.locked, dev.why, dev.os], ['devbox', 'running', true, 'error: the display is locked', 'ubuntu 24.04']);
  assert.deepEqual(dev.given, { vcpus: 4, maxKiB: 4194304, disks: [{ used: 1073741824, size: 21474836480 }] });
  assert.equal(dev.start, null);
  assert.equal(dev.origin.outside, true, 'started with virt-manager: outside DOCA');
  assert.deepEqual([old.name, old.state, old.locked, old.start, old.given.vcpus, old.given.maxKiB], ['oldbox', 'stopped', false, 'start', 2, 2097152]);
  assert.match(old.origin.text, /^stopped by /);
  assert.ok(old.lastRan && Date.now() - old.lastRan < 60000, 'it ran until the stop just now');
  assert.deepEqual(r.body.vnc.map(n => [n.name, n.state, n.why]), [['Old desk', 'unreachable', 'It does not answer.']]);
  assert.ok(!JSON.stringify(r.body).includes('password"'), 'no password field leaves');

  // Start goes through the VMs' own route, and a fresh read asks virsh again.
  assert.equal((await H.api(null, 'POST', '/api/vms/libvirt/action', { name: 'oldbox', action: 'start' })).status, 200);
  const before = fs.readFileSync(calls, 'utf8').split('\n').filter(l => l === 'list --all').length;
  await H.api(null, 'GET', '/api/machines/vms/all?fresh=1');
  assert.ok(fs.readFileSync(calls, 'utf8').split('\n').filter(l => l === 'list --all').length > before);

  // The licence's feature, and a host's.
  assert.equal(require('../modules/license/gate').ownerOf('/api/machines/vms/all').id, 'machines-all');
  const member = await H.signIn('member', 'vms-all-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/machines/vms/all', undefined, { Cookie: member.cookie })).status, 403);
});
