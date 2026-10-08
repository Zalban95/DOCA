'use strict';

/**
 * A machine is seen busy whoever made it so (modules/machines/busy.js; asked 2026-10-08): against a stand-in docker
 * (`stats`), a stand-in virsh (`domstats`) and a stub computer whose hidden `processes` tool says what runs — never this
 * machine's real ones. Busy after two looks over the threshold or at once for a process started outside DOCA's tools,
 * idle again after two quiet looks; said in Live, the rows, the Workstream, the Harness's working list and the machines'
 * log; nothing read while no page looks; a member sees none of it; secrets in a command line masked.
 */
const H = require('./helpers');   // first: it points the settings at a temporary folder
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

test.after(() => H.stop());

const busy = () => require('../modules/machines/busy');

test('a command line\'s secrets are masked before anyone sees it', () => {
  const { maskCommand } = require('../modules/machines/busy-read');
  const shown = maskCommand(['curl', '-H', 'Authorization: Bearer abcdef0123456789', '--token', 'sekrit-1', '--api-key=sekrit-2',
    'https://api.example.com/v1/x?access_token=sekrit-3', 'GITHUB_TOKEN=sekrit-4', 'password=sekrit-5']).join(' ');
  assert.doesNotMatch(shown, /sekrit|abcdef0123456789/, shown);
  assert.match(shown, /^curl -H Authorization: Bearer ••••••••/);
});

test('libvirt\'s domstats read as CPU time and memory per machine', () => {
  const m = require('../modules/machines/busy-read').parseDomstats("Domain: 'devbox'\n  state.state=1\n  cpu.time=123000000\n  balloon.current=2097152\n  balloon.rss=1048576\n\nDomain: 'b'\n  cpu.time=5\n");
  assert.deepEqual(m.get('devbox'), { cpuTime: 123000000, rssKiB: 1048576 });
  assert.equal(m.get('b').cpuTime, 5);
});

test('busy after two looks or a process from outside; idle after two quiet ones; seen everywhere; only while a page looks; a host\'s', async t => {
  if (process.platform === 'win32') return t.skip('the stand-in CLIs are sh scripts');
  const bin = path.join(H.tmp, 'fake-busy');
  fs.mkdirSync(bin, { recursive: true });
  const at = f => path.join(bin, f);
  fs.writeFileSync(at('cpu'), '0.5');
  fs.writeFileSync(at('vmcpu'), '0');
  fs.writeFileSync(at('calls'), '');
  const sh = (name, body) => fs.writeFileSync(at(name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  sh('docker', `case "$1" in
  stats) echo x >> "${at('calls')}"; echo "{\\"Name\\":\\"doca-computer-t1\\",\\"CPUPerc\\":\\"$(cat "${at('cpu')}")%\\",\\"MemUsage\\":\\"812MiB / 31GiB\\"}"
    echo '{"Name":"web","CPUPerc":"0.20%","MemUsage":"20MiB / 31GiB"}' ;;
  ps) echo '{"ID":"a1","Names":"web","Image":"nginx","State":"running","Status":"Up","Labels":""}'
    echo '{"ID":"d4","Names":"doca-computer-t1","Image":"doca-computer","State":"running","Status":"Up","Labels":"doca.computer=1"}' ;;
  *) : ;;
esac`);
  sh('virsh', `case "$*" in
  --version) echo 10.0.0 ;;
  "list --all") printf ' Id   Name     State\\n------------------------\\n 1    devbox   running\\n' ;;
  domstats*) printf "Domain: 'devbox'\\n  cpu.time=%s\\n  balloon.rss=1048576\\n" "$(cat "${at('vmcpu')}")" ;;
  *) : ;;
esac`);

  // The computer's control server, as far as the hub's hidden `processes` call goes.
  const P = { uptime: 1000, procs: [] };
  const base = [{ pid: 1, ppid: 0, ticks: 10, start: 100, args: ['/bin/sh', '/opt/doca-computer/start.sh'] },
    { pid: 7, ppid: 1, ticks: 50, start: 200, args: ['node', '/opt/doca-computer/agent.js'] },
    { pid: 8, ppid: 1, ticks: 900, start: 150, args: ['Xvfb', ':1'] }];
  const stub = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; });
    req.on('end', () => {
      const msg = JSON.parse(raw);
      assert.equal(req.headers.authorization, 'Bearer tok-t1');
      const body = msg.params?.name === 'processes' ? { content: [{ type: 'text', text: JSON.stringify({ self: 7, uptime: P.uptime, hz: 100, procs: P.procs }) }] } : { content: [], isError: true };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: body }));
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());

  const saved = { PATH: process.env.PATH, CLI: process.env.DOCA_CONTAINER_CLI };
  process.env.PATH = `${bin}:${saved.PATH}`;
  process.env.DOCA_CONTAINER_CLI = at('docker');
  t.after(() => { process.env.PATH = saved.PATH; if (saved.CLI === undefined) delete process.env.DOCA_CONTAINER_CLI; else process.env.DOCA_CONTAINER_CLI = saved.CLI; busy()._reset(); });
  await H.start();
  require('../modules/computers').save([{ id: 't1', name: 'deepB-tester', token: 'tok-t1', mcpPort: stub.address().port, createdAt: new Date().toISOString() }]);
  require('../modules/machines/vm-list')._reset(); require('../modules/machines/rows')._reset();
  busy()._reset();
  Object.assign(busy().T, { lookMs: 60, wantMs: 400 });
  t.after(() => Object.assign(busy().T, { lookMs: 10000, wantMs: 30000 }));
  const calls = () => fs.readFileSync(at('calls'), 'utf8').split('\n').filter(Boolean).length;

  // Nothing is read while no page looks.
  await H.sleep(250);
  assert.equal(calls(), 0, 'no viewer, no docker stats');

  const look = async () => { await H.sleep(40); await busy().look(); };
  const ws = () => require('../modules/workstream').snapshot().activity.filter(a => a.kind === 'machine').map(a => a.text);
  const logged = () => require('../modules/machines/busy-log').lines().map(l => l.text);

  // Look 1, the baseline: a quiet computer, a quiet container, a VM with no CPU share yet.
  P.procs = base;
  await look();
  assert.equal(busy().of('computer', 't1').busy, false);
  assert.deepEqual([busy().of('container', 'web').cpu, busy().of('vm', 'libvirt:devbox').mem], [0.2, '1.0 GiB']);

  // Look 2: a busy loop started by `docker exec` (no DOCA control server above it), with a secret on its command line.
  fs.writeFileSync(at('cpu'), '74.3');
  fs.writeFileSync(at('vmcpu'), '0');
  P.uptime = 1010;
  P.procs = [...base, { pid: 50, ppid: 0, ticks: 1000, start: 99000, args: ['sh', '-c', 'while :; do :; done'] },
    { pid: 51, ppid: 0, ticks: 2, start: 99500, args: ['node', 'server.js', '--token', 'sekrit-tunnel'] },
    { pid: 60, ppid: 7, ticks: 1, start: 99600, args: ['xdotool', 'click', '1'] }];
  await look();
  const pc = busy().of('computer', 't1');
  assert.equal(pc.busy, true, 'a process from outside makes it busy at once');
  assert.equal(pc.by, 'outside');
  assert.equal(pc.who, 'a process started outside DOCA\'s tools');
  assert.equal(pc.text, 'sh -c while :; do :; done · 74% CPU');
  assert.ok(logged().includes('deepB-tester: sh -c while :; do :; done started (outside DOCA\'s tools)'), logged().join('\n'));
  assert.ok(logged().some(l => /deepB-tester: node server\.js --token •+ started/.test(l)));
  assert.ok(!logged().some(l => /xdotool/.test(l)), 'what DOCA\'s own tools start is in the agent\'s own lines, not here');
  assert.ok(!JSON.stringify([logged(), ws()]).includes('sekrit'), 'no secret in any line');
  assert.ok(ws().includes('busy: sh -c while :; do :; done · 74% CPU (a process started outside DOCA\'s tools)'), ws().join('\n'));
  assert.ok(ws().includes('sh -c while :; do :; done started (outside DOCA\'s tools)'), 'the Workstream names the machine as who, not twice');
  const noted = require('../modules/activity').list({ limit: 20 }).find(l => l.from === 'machines');
  assert.deepEqual([noted.what, noted.why, noted.machine.id, noted.act], ['deepB-tester busy: sh -c while :; do :; done · 74% CPU', 'a process started outside DOCA\'s tools', 't1', undefined]);

  // The VM: a share of CPU time between two looks, busy after two looks over the threshold.
  fs.writeFileSync(at('vmcpu'), String(9e12));
  P.uptime = 1020; P.procs = P.procs.filter(p => p.pid !== 60).map(p => (p.pid === 50 ? { ...p, ticks: 2000 } : p));
  await look();
  assert.ok(busy().of('vm', 'libvirt:devbox').cpu >= 10);
  fs.writeFileSync(at('vmcpu'), String(18e12));
  P.uptime = 1030; P.procs = P.procs.map(p => (p.pid === 50 ? { ...p, ticks: 3000 } : p));
  await look();
  assert.equal(busy().of('vm', 'libvirt:devbox').busy, true);
  assert.equal(busy().of('vm', 'libvirt:devbox').who, 'the VM\'s own load');
  assert.equal(busy().of('container', 'web').busy, false, 'a quiet container stays quiet');

  // Seen where a host looks: the rows, Live, the Harness's working list, Hub → Logs, Chronicle.
  const rows = (await H.api(null, 'GET', '/api/machines/rows')).body.rows;
  assert.equal(rows.find(r => r.kind === 'computer' && r.id === 't1').busy.busy, true);
  const live = (await H.api(null, 'GET', '/api/machines')).body;
  const tile = live.computers.find(c => c.id === 't1');
  assert.deepEqual([tile.working, tile.busy.by], [true, 'outside'], 'busy comes to the front in Live');
  const working = (await H.api(null, 'GET', '/api/harness/working')).body;
  assert.deepEqual(working.machines.map(m => m.id).sort(), ['libvirt:devbox', 't1']);
  const chron = (await H.api(null, 'GET', '/api/chronicle?source=machines')).body;
  assert.ok(chron.rows.some(r => /started \(outside DOCA's tools\)/.test(r.text)));
  const got = [];
  const stop = require('../modules/logs').open('machines', { tail: 50 }, l => got.push(l));
  stop();
  assert.ok(got.some(l => l.source === 'machines' && /busy:/.test(l.text)));

  // A member sees none of it.
  const member = await H.signIn('member', 'busy-member@test.local');
  const as = p => H.api(null, 'GET', p, undefined, { Cookie: member.cookie });
  assert.equal((await as('/api/machines/rows')).status, 403);
  assert.equal((await as('/api/workstream')).status, 403);
  assert.deepEqual((await as('/api/harness/working')).body.machines, []);
  assert.deepEqual((await as('/api/chronicle?source=machines')).body.rows, []);

  // Two quiet looks: idle again.
  fs.writeFileSync(at('cpu'), '0.4');
  for (const up of [1040, 1050]) { P.uptime = up; P.procs = base; fs.writeFileSync(at('vmcpu'), String(18e12)); await look(); }
  assert.equal(busy().of('computer', 't1').busy, false);
  assert.equal(busy().of('vm', 'libvirt:devbox').busy, false);
  assert.ok(logged().some(l => /^deepB-tester idle again after \d+ min$/.test(l)), logged().join('\n'));
  assert.equal(busy().busyNow().length, 0);

  // Looked at only while a page asks: the rows route keeps it looking, and it stops wantMs after the last ask.
  const before = calls();
  busy().want();
  await H.sleep(200);
  assert.ok(calls() > before, 'a page asking starts the looks');
  await H.sleep(600);
  const after = calls();
  await H.sleep(300);
  assert.equal(calls(), after, 'nobody asks any more: no more looks');
});
