'use strict';

// The Processes drawer (modules/processes): each OS's captured table read, the system's own left out, the rest grouped
// by where it comes from and folded under its parent; command lines masked; reading stops when nobody looks; a host's.
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'processes');
const fix = f => fs.readFileSync(path.join(FIX, f), 'utf8');
const sys = require('../modules/processes/system');
const { group } = require('../modules/processes/group');
const proc = require('../modules/processes');

/** The fixture's rows as index.js prepares them: the container from the cgroup, the system's reason. */
function prepare(procs, os, uidMin) {
  return procs.map(p => {
    const containerId = sys.containerOf(p.cgroup);
    const x = { ...p, containerId, cpu: 2 };
    return { ...x, system: sys.reason(x, { os, uidMin }) };
  });
}
const find = (groups, kind, title) => groups.find(g => g.kind === kind && (!title || g.title === title));
const pids = rows => rows.flatMap(r => [r.pid, ...pids(r.children)]);

test('linux: /proc lines are read — a name with spaces and parentheses, listening sockets, cgroups', () => {
  const lr = require('../modules/processes/read-linux');
  const s = lr.parseStat('4242 (Web Content (x) y) S 4000 4242 4000 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 30 0 123456 1000000 2560 18446744073709551615');
  assert.equal(s.comm, 'Web Content (x) y');
  assert.equal(s.ppid, 4000);
  assert.equal(s.utime + s.stime, 300);
  assert.equal(s.starttime, 123456);
  assert.equal(s.rssPages, 2560);
  const tcp = lr.parseNetTcp(`  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55501 1 0000000000000000 100 0 0 10 0
   1: 0100007F:A3C4 0100007F:1435 01 00000000:00000000 00:00000000 00000000  1000        0 55600 1 0000000000000000 20 4 30 10 -1`);
  assert.deepEqual([...tcp], [['55501', 5173]], 'only LISTEN (0A) sockets, the port read from hex');
  assert.equal(lr.parseCgroup('0::/system.slice/docker-abc.scope\n'), '/system.slice/docker-abc.scope');
  assert.equal(lr.parseCgroup('12:pids:/\n1:name=systemd:/docker/0123\n'), '/docker/0123');
});

test('linux: the system is left out by the stated rules, and the rest grouped by where it comes from', () => {
  const t = JSON.parse(fix('linux.json'));
  const procs = prepare(t.procs, 'linux', 1000);
  const why = Object.fromEntries(procs.filter(p => p.system).map(p => [p.pid, p.system]));
  assert.deepEqual(why, { 1: 'init', 2: 'a kernel thread', 45: 'a kernel thread', 700: 'a system account', 880: 'the desktop session',
    900: 'the desktop session', 905: 'the desktop session', 910: 'the desktop session', 1200: 'a system account', 3000: 'a system account', 7000: 'a system account' });
  assert.equal(procs.find(p => p.pid === 3200).system, null, 'a container\'s process is never the system\'s, whatever its account');
  const ctx = {
    os: 'linux', product: 'DOCA', hubPid: 5000,
    projects: [{ name: 'shop', root: '/home/sam/code/shop' }, { name: 'Workspace', root: '/home/sam/.openclaw/workspace', workspace: true }],
    containers: [
      { id: t.ids.service.slice(0, 12), name: 'doca-whisper', kind: 'service', label: 'Whisper STT', go: { tab: 'models' }, origin: { text: 'started by Sam from desk', at: null } },
      { id: t.ids.computer.slice(0, 12), name: 'doca-computer-abc', kind: 'computer', label: 'Tester\'s computer', go: { tab: 'computers' } },
      { id: t.ids.container.slice(0, 12), name: 'shop-db-1', project: 'shop', kind: 'container', go: { tab: 'docker' }, origin: { text: 'started outside DOCA', outside: true } },
    ],
    doca: new Map([[5000, { who: 'this hub — DOCA itself' }], [5010, { who: 'started by DOCA: the MCP server "playwright"' }]]),
    jobs: [{ pid: 5001, id: 'job_1', command: 'npm run build -- --watch', who: 'Fix the shop' }],
    ports: new Map([[4002, [5173]], [4100, [8000]]]),
    links: new Map([[5173, { label: 'a page an agent serves', go: { tab: 'live' } }]]),
    gitRootOf: d => (String(d).startsWith('/home/sam/src/blog') ? '/home/sam/src/blog' : null),
    mask: proc.mask,
  };
  const { groups, counts } = group(procs, ctx);
  assert.deepEqual(counts, { total: procs.length, shown: procs.length - 11, system: 11,
    why: { init: 1, 'a kernel thread': 2, 'a system account': 4, 'the desktop session': 4 } });
  assert.deepEqual(groups.map(g => `${g.kind}:${g.title}`), ['project:shop', 'project:shop ⑂ fix-login', 'project:Workspace', 'repo:blog',
    'job:An agent\'s job', 'doca:DOCA', 'computer:Computer "Tester\'s computer"', 'service:Whisper STT', 'container:shop-db-1', 'outside:Outside DOCA'],
    'projects first, then repositories, jobs, DOCA, computers, services, containers, outside');
  const shop = find(groups, 'project', 'shop');
  assert.equal(shop.rows.length, 1, 'npm run dev with its server and esbuild folded under it');
  assert.deepEqual(pids(shop.rows), [4001, 4002, 4003]);
  assert.equal(shop.rows[0].total.count, 3);
  assert.deepEqual(shop.rows[0].children[0].ports, [{ port: 5173, label: 'a page an agent serves', go: { tab: 'live' } }]);
  assert.deepEqual(shop.rows[0].who, { text: 'started outside DOCA', outside: true });
  assert.deepEqual(pids(find(groups, 'repo').rows), [4100], 'a repository found by walking up, named by its folder');
  const job = find(groups, 'job');
  assert.deepEqual(pids(job.rows), [5001, 5002], 'a job\'s shell and what runs under it, even in a project\'s folder');
  assert.match(job.rows[0].who.text, /agent's job in the conversation "Fix the shop"/);
  assert.deepEqual(pids(find(groups, 'doca').rows).sort(), [5000, 5010]);
  const outside = find(groups, 'outside');
  assert.deepEqual(pids(outside.rows).sort((a, b) => a - b), [4000, 5003, 6000, 6001, 6002, 8000]);
  assert.equal(outside.rows.find(r => r.pid === 6000).total.count, 3, 'a browser\'s helpers under it');
  assert.match(outside.rows.find(r => r.pid === 5003).who.text, /from DOCA's Terminal or a tool/, 'a shell the hub started, not "outside"');
  const svc = find(groups, 'service');
  assert.deepEqual(pids(svc.rows), [3001, 3002], 'the container\'s first process stands on its own: its parent (the shim) is the system\'s');
  assert.deepEqual(svc.go, { tab: 'models' });
  assert.equal(svc.rows[0].who.text, 'started by Sam from desk', 'who started a container: its machine row\'s origin line');
  assert.equal(find(groups, 'container').rows[0].who.outside, true);
  const all = group(procs, { ...ctx, system: true });
  assert.equal(find(all.groups, 'system').total.count, 11, 'asked, the system\'s own are listed too, with why');
  assert.equal(all.groups.at(-1).kind, 'system');
});

test('macOS: ps and lsof read, the system left out, a project by its working folder', () => {
  const dr = require('../modules/processes/read-darwin');
  assert.equal(dr.duration('1-02:03:04'), 93784000);
  assert.equal(dr.duration('12:00.50'), 720500);
  const now = 1791500000000;
  const procs = dr.parsePs(fix('darwin-ps.txt'), fix('darwin-comm.txt'), now);
  const cwd = dr.parseLsof(fix('darwin-lsof-cwd.txt'));
  for (const p of procs) p.cwd = cwd.get(p.pid)?.[0] || null;
  const chrome = procs.find(p => p.pid === 901);
  assert.equal(chrome.exe, '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)');
  assert.deepEqual(chrome.args.slice(1), ['--type=renderer'], 'a path with spaces stays one word');
  assert.equal(procs.find(p => p.pid === 1501).startedAt, now - 45 * 60000);
  assert.deepEqual([...dr.portsOf(fix('darwin-lsof-listen.txt'))], [[1502, [3000]], [1600, [8765]], [1700, [4242]]]);
  const rows = prepare(procs, 'darwin', 501);
  assert.deepEqual(rows.filter(p => p.system).map(p => p.pid), [0, 1, 152, 301, 302, 410, 420]);
  const { groups } = group(rows, { os: 'darwin', hubPid: 1700, doca: new Map([[1700, {}]]), projects: [{ name: 'shop', root: '/Users/sam/code/shop' }], gitRootOf: () => null });
  const shop = find(groups, 'project', 'shop');
  assert.deepEqual(pids(shop.rows).sort((a, b) => a - b), [1501, 1502, 1701]);
  assert.match(shop.rows.find(r => r.pid === 1701).who.text, /from DOCA's Terminal or a tool/, 'npm test under the hub, in the project\'s folder');
  assert.deepEqual(pids(find(groups, 'outside').rows).sort((a, b) => a - b), [900, 901, 1500, 1600]);
  assert.match(shop.rows.find(r => r.pid === 1501).command, /next dev/);
  assert.deepEqual(pids(find(groups, 'doca').rows), [1700]);
});

test('Windows: CIM and Get-NetTCPConnection read, services and the desktop left out, a project by a path on the command line', () => {
  const wr = require('../modules/processes/read-win32');
  assert.deepEqual(wr.splitCommand('"C:\\Program Files\\nodejs\\node.exe" C:\\x\\vite.js --port "51 73"'), ['C:\\Program Files\\nodejs\\node.exe', 'C:\\x\\vite.js', '--port', '51 73']);
  const { procs, listen } = wr.parse(fix('win32.json'));
  assert.deepEqual([...listen], [[3100, [5173]], [812, [135]]], 'one port once, by owning process');
  assert.equal(procs.find(p => p.pid === 3100).cpuMs, 5000, 'kernel and user time, in 100 ns, as ms');
  const rows = prepare(procs, 'win32');
  assert.deepEqual(Object.fromEntries(rows.filter(p => p.system).map(p => [p.pid, p.system])),
    { 0: 'the kernel', 4: 'the kernel', 812: 'a service', 2210: 'part of Windows', 2300: 'part of Windows', 4400: 'a service' });
  assert.equal(rows.find(p => p.pid === 3020).system, null, 'PowerShell from the Windows folder is a person\'s shell');
  const { groups } = group(rows, { os: 'win32', projects: [{ name: 'shop', root: 'C:\\Users\\sam\\code\\shop' }], ports: listen, gitRootOf: () => null });
  const shop = find(groups, 'project', 'shop');
  assert.deepEqual(pids(shop.rows), [3100, 3101], 'vite by its script\'s path, esbuild by its program\'s, folded under it');
  assert.deepEqual(shop.rows[0].ports, [{ port: 5173 }]);
  assert.deepEqual(pids(find(groups, 'outside').rows).sort((a, b) => a - b), [3000, 3010, 3020, 3200]);
});

test('a command line is masked: secret flags, NAME_KEY=, secrets in an address, a long random word', () => {
  const { MASK } = require('../modules/secrets-mask');
  const t = JSON.parse(fix('linux.json'));
  const line = proc.mask(t.procs.find(p => p.pid === 8000).args);
  assert.ok(!/s3cr3t|abc123|AbCdEfGhIjKl|Q2hlY2tPdXRU/.test(line), line);
  assert.equal(line.split(MASK).length - 1, 4, line);
  assert.equal(proc.mask(['node', '/home/sam/code/shop/node_modules/.bin/vite', '--port', '5173']), 'node /home/sam/code/shop/node_modules/.bin/vite --port 5173', 'ordinary paths stay');
});

test('the table is read only while someone looks, and the readings go when nobody does', async () => {
  let reads = 0;
  proc._reset();
  proc._useReader({ OS: 'linux', accounts: () => ({ names: new Map([[1000, 'sam']]), uidMin: 1000 }), listening: async () => new Map(),
    read: async () => { reads++; return { os: 'linux', at: Date.now(), procs: [{ pid: 10, ppid: 1, uid: 1000, name: 'node', args: ['node'], cwd: '/tmp', cgroup: null, kernel: false, cpuMs: reads * 100, startedAt: 1, rss: 1 }] }; } });
  const saved = { ...proc.T };
  Object.assign(proc.T, { lookMs: 40, wantMs: 200 });
  try {
    const s = await proc.snapshot();
    assert.equal(s.groups[0].rows[0].user, 'sam');
    assert.equal(s.groups[0].rows[0].cpu, null, 'no CPU from the first reading of a process');
    proc.want();   // a drawer asking again (the snapshot's own docker ps may have outlasted the short wait)
    await H.sleep(120);
    assert.ok(reads >= 2, `read again while wanted (${reads})`);
    assert.ok(proc.reading());
    await H.sleep(400);
    assert.equal(proc.reading(), false, 'stopped after the last look');
    const after = reads;
    await H.sleep(200);
    assert.equal(reads, after, 'nothing read once stopped');
  } finally { Object.assign(proc.T, saved); proc._useReader(null); proc._reset(); }
});

test('GET /api/machines/processes is a host\'s', async () => {
  await H.start();
  proc._useReader({ OS: 'linux', accounts: () => ({ names: new Map(), uidMin: 1000 }), listening: async () => new Map(),
    read: async () => ({ os: 'linux', at: Date.now(), procs: [{ pid: process.pid, ppid: 1, uid: 1000, name: 'node', args: ['node'], cwd: '/', cgroup: null, kernel: false, cpuMs: 1, startedAt: 1, rss: 1 }] }) });
  try {
    const r = await H.api(null, 'GET', '/api/machines/processes');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.groups[0].kind, 'doca');
    assert.equal(r.body.everyMs, 3000);
    assert.ok(Array.isArray(r.body.rules) && r.body.rules.length);
    const member = await H.signIn('member');
    assert.equal((await H.api(null, 'GET', '/api/machines/processes', undefined, { Cookie: member.cookie })).status, 403);
    assert.equal((await H.api(null, 'GET', '/api/machines/processes', undefined, { Cookie: '' })).status, 401);
  } finally { proc._useReader(null); proc._reset(); await H.stop(); }
});
