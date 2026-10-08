'use strict';

/**
 * Asking before a machine is closed, and writing down who acted on it (asked 2026-10-08): what uses a machine right now
 * (modules/machines/use.js) — the hive's voice and the screens speaking with it, the harness's llama.cpp server, a
 * computer lent to a running mission — and each person's, device's and agent's act as a line (machines/acts.js,
 * acts-agent.js) that a machine row reads back as "started by …" or "started outside DOCA" (origin.js), and Chronicle
 * lists by person. Against stand-in docker and virsh, never this machine's.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test.after(() => H.stop());

const lines = () => require('../modules/activity').list({ limit: 200 });
const lineFor = (kind, id, act) => lines().find(l => l.machine?.kind === kind && l.machine.id === id && l.act === act);

test('what uses a machine: the hive\'s voice and its screens, the harness\'s llama.cpp server, a computer lent to a mission', async () => {
  await H.start();
  const u = require('../modules/utils');
  const prefs = u.loadPrefs();
  u.savePrefs({ ...prefs, voiceServices: { ttsUrl: 'http://localhost:8880', sttUrl: 'http://localhost:8000', ttsModel: 'kokoro' },
    llamacpp: { instances: [{ id: 'qwen', name: 'qwen', port: 8080, modelPath: '/models/q.gguf' }] },
    harness: { ...(prefs.harness || {}), default: 'doca', config: { ...(prefs.harness?.config || {}), doca: { ...(prefs.harness?.config?.doca || {}), provider: 'llamacpp', model: 'qwen-27b' } } } });

  // Two screens heard from lately, both answered in the hive's voice.
  const devices = require('../modules/api-v1/devices'), showing = require('../modules/screens/showing');
  for (const name of ['Kitchen tablet', 'Desk']) showing.beat(devices.create({ name, scopes: [], kind: 'browser' }).device.id, { page: 'controls' });

  const use = async (kind, id) => { const r = await H.api(null, 'GET', `/api/machines/use?kind=${kind}&id=${encodeURIComponent(id)}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
  const kokoro = await use('service', 'kokoro');
  assert.ok(kokoro.reasons.includes('Kokoro TTS is the hive\'s voice; 2 screens use it'), JSON.stringify(kokoro.reasons));
  assert.ok((await use('service', 'whisper')).reasons.some(r => /speech-to-text/.test(r)), 'whisper hears the calls');
  assert.deepEqual((await use('service', 'comfyui')).reasons, [], 'nothing uses what nothing points at');

  const lifecycle = require('../modules/harness/turn/lifecycle');
  lifecycle.running.set('s_busy', new AbortController());
  try {
    const qwen = await use('llamacpp', 'qwen');
    assert.ok(qwen.reasons.includes('it runs the agent\'s model (qwen-27b)'), JSON.stringify(qwen.reasons));
    assert.ok(qwen.reasons.includes('1 conversation is working on it now'), JSON.stringify(qwen.reasons));
  } finally { lifecycle.running.delete('s_busy'); }

  // A computer lent to a running mission.
  const computers = require('../modules/computers'), missions = require('../modules/agents/missions'), memory = require('../modules/harness/memory');
  const s = memory.createSession('Tester: check the shop', { activate: false, kind: 'specialist', profile: { computer: 'c0ffee12' } });
  const was = { get: computers.get, running: missions.running };
  computers.get = id => (id === 'c0ffee12' ? { id, name: 'shop-box', servePort: null } : was.get(id));
  missions.running = () => [{ id: 'm_1', agentId: 'tester', label: 'Check the shop', sessionId: s.id, state: 'running' }];
  try {
    const box = await use('computer', 'c0ffee12');
    assert.equal(box.name, 'shop-box');
    assert.ok(box.reasons.includes('it is lent to the running mission Check the shop (tester)'), JSON.stringify(box.reasons));
  } finally { Object.assign(computers, { get: was.get }); missions.running = was.running; }

  assert.equal((await H.api(null, 'GET', '/api/machines/use?kind=toaster&id=x')).status, 400);
  const member = await H.signIn('member', 'use-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/machines/use?kind=service&id=kokoro', undefined, { Cookie: member.cookie })).status, 403, 'what runs on the machine is a host\'s');
});

test('every act on a machine is a line with its person, and a row says who started it — or that DOCA did not', async t => {
  if (process.platform === 'win32') return t.skip('the stand-in CLIs are sh scripts');
  const bin = path.join(H.tmp, 'fake-acts');
  fs.mkdirSync(bin, { recursive: true });
  const sh = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  sh('docker', `case "$*" in
  "ps -a --format {{json .}}") echo '{"ID":"a1b2c3","Names":"web","Image":"nginx:1","State":"running","Status":"Up 2 hours","Labels":"","Ports":"0.0.0.0:8880->8880/tcp"}' ;;
  *) : ;;
esac`);
  sh('virsh', `case "$1" in
  --version) echo 10.0.0 ;;
  list) printf ' Id   Name     State\\n------------------------\\n 1    devbox   running\\n' ;;
  *) : ;;
esac`);
  const saved = { PATH: process.env.PATH, CLI: process.env.DOCA_CONTAINER_CLI };
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH}`;
  process.env.DOCA_CONTAINER_CLI = path.join(bin, 'docker');
  require('../modules/machines/vm-list')._reset(); require('../modules/machines/rows')._reset();
  t.after(() => { process.env.PATH = saved.PATH; if (saved.CLI === undefined) delete process.env.DOCA_CONTAINER_CLI; else process.env.DOCA_CONTAINER_CLI = saved.CLI; });
  await H.start();

  // Running, and nothing noted started it: a VM someone started with virt-manager.
  let rows = (await H.api(null, 'GET', '/api/machines/rows')).body.rows;
  assert.equal(rows.find(r => r.id === 'libvirt:devbox').origin.text, 'started outside DOCA');
  assert.equal(rows.find(r => r.id === 'libvirt:devbox').origin.outside, true);

  // A person's acts from the panel: the container is kept by its name, the VM by hypervisor and name.
  assert.equal((await H.api(null, 'POST', '/api/docker/containers/a1b2c3/action', { action: 'stop' })).status, 200);
  assert.equal((await H.api(null, 'POST', '/api/vms/libvirt/action', { name: 'devbox', action: 'start' })).status, 200);
  await H.sleep(50);
  const stop = lineFor('container', 'web', 'stop');
  assert.ok(stop, JSON.stringify(lines().slice(0, 5)));
  assert.deepEqual([stop.from, stop.person.id, stop.ok, stop.what, stop.via], ['person', H.owner.user.id, true, 'stopped the container web', 'the panel']);
  const start = lineFor('vm', 'libvirt:devbox', 'start');
  assert.deepEqual([start.from, start.person.name, start.what], ['person', 'owner', 'started the VM devbox']);
  rows = (await H.api(null, 'GET', '/api/machines/rows')).body.rows;
  assert.equal(rows.find(r => r.id === 'libvirt:devbox').origin.text, 'started by owner from the panel');

  // Adding and removing a VNC screen; an unknown action is not a line.
  const added = (await H.api(null, 'POST', '/api/machines/vnc', { name: 'lab', host: '127.0.0.1', port: 5999 })).body;
  assert.ok(lineFor('vnc', added.id, 'add'));
  await H.api(null, 'DELETE', `/api/machines/vnc/${added.id}`);
  await H.sleep(20);
  assert.ok(lineFor('vnc', added.id, 'remove'));

  // A device's command: its person and its name.
  const { device, token } = H.mkDevice('Test Phone', 'admin', H.PHONE_CAPS);
  require('../modules/api-v1/devices').update(device.id, { userId: H.owner.user.id });
  const r = await H.api(token, 'POST', '/api/v1/commands/docker.container.restart', { params: { id: 'a1b2c3' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await H.sleep(50);
  const restart = lineFor('container', 'web', 'restart');
  assert.deepEqual([restart.from, restart.person?.id, restart.via], ['person', H.owner.user.id, 'the device Test Phone']);

  // An agent's: which conversation, and a refused call written as failed.
  const memory = require('../modules/harness/memory'), events = require('../modules/harness/agent').events;
  const s = memory.createSession('Fix the build', { activate: false });
  require('../modules/harness/session-access').claim(H.owner.user, s.id);
  events.emit('event', { sessionId: s.id, type: 'tool_call', name: 'computer', args: { action: 'stop', id: 'beef0001' } });
  events.emit('event', { sessionId: s.id, type: 'tool_result', name: 'computer', result: 'Stopped beef0001; its files stay until it is removed.' });
  events.emit('event', { sessionId: s.id, type: 'tool_call', name: 'mcp_connect', args: { server: 'blender', action: 'stop' } });
  events.emit('event', { sessionId: s.id, type: 'tool_result', name: 'mcp_connect', result: 'Error: no MCP server "blender".' });
  await H.sleep(50);
  const byAgent = lineFor('computer', 'beef0001', 'stop');
  assert.deepEqual([byAgent.from, byAgent.sessionId, byAgent.via, byAgent.person?.id, byAgent.ok], ['agent', s.id, 'the conversation "Fix the build"', H.owner.user.id, true]);
  assert.equal(lineFor('mcp', 'blender', 'stop').ok, false);

  // A take-over socket (terminal.js hands it over once the gate let it through); a socket that only watches is not one.
  const acts = require('../modules/machines/acts');
  acts.upgrade({ url: '/ws/computer/abcd1234?drive=1' }, { user: H.owner.user, session: {} });
  acts.upgrade({ url: '/ws/vnc/v_lab' }, { user: H.owner.user, session: {} });
  assert.equal(lineFor('computer', 'abcd1234', 'take-over').person.id, H.owner.user.id);
  assert.equal(lineFor('vnc', 'v_lab', 'take-over'), undefined);

  // Chronicle's hub source lists them, one person's with `person`.
  const ch = (await H.api(null, 'GET', `/api/chronicle?source=hub&person=${H.owner.user.id}`)).body;
  assert.ok(ch.rows.some(x => x.text === 'owner — stopped the container web (from the panel)'), JSON.stringify(ch.rows.slice(0, 4)));
  assert.ok(ch.facets.people.some(p => p.id === H.owner.user.id));
  const nobody = (await H.api(null, 'GET', '/api/chronicle?source=hub&person=u_nobody')).body;
  assert.equal(nobody.rows.length, 0);
});

test('the panel asks one question before a stop, naming what uses the machine; a start goes ahead', async () => {
  const vm = require('node:vm'), F = require('./frontend');
  const asked = [], ran = [];
  const ctx = { apiFetch: async url => { asked.push(url); return { name: 'Kokoro TTS', reasons: ['Kokoro TTS is the hive\'s voice; 2 screens use it'] }; },
    appConfirm: (message, yes) => { ctx.message = message; yes(); } };
  vm.createContext(ctx);
  vm.runInContext(`${F.source('lib/machine-ask.js')}\n;this.machineAskFirst = machineAskFirst;`, ctx);
  assert.equal(ctx.machineAskFirst('service', 'kokoro', 'start', '', () => ran.push('start')), false, 'starting does not ask');
  assert.equal(ctx.machineAskFirst('service', 'kokoro', 'stop', '', () => ran.push('stop')), true);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(asked, ['/api/machines/use?kind=service&id=kokoro']);
  assert.equal(ctx.message, 'Stop Kokoro TTS?\n\nIn use right now:\n• Kokoro TTS is the hive\'s voice; 2 screens use it');
  assert.deepEqual(ran, ['stop']);
});
