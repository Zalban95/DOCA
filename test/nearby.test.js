'use strict';

/**
 * Machines → Nearby (modules/nearby): sources a host switches on (all off on a new install, never proposable), a scan
 * that asks only those and writes an activity line, things saved by place and room in DATA_DIR/nearby (not prefs) that
 * survive scans, removed with a way back, and the agent's `nearby` tool — there only once something is on or seen,
 * read-only by shape, a host's. The sources' readers are stood in for: nothing here touches the network or the radio.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test.before(() => H.start());
test.after(() => H.stop());

const sight = () => require('../modules/nearby/sightings');
const scan = () => require('../modules/nearby/scan');

// The readers, stood in for: a Cast speaker also in the ARP table, the router, and a Bluetooth headset.
function standIns() {
  const r = scan().READ;
  r.cast = async () => ({ list: [sight().cast({ type: '_googlecast._tcp', name: 'x', addresses: ['192.168.7.34'], port: 8009, txt: { id: 'C1', md: 'Google Nest Mini', fn: 'Study speaker' } })] });
  r.lan = async () => ({ list: [sight().lan({ ip: '192.168.7.34', mac: '00:f6:20:00:00:01', maker: 'Google' }), sight().lan({ ip: '192.168.7.1', mac: 'b8:27:eb:00:00:09', maker: 'Raspberry Pi', gateway: true })] });
  r.bluetooth = async () => ({ list: [], why: 'The Bluetooth adapter is off.' });
}

test('nothing is looked for until a host switches a source on; a member reaches none of it', async () => {
  const v = await H.api(null, 'GET', '/api/machines/nearby');
  assert.equal(v.status, 200);
  assert.ok(v.body.sources.length >= 7 && v.body.sources.every(s => s.on === false), 'every source starts off');
  assert.ok(v.body.sources.every(s => s.about.length > 30), 'each says what it looks at');
  const none = await H.api(null, 'POST', '/api/machines/nearby/scan', {});
  assert.equal(none.body.none, true);
  assert.ok(!require('../modules/nearby').any());
  assert.ok(require('../modules/harness/turn/tool-shape').switches().some(x => x.name === 'nearby'), 'the tool is not offered yet');
  const member = await H.signIn('member', 'nearby-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/machines/nearby', undefined, { Cookie: member.cookie })).status, 403);
  assert.equal((await H.api(null, 'POST', '/api/machines/nearby/sources', { id: 'lan', on: true }, { Cookie: member.cookie })).status, 403);
  assert.ok(!require('../modules/harness/settings').SETTABLE.some(p => p.prefix.startsWith('nearby')), 'never proposable');
  assert.equal((await H.api(null, 'POST', '/api/machines/nearby/sources', { id: 'nope', on: true })).status, 400);
});

test('a scan asks only the sources that are on, merges what they saw, and is a line in the activity log', async () => {
  standIns();
  for (const id of ['cast', 'lan', 'bluetooth']) assert.equal((await H.api(null, 'POST', '/api/machines/nearby/sources', { id, on: true })).status, 200);
  assert.equal(require('../modules/settings-schema').value('nearby.sources.lan'), true);
  const r = await H.api(null, 'POST', '/api/machines/nearby/scan', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.found, 2);
  const BT = process.platform !== 'win32';   // Windows has no Bluetooth source yet: the scan leaves it out and says so
  assert.deepEqual(r.body.bySource, BT ? { cast: 1, lan: 2, bluetooth: 0 } : { cast: 1, lan: 2 });
  if (BT) assert.equal(r.body.why.bluetooth, 'The Bluetooth adapter is off.');
  const speaker = r.body.seen.find(t => t.name === 'Study speaker');
  assert.equal(speaker.kind, 'speaker');
  assert.deepEqual(speaker.sources.sort(), ['cast', 'lan']);
  assert.equal(r.body.seen.find(t => t.mac === 'b8:27:eb:00:00:09').kind, 'router');
  const line = require('../modules/activity').list({ limit: 20 }).find(l => l.from === 'nearby');
  assert.match(line.what, /looked for things nearby: 2 found/);
  assert.match(line.why, BT ? /a person pressed Scan; with cast, lan, bluetooth/ : /a person pressed Scan; with cast, lan/);
  assert.ok(fs.existsSync(path.join(process.env.DOCA_DATA_DIR, 'nearby', 'seen.json')), 'kept in the data folder, not prefs');
  assert.ok(!JSON.stringify(require('../modules/utils').loadPrefs()).includes('Study speaker'));
});

test('saved by place and room; it survives scans, moves, goes with Undo, and exports and imports', async () => {
  const v = (await H.api(null, 'GET', '/api/machines/nearby')).body;
  const speaker = v.seen.find(t => t.name === 'Study speaker');
  const s = await H.api(null, 'POST', '/api/machines/nearby/saved', { seenId: speaker.id, name: 'Kitchen speaker', place: 'Home', room: 'Kitchen' });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.seenId, speaker.id);
  assert.equal((await H.api(null, 'POST', '/api/machines/nearby/saved', { seenId: speaker.id, name: 'Again', place: 'Home' })).status, 409, 'saved once');
  await H.api(null, 'POST', '/api/machines/nearby/scan', {});
  let now = (await H.api(null, 'GET', '/api/machines/nearby')).body;
  assert.equal(now.saved.length, 1);
  assert.deepEqual(now.places, [{ name: 'Home', rooms: ['Kitchen'] }]);
  assert.ok(now.saved[0].can.includes('cast'));
  const moved = await H.api(null, 'PUT', `/api/machines/nearby/saved/${s.body.id}`, { place: 'Lab', room: '' });
  assert.equal(moved.body.place, 'Lab');
  const exp = (await H.api(null, 'GET', '/api/machines/nearby/export')).body;
  assert.equal(exp.things.length, 1);
  const gone = await H.api(null, 'DELETE', `/api/machines/nearby/saved/${s.body.id}`);
  assert.equal(gone.body.thing.name, 'Kitchen speaker');
  assert.equal((await H.api(null, 'GET', '/api/machines/nearby')).body.saved.length, 0);
  assert.equal((await H.api(null, 'POST', '/api/machines/nearby/saved/restore', { thing: gone.body.thing })).status, 200);
  now = (await H.api(null, 'GET', '/api/machines/nearby')).body;
  assert.equal(now.saved[0].place, 'Lab', 'Undo brings it back as it was');
  assert.deepEqual((await H.api(null, 'POST', '/api/machines/nearby/import', exp)).body, { added: 0, skipped: 1 }, 'already saved');
  assert.equal((await H.api(null, 'POST', '/api/machines/nearby/import', { nope: 1 })).status, 400);
  const router = now.seen.find(t => t.kind === 'router');
  assert.equal((await H.api(null, 'DELETE', `/api/machines/nearby/seen/${router.id}`)).status, 200);
  assert.ok(!(await H.api(null, 'GET', '/api/machines/nearby')).body.seen.some(t => t.id === router.id), 'forgotten until seen again');
});

test('the agent: list, find and scan only — what is saved, where, and how to use it; a host\'s turn', async () => {
  const tools = require('../modules/harness/tools');
  const t = tools.TOOLS.find(x => x.name === 'nearby');
  assert.deepEqual(t.parameters.properties.action.enum, ['list', 'find', 'scan'], 'no save, forget, pair or switch');
  const owner = { ...H.owner.user, role: 'owner', orgId: H.owner.orgId };
  const call = args => tools.call('nearby', args, [], { user: owner, sessionId: null });
  const list = await call({ action: 'list' });
  assert.match(list, /Saved by the person:\n- Kitchen speaker — Lab \(speaker, Google Nest Mini, 192\.168\.7\.34; seen just now by cast, lan\): cast: `catt -d "Study speaker" cast <url>`/);
  assert.match(await call({ action: 'find', query: 'speaker lab' }), /Kitchen speaker/);
  assert.match(await call({ action: 'find', query: 'printer' }), /Nothing nearby matches/);
  assert.match(await call({ action: 'scan' }), process.platform !== 'win32'
    ? /^Scanned with cast, lan, bluetooth: 2 found \(cast 1, lan 2, bluetooth 0\)\. Not seen: bluetooth: The Bluetooth adapter is off\. `nearby`/
    : /^Scanned with cast, lan: 2 found \(cast 1, lan 2\)/);
  const member = await H.signIn('member', 'nearby-agent-member@test.local');
  assert.match(await tools.call('nearby', { action: 'list' }, [], { user: { ...member.user, role: 'member', orgId: member.orgId }, sessionId: null }), /^Error: .*does not hold host/);
  const inv = require('../modules/harness/turn/fits').inventory(new Set(['nearby']), owner);
  assert.match(inv, /# What you have\n- Things nearby, saved .*Kitchen speaker — Lab \[cast\]/);
  assert.equal(require('../modules/harness/turn/fits').inventory(new Set(['nearby']), { ...member.user, role: 'member' }), '', 'not in a member\'s readings');
  assert.ok(!require('../modules/harness/turn/tool-shape').switches().some(x => x.name === 'nearby'), 'offered once something is on');
});
