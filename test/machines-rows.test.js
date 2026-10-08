'use strict';

/**
 * Every machine in one shape (modules/machines/rows.js), VMs in Machines → Live with a picture their hypervisor takes
 * (vm-shots.js, png.js) and a console through the hub (vm-console.js) — against stand-in docker, virsh and VBoxManage,
 * never this machine's real ones.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const png = require('../modules/machines/png');

test.after(() => H.stop());

/** A 1200×40 picture as a PPM (an older QEMU's screenshot): left half red, right half blue. */
function ppm(width = 1200, height = 40) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(i % width < width / 2 ? [255, 0, 0] : [0, 0, 255], i * 3);
  return Buffer.concat([Buffer.from(`P6\n# made by the test\n${width} ${height}\n255\n`), rgb]);
}

test('a PPM or a PNG screen comes back as a small RGB PNG, and what cannot be read is passed on', () => {
  const small = png.small(ppm(), 600);
  const img = png.fromPng(small);
  assert.deepEqual([img.width, img.height], [600, 20]);
  assert.deepEqual([...img.rgb.subarray(0, 3)], [255, 0, 0]);
  assert.deepEqual([...img.rgb.subarray(img.rgb.length - 3)], [0, 0, 255]);
  // A PNG written here reads back the same (RGB, every filter type is read: encode writes 0, a hypervisor any).
  assert.ok(png.small(small, 600).equals(small));
  assert.equal(png.small(Buffer.from('not a picture')).toString(), 'not a picture');
});

test('where a VM\'s console opens: a VNC display on this machine through the hub, anything else named for a viewer', () => {
  const { where } = require('../modules/machines/vm-console');
  const vm = display => ({ hypervisor: 'libvirt', name: 'devbox', state: 'running', display });
  assert.deepEqual(where(vm({ protocol: 'vnc', host: '127.0.0.1', port: 2, uri: 'vnc://127.0.0.1:2' })).port, 5902, 'libvirt names the display number');
  assert.equal(where(vm({ protocol: 'vnc', host: '0.0.0.0', port: 5905, uri: 'vnc://0.0.0.0:5905' })).host, '127.0.0.1');
  assert.equal(where(vm({ protocol: 'vnc', host: '203.0.113.9', port: 1, uri: 'vnc://203.0.113.9:1' })).how, 'viewer');
  assert.equal(where(vm({ protocol: 'spice', host: '127.0.0.1', port: 5930, uri: 'spice://127.0.0.1:5930' })).how, 'viewer');
  assert.equal(where(vm(null)).how, 'none');
  assert.equal(where({ ...vm(null), state: 'stopped' }).why, 'Not running.');
});

test('containers, computers and VMs as one list of rows; VMs pictured in Live; the console bridged; a member gets none of it', async t => {
  if (process.platform === 'win32') return t.skip('the stand-in CLIs are sh scripts');
  const bin = path.join(H.tmp, 'fake-machines');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'screen.ppm'), ppm());
  fs.writeFileSync(path.join(bin, 'screen.png'), png.small(ppm(800, 20), 800));
  const vnc = net.createServer(s => s.on('data', d => s.write(Buffer.concat([Buffer.from('echo:'), d]))));
  await new Promise(r => vnc.listen(0, '127.0.0.1', r));
  t.after(() => vnc.close());
  const sh = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  sh('docker', `case "$*" in
  *doca.computer*) : ;;
  "ps -a --format {{json .}}") echo '{"ID":"a1","Names":"web","Image":"nginx:1","State":"running","Status":"Up 2 hours","Labels":""}'
    echo '{"ID":"b2","Names":"batch","Image":"busybox","State":"exited","Status":"Exited (0) 3 days ago","Labels":""}'
    echo '{"ID":"c3","Names":"broken","Image":"app","State":"exited","Status":"Exited (1) 1 minute ago","Labels":""}'
    echo '{"ID":"d4","Names":"doca-computer-x","Image":"doca-computer","State":"running","Status":"Up","Labels":"doca.computer=1,x=y"}' ;;
  *) : ;;
esac`);
  sh('virsh', `case "$1" in
  --version) echo 10.0.0 ;;
  list) printf ' Id   Name     State\\n------------------------\\n 1    devbox   running\\n -    old      shut off\\n' ;;
  domdisplay) echo "vnc://127.0.0.1:${vnc.address().port}" ;;
  dumpxml) echo '<domain><metadata><libosinfo:os id="http://ubuntu.com/ubuntu/24.04"/></metadata></domain>' ;;
  screenshot) cp "${bin}/screen.ppm" "$3" ;;
esac`);
  sh('VBoxManage', `case "$1 $2" in
  "--version "*) echo 7.0 ;;
  "list vms"|"list runningvms") echo '"winbox" {11111111-2222-3333-4444-555555555555}' ;;
  "showvminfo winbox") printf 'VMState="running"\\nostype="Windows11_64"\\n' ;;
  "controlvm winbox") cp "${bin}/screen.png" "$4" ;;
esac`);
  const saved = { PATH: process.env.PATH, CLI: process.env.DOCA_CONTAINER_CLI };
  process.env.PATH = `${bin}:${saved.PATH}`;
  process.env.DOCA_CONTAINER_CLI = path.join(bin, 'docker');
  require('../modules/machines/vm-list')._reset(); require('../modules/machines/rows')._reset();
  t.after(() => { process.env.PATH = saved.PATH; if (saved.CLI === undefined) delete process.env.DOCA_CONTAINER_CLI; else process.env.DOCA_CONTAINER_CLI = saved.CLI; require('../modules/machines/vm-shots').stop(); });

  await H.start();
  const r = await H.api(null, 'GET', '/api/machines/rows');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = id => r.body.rows.find(x => x.id === id || x.name === id);
  assert.equal(by('doca-computer-x'), undefined, 'a computer\'s container is a computer, not a container too');
  const { origin, project, ...web } = by('web');
  assert.deepEqual({ ...web, actions: undefined }, { kind: 'container', id: 'a1', name: 'web', state: 'running', point: 'up', detail: 'nginx:1 · Up 2 hours', tab: 'docker', actions: undefined, live: false });
  assert.equal(project, null);
  assert.deepEqual([origin.text, origin.outside], ['started outside DOCA', true], 'running, and no act of DOCA\'s started it (machines/origin.js)');
  assert.equal(by('batch').point, 'down');
  assert.equal(by('broken').point, 'error', 'a non-zero exit is red');
  const devbox = by('libvirt:devbox');
  assert.deepEqual([devbox.kind, devbox.point, devbox.detail, devbox.tab, devbox.live], ['vm', 'up', 'libvirt / KVM · ubuntu 24.04', 'vms', true]);
  assert.ok(devbox.actions.includes('open'), 'its VNC is on this machine');
  assert.equal(by('libvirt:old').point, 'down');
  assert.equal(by('virtualbox:winbox').detail, 'VirtualBox · Windows11_64');
  assert.deepEqual(r.body.counts.container, { total: 3, running: 1, stopped: 1 });
  assert.equal(r.body.counts.vm.running, 2);

  // Live: the running VMs, pictured by their own hypervisor once a Live page asks.
  let live = (await H.api(null, 'GET', '/api/machines?shots=1')).body;
  assert.deepEqual(live.vms.map(v => v.key).sort(), ['libvirt:devbox', 'virtualbox:winbox']);
  await require('../modules/machines/vm-shots').round();
  live = (await H.api(null, 'GET', '/api/machines?shots=1')).body;
  assert.ok(live.vms.every(v => v.shot), JSON.stringify(live.vms.map(v => v.why)));
  for (const [key, width] of [['libvirt/devbox', 600], ['virtualbox/winbox', 800]]) {
    const res = await fetch(`${H.base}/api/machines/vms/${key}/shot`, { headers: { Cookie: H.owner.cookie } });
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(png.fromPng(Buffer.from(await res.arrayBuffer())).width, width, `${key}: at most 960 wide, in whole steps`);
  }

  // The console page, and its socket carried to the VM's VNC port.
  const page = await fetch(`${H.base}/api/machines/vms/libvirt/devbox/console`, { headers: { Cookie: H.owner.cookie } });
  assert.match(await page.text(), /ws\/vm\/libvirt\/devbox/);
  assert.equal((await H.api(null, 'GET', '/api/machines/vms/libvirt/old/console')).status, 409, 'a stopped VM has no console');
  require('../modules/terminal').setup(H.server());
  const WebSocket = require('ws');
  const ws = new WebSocket(`${H.base.replace('http', 'ws')}/ws/vm/libvirt/devbox`, ['binary'], { headers: { Cookie: H.owner.cookie } });
  const echoed = await new Promise((resolve, reject) => { ws.on('open', () => ws.send(Buffer.from('RFB'))); ws.on('message', d => resolve(String(d))); ws.on('error', reject); });
  ws.close();
  assert.equal(echoed, 'echo:RFB');
  const nobody = new WebSocket(`${H.base.replace('http', 'ws')}/ws/vm/libvirt/devbox`);
  await new Promise(resolve => { nobody.on('error', resolve); nobody.on('unexpected-response', resolve); });

  const member = await H.signIn('member', 'rows-member@test.local');
  for (const p of ['/api/machines/rows', '/api/machines/vms/libvirt/devbox/shot', '/api/machines/vms/libvirt/devbox/console'])
    assert.equal((await H.api(null, 'GET', p, undefined, { Cookie: member.cookie })).status, 403, p);
});
