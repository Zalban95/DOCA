'use strict';

/**
 * Real frames for the apps' parser tests (audit 2026-10-06, cl 21; TODO D2). DocaMobile's fixtures dated from hub
 * 2.10.1 and DocaWear's were written by hand, so a field the hub added (archivedAt, quiet, kind) was parsed by
 * neither. `npm run fixtures` (DOCA_WRITE_FIXTURES=1) drives the hub's own code — a mission running, finished and put
 * away, a work chat a person stopped, a question asked and withdrawn, a notice — and writes each frame a phone receives
 * to docs/api/fixtures/<name>.json. Without the variable this checks the files there: present, and every payload
 * field one the OpenAPI event schema declares, so a fixture cannot describe a field the contract does not.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H   = require('./helpers');
const bus = require('../modules/api-v1/bus');

const DIR = path.join(__dirname, '..', 'docs', 'api', 'fixtures');
const WRITE = process.env.DOCA_WRITE_FIXTURES === '1';
const NAMES = ['agent.mission-running', 'agent.mission-done', 'agent.mission-archived', 'agent.mission-seen', 'agent.mission-work-stopped',
  'prompt.new', 'prompt.new-approval', 'prompt.closed', 'alert', 'alert-files', 'settings.changed', 'device.approved', 'device.refused',
  'agent.team-running', 'agent.team-done'];

test.before(() => H.start());
test.after(() => H.stop());

async function frames() {
  const phone = H.mkDevice('Fixture phone', 'phone', H.PHONE_CAPS).device;
  const last = type => bus.drain(phone.id, 0).events.filter(e => e.type === type).at(-1);
  const out = {};
  const missions = require('../modules/agents/missions');
  const row = { id: 'msn_fixture', agentId: 'researcher', label: 'Researcher', task: 'Find the release notes of llama.cpp b6000',
    state: 'running', steps: 2, tokens: 8400, startedAt: '2026-10-06T18:00:00.000Z', plan: [{ title: 'Search', state: 'done' }, { title: 'Read the notes', state: 'running' }] };
  missions.announce(row); out['agent.mission-running'] = last('agent.mission');
  const done = { ...row, state: 'done', steps: 5, tokens: 21000, endedAt: '2026-10-06T18:04:00.000Z', result: 'b6000 adds the router mode.', plan: row.plan.map(p => ({ ...p, state: 'done' })) };
  missions.announce(done); out['agent.mission-done'] = last('agent.mission');
  missions.announce({ ...done, archivedAt: '2026-10-06T19:00:00.000Z' }, { quiet: true }); out['agent.mission-archived'] = last('agent.mission');
  missions.announce({ ...done, seenAt: '2026-10-06T18:30:00.000Z' }, { quiet: true }); out['agent.mission-seen'] = last('agent.mission');   // read means done (harness/seen.js)

  // A team (teams/): three tasks on one board, the board read by the hub's own rules (teams/board.js) from missions.
  const board = require('../modules/teams/board'), announce = require('../modules/teams/announce');
  const team = { id: 'team_fixture', title: 'Landing page', goal: 'A page with its copy, checked in a browser', by: null, state: 'running',
    createdAt: '2026-10-06T18:00:00.000Z', loop: { on: true, rounds: 0, maxRounds: 3 }, notes: [{ text: 'The headline is in copy.md' }],
    doc: { name: 'team-landing-page.md' },
    tasks: [{ id: 'page', title: 'Build the page', agent: 'coder', missionId: 'msn_page', contract: { done: 'index.html shows the headline' } },
      { id: 'copy', title: 'Write the copy', agent: 'researcher', missionId: 'msn_copy' },
      { id: 'test', title: 'Check it in a browser', agent: 'tester', after: ['page', 'copy'], contract: { done: 'no console errors' } }] };
  const runs = { msn_page: { state: 'running', steps: 12 }, msn_copy: { state: 'done', steps: 9 } };
  const look = { mission: id => runs[id], session: () => null, budget: a => ({ coder: 80, researcher: 40, tester: 120 })[a] };
  team.tasks[1].verdict = { ok: true, why: 'no check — on the agent\'s word' };
  let views = board.tasks(team, look);
  team.progress = board.summary(team, views).progress;
  announce.devices(team, views); out['agent.team-running'] = last('agent.team');
  Object.assign(runs, { msn_page: { state: 'done', steps: 30 }, msn_test: { state: 'done', steps: 41 } });
  Object.assign(team.tasks[0], { verdict: { ok: true, why: 'the page shows "Ship it"' } });
  Object.assign(team.tasks[2], { missionId: 'msn_test', verdict: { ok: true, why: 'the page shows no console errors' } });
  views = board.tasks(team, look);
  Object.assign(team, { state: 'done', endedAt: '2026-10-06T18:40:00.000Z', progress: board.summary(team, views).progress });
  announce.devices(team, views); out['agent.team-done'] = last('agent.team');

  const memory = require('../modules/harness/memory');
  const w = memory.createSession('Laya MCP server', { activate: false, kind: 'work', parentId: memory.mainSession().id });
  memory.updateSession(w.id, { state: 'idle', job: { state: 'stopped', stoppedWhy: 'Stopped from the missions bar' } });
  require('../modules/harness/workview').announce(w.id); out['agent.mission-work-stopped'] = last('agent.mission');

  const reach = require('../modules/harness/reach');
  const ctrl = new AbortController();
  const asked = reach.ask({ to: phone.id, question: 'Restart the speech service?', choices: ['Restart', 'Leave it'], timeoutSec: 30, signal: ctrl.signal }).catch(() => null);
  await new Promise(r => setTimeout(r, 50));
  out['prompt.new'] = last('prompt.new');
  ctrl.abort(); await asked;
  out['prompt.closed'] = last('prompt.closed');
  // An approval asked on the phone that started the turn (approval-explain.js): why, what it does, the request folded.
  const approval = require('../modules/harness/approval');
  const args = { command: 'rm -f build.log && git push origin main' };
  const os = require('os'), hostname = os.hostname;
  os.hostname = () => 'hub';   // the same fixture on every machine
  const req = require('../modules/harness/approval-explain').explain({ tool: 'shell', keys: ['shell:rm', 'shell:git'], summary: args.command }, 'shell', args,
    { reply: { content: 'The build log is stale. I will clear it and push the fix.' } });
  os.hostname = hostname;
  const owner = { ...H.owner.user, role: 'owner' };
  const ask = approval.askAnywhere({ ...req, personId: owner.id }, { client: { id: phone.id, kind: 'phone', formFactor: 'phone', user: owner } });
  await new Promise(r => setTimeout(r, 50));
  out['prompt.new-approval'] = last('prompt.new');
  approval.decide(ask.id, 'deny'); await ask.answer;
  reach.tell({ to: phone.id, title: 'The render finished', text: 'turbine-front.png is in the chat.' });
  out.alert = last('alert');
  // A notice with files (tell_device `files`): each a media block saying what it is, the phone's own copy.
  const at = n => { const p = path.join(H.tmp, n); fs.writeFileSync(p, Buffer.alloc(1024, 1)); return p; };
  reach.tell({ to: phone.id, title: 'Voice samples', files: [{ path: at('whisper.mp3'), caption: 'Italian — whisper' }, { path: at('notes.pdf') }] });
  out['alert-files'] = last('alert');
  // The look chosen on the phone's own panel page (Settings → Appearance in its web view): the app reads it again.
  require('../modules/screens').set(phone.id, { theme: 'pointsDaylight', skin: 'points' });
  out['settings.changed'] = last('settings.changed');
  // A new device that waited for approval (devices-approval/): allowed, and refused — caught live, since refusing
  // revokes it and empties its queue.
  const deciding = require('../modules/devices-approval'), devices = require('../modules/api-v1/devices');
  const waiting = name => {
    const d = devices.create({ name, scopes: require('../modules/api-v1/scopes').PRESETS.phone, caps: H.PHONE_CAPS, approval: { state: 'pending', askedAt: new Date().toISOString() } }).device;
    devices.update(d.id, { userId: H.owner.user.id });
    return d;
  };
  const allowed = waiting('Fixture new phone');
  deciding.decide(allowed.id, 'allow', { id: H.owner.user.id, role: 'owner' });
  out['device.approved'] = bus.drain(allowed.id, 0).events.find(e => e.type === 'device.approved');
  const refused = waiting('Fixture stranger');
  bus.subscribe(refused.id, 0, { send: env => { if (env.type === 'device.refused') out['device.refused'] = env; }, close() {} });
  deciding.decide(refused.id, 'refuse', { id: H.owner.user.id, role: 'owner' });
  return out;
}

// The same frames on every run, so an app's copy can be compared with the hub's: generated ids and the clock fixed.
// Times move together to a fixed start, keeping the gaps between them (a prompt still expires after it was made).
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/, FIXED = /^2026-10-06T1[89]:/;
function stable(frame) {
  const times = [];
  (function walk(v) { if (v && typeof v === 'object') Object.values(v).forEach(walk); else if (typeof v === 'string' && ISO.test(v) && !FIXED.test(v)) times.push(Date.parse(v)); })(frame);
  const from = Math.min(...times), base = Date.parse('2026-10-06T18:30:00.000Z');
  return (function map(v, key = '') {
    if (Array.isArray(v)) return v.map(x => map(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x, k)]));
    if (typeof v !== 'string') return v;
    if (/^\/api\/v1\/media\/med_/.test(v)) return '/api/v1/media/med_fixture';
    if (ISO.test(v) && !FIXED.test(v)) return new Date(base + (Date.parse(v) - from)).toISOString();
    if (/(^id$|Id$)/.test(key) && /^[a-z]+_[A-Za-z0-9]{6,}$/.test(v) && !/fixture/.test(v)) return `${v.split('_')[0]}_fixture`;
    return v;
  })(frame);
}

test(WRITE ? 'writes the fixtures from real frames' : 'the fixtures are present and every field is in the contract', async () => {
  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true });
    const f = await frames();
    for (const n of NAMES) {
      assert.ok(f[n], `no ${n} frame was published`);
      fs.writeFileSync(path.join(DIR, `${n}.json`), `${JSON.stringify(stable({ type: f[n].type, class: f[n].class, payload: f[n].payload }), null, 2)}\n`);
    }
    return;
  }
  const doc = require('../modules/api-v1/openapi').document();
  const find = (o, k) => (o && typeof o === 'object' ? (o[k] || Object.values(o).map(v => find(v, k)).find(Boolean)) : null);
  for (const n of NAMES) {
    const file = path.join(DIR, `${n}.json`);
    assert.ok(fs.existsSync(file), `${n}.json missing: npm run fixtures`);
    const frame = JSON.parse(fs.readFileSync(file, 'utf8'));
    const schema = find(doc, frame.type);
    const props = Object.keys(schema?.payload?.properties || {});
    assert.ok(props.length, `${frame.type} has an event schema`);
    assert.deepEqual(Object.keys(frame.payload).filter(k => !props.includes(k)), [], `${n}: fields the contract does not declare`);
  }
});

// Contracts that are not frames (TODO D2b): written beside them by the hub's own code, for the apps' tests to load.
//   pair-link    — the doca://pair link the panel's QR and POST /pair/code carry (DocaMobile's PairingQrParser reads it)
//   families     — the tool names per family a client lends (PROTOCOL §22.1, modules/api-v1/families.js)
//   doca-device  — what the panel calls on window.DocaDevice, where DocaMobile lends it (ambient.js)
//   call-frames  — the JSON frames of a live call and what each carries (realtime/index.js FRAMES; DocaWear draws them)
//   settings-look — GET /api/v1/settings/look for a phone drawn in Points Daylight (PROTOCOL §14.1; the app's own screens)
//   pending-approval — what a device waiting for approval is answered (PROTOCOL §5.1): the 403 everywhere, its own record
async function contracts() {
  const admin = H.mkDevice('Fixture admin', 'admin', {});
  const looked = H.mkDevice('Fixture look', 'phone', H.PHONE_CAPS);
  require('../modules/screens').set(looked.device.id, { theme: 'pointsDaylight', skin: 'points' });
  const look = (await H.api(looked.token, 'GET', '/api/v1/settings/look')).body;
  const code = await H.api(admin.token, 'POST', '/api/v1/devices/pair/start', { name: 'Fixture phone', preset: 'phone' });
  const qr = code.body.qr || '';
  const devices = require('../modules/api-v1/devices');
  const pend = devices.create({ name: 'Fixture waiting', scopes: require('../modules/api-v1/scopes').PRESETS.phone, caps: H.PHONE_CAPS,
    approval: { state: 'pending', askedAt: '2026-10-06T18:30:00.000Z' } });
  devices.update(pend.device.id, { userId: H.owner.user.id });
  return {
    'pair-link': { example: qr.replace(/code=[^&]+/, 'code=ABCD1234').replace(/host=[^&]*/, 'host=hub.example.ts.net:4242'),
      params: { code: 'the pairing code without its dash (8 characters)', host: 'host[:port] the phone dials, https' } },
    families: { canonical: require('../modules/api-v1/families').CANONICAL, decides: require('../modules/api-v1/families').DECIDES },
    'doca-device': { methods: { apps: { args: ['limit: number'], returns: 'a JSON string: [{package, label, icon?}]' }, open: { args: ['package: string'], returns: 'boolean' } } },
    'call-frames': { from: 'the hub, as JSON text frames on /api/v1/call and /api/v1/realtime (PROTOCOL §23.1)', frames: require('../modules/realtime').FRAMES,
      client: { stop: { fields: [], means: 'hang up' } } },
    'settings-look': { ...look, deviceId: 'dev_fixture' },
    'pending-approval': { refusal: { status: 403, ...(await H.api(pend.token, 'GET', '/api/v1/capabilities')).body },
      self: (await H.api(pend.token, 'GET', '/api/v1/devices/me')).body.approval,
      allowed: ['GET /api/v1/devices/me', 'GET /api/v1/events', 'POST /api/v1/events/ack'], events: [...require('../modules/api-v1/pending').EVENTS] },
  };
}
const CONTRACTS = ['pair-link', 'families', 'doca-device', 'call-frames', 'settings-look', 'pending-approval'];

test(WRITE ? 'writes the contracts' : 'the contracts are what the hub does now', async () => {
  const c = await contracts();
  for (const n of CONTRACTS) {
    const file = path.join(DIR, `${n}.json`);
    if (WRITE) { fs.writeFileSync(file, `${JSON.stringify(c[n], null, 2)}\n`); continue; }
    assert.ok(fs.existsSync(file), `${n}.json missing: npm run fixtures`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), c[n], `${n}.json is stale: npm run fixtures`);
  }
  // Both places the panel builds a pair link give the same shape the fixture shows.
  assert.match(c['pair-link'].example, /^doca:\/\/pair\?code=[A-Z0-9]{8}&host=[^&]+$/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'modules', 'devices-panel.js'), 'utf8'), /doca:\/\/pair\?code=\$\{p\.code\.replace\('-', ''\)\}&host=\$\{host\}/);
  // The panel calls on window.DocaDevice only what the contract lists.
  const used = new Set([...fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ambient.js'), 'utf8').matchAll(/(?:DocaDevice|dev)\??\.(\w+)\(/g)].map(m => m[1]));
  assert.deepEqual([...used].filter(m => !c['doca-device'].methods[m]), [], 'a DocaDevice method the contract does not list');
});

test('PROTOCOL §22.1 names the same tools as families.js', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'PROTOCOL.md'), 'utf8');
  const { CANONICAL } = require('../modules/api-v1/families');
  for (const [family, tools] of Object.entries(CANONICAL)) {
    const row = doc.split('\n').find(l => l.startsWith(`  | \`${family}\` |`));
    assert.ok(row, `§22.1 has a row for ${family}`);
    const canonical = [...row.split('|')[2].matchAll(/`(\w+)`/g)].map(m => m[1]).filter(n => n === family || n.startsWith(`${family}_`));   // not the prose's `image`
    assert.deepEqual(canonical, tools, `§22.1's ${family} row`);
  }
});

test('a sibling client checked out beside the hub lends only canonical tool names and the DocaDevice the panel calls', t => {
  const { CANONICAL, ALIASES } = require('../modules/api-v1/families');
  const known = new Set([...Object.values(CANONICAL).flat(), ...Object.keys(ALIASES)]);
  const walk = (dir, ext, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['build', 'bin', 'obj', 'test', 'tests', '.git', 'node_modules'].includes(e.name)) continue;
    const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, ext, out); else if (p.endsWith(ext)) out.push(p); } return out; };
  const family = /"((?:shell|files|screen|input|apps|processes|device|media)_[a-z_]+)"/g;
  for (const [app, sub, ext] of [['DocaMobile', 'app/src/main', '.kt'], ['DocaDesk', 'src', '.cs']]) {
    const dir = path.join(__dirname, '..', '..', app, sub);
    if (!fs.existsSync(dir)) { t.diagnostic(`${app} not checked out beside the hub`); continue; }
    const text = walk(dir, ext).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const names = [...new Set([...text.matchAll(family)].map(m => m[1]))].filter(n => !/_(capture|press|read)_[a-z]+$/.test(n));
    assert.deepEqual(names.filter(n => !known.has(n)), [], `${app} lends a tool name §22.1 does not have`);
    if (app === 'DocaMobile') {
      const methods = [...text.matchAll(/@JavascriptInterface\s+fun\s+(\w+)/g)].map(m => m[1]);
      const want = Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, 'doca-device.json'), 'utf8')).methods);
      assert.deepEqual(want.filter(m => !methods.includes(m)), [], 'window.DocaDevice lacks a method the panel calls');
    }
  }
});

test('a sibling app checked out beside the hub carries the current fixtures (skipped when it is not there)', t => {
  for (const app of ['DocaMobile', 'DocaWear']) {
    const dir = path.join(__dirname, '..', '..', app, 'core-doca', 'src', 'test', 'resources', 'hub-fixtures');
    if (!fs.existsSync(dir)) { t.diagnostic(`${app} not checked out beside the hub`); continue; }
    for (const f of fs.readdirSync(DIR)) {
      const theirs = path.join(dir, f);
      if (!fs.existsSync(theirs)) { t.diagnostic(`${app} has no ${f} yet`); continue; }
      assert.equal(fs.readFileSync(theirs, 'utf8'), fs.readFileSync(path.join(DIR, f), 'utf8'), `${app}'s hub-fixtures/${f} differs from the hub's: copy docs/api/fixtures over`);
    }
  }
});
