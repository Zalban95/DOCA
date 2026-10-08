'use strict';

// Schedules (modules/schedules, TODO H7.1): a turn or a recipe on a timetable, as its person; one the agent
// proposes runs only once a person switches it on.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let model, script = [];
before(async () => {
  model = http.createServer((req, res) => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"stub-model"}]}'); }
    let raw = ''; req.on('data', d => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (body.stream === false) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'); }
      const next = script.shift() || { text: '(script exhausted)' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = next.tool ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } }] }
        : { choices: [{ delta: { content: next.text } }] };
      res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
});
after(async () => { await H.stop(); await new Promise(r => model.close(r)); });

test('every and cron say when next, the way cron does', () => {
  const { next, describe } = require('../modules/schedules/when');
  const from = new Date(2026, 9, 5, 8, 30, 15);   // Monday 5 Oct 2026, 08:30:15 local
  assert.equal(next({ every: 15 }, from).getTime(), from.getTime() + 15 * 60000);
  const at9 = next({ cron: '0 9 * * 1-5' }, from);
  assert.deepEqual([at9.getDate(), at9.getHours(), at9.getMinutes()], [5, 9, 0]);
  const sat = next({ cron: '30 7 * * 6' }, from);
  assert.deepEqual([sat.getDay(), sat.getHours(), sat.getMinutes()], [6, 7, 30]);
  const sun = next({ cron: '0 0 * * 7' }, from);
  assert.equal(sun.getDay(), 0, 'Sunday is 7 as well as 0');
  assert.equal(next({ cron: '0 0 * * 5-7' }, from).getDay(), 5, 'a range ending on 7 runs Friday to Sunday, not every day');
  const step = next({ cron: '*/20 * * * *' }, from);
  assert.equal(step.getMinutes(), 40);
  assert.throws(() => next({ cron: '0 9 * *' }), /five fields/);
  assert.throws(() => next({ cron: '61 * * * *' }), /outside 0–59/);
  assert.throws(() => next({ every: 0 }), /at least 1/);
  assert.equal(describe({ every: 1440 }), 'every 1 day');
  // Which clock it is read on is said: the hub's when the schedule has no zone (timezones.js).
  assert.match(describe({ cron: '0 9 * * 1-5' }), /^cron 0 9 \* \* 1-5 \(.*the hub's time\)$/);
  assert.equal(describe({ cron: '0 9 * * 1-5', tz: 'Europe/Rome' }), 'cron 0 9 * * 1-5 (Europe/Rome)');
});

test('a person\'s schedule is on; when due it starts a turn as them, in a conversation of its own', async () => {
  const made = await H.api(null, 'POST', '/api/schedules', { message: 'Report the disk use.', every: 60 });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.state, 'on');
  const s = require('../modules/schedules');
  script = [{ text: 'Disks are fine.' }];
  const due = await s.tick(new Date(Date.parse(made.body.nextAt) + 1000));
  assert.deepEqual(due, [made.body.id]);
  for (let i = 0; i < 100 && !s.get(made.body.id).last; i++) await H.sleep(30);
  const after = s.get(made.body.id);
  assert.equal(after.last.ok, true);
  assert.equal(after.last.summary, 'Disks are fine.');
  assert.ok(Date.parse(after.nextAt) > Date.parse(made.body.nextAt), 'the next run moved on');
  const rows = require('../modules/harness/memory').messages(after.sessionId);
  assert.equal(rows.find(r => r.role === 'user').content, 'Report the disk use.');
  assert.equal(require('../modules/harness/session-access').ownerOf(after.sessionId), H.owner.user.id, 'the conversation is the person\'s');
});

test('the agent proposes a schedule; it does not run until a person switches it on', async () => {
  const conv = require('../modules/harness/memory').createSession('sched agent', { activate: false });
  script = [{ tool: 'schedule', args: { action: 'propose', title: 'Morning check', message: 'Check the backups.', cron: '0 8 * * *' } }, { text: 'Proposed.' }];
  await require('../modules/harness/agent').turn({ message: 'check backups every morning', sessionId: conv.id,
    client: require('../modules/harness/turn/client').dashboardClient({ auth: { user: H.owner.user, role: 'owner' } }) });
  const s = require('../modules/schedules');
  const p = s.listFor({ id: H.owner.user.id, role: 'owner' }).find(x => x.title === 'Morning check');
  assert.equal(p.state, 'proposed');
  assert.equal(p.madeBy, 'agent');
  assert.ok(!(await s.tick(new Date(Date.parse(p.nextAt) + 1000))).includes(p.id), 'a proposed schedule never fires');
  assert.equal((await H.api(null, 'POST', `/api/schedules/${p.id}/state`, { state: 'on' })).body.state, 'on');
  assert.ok(require('../modules/agents/registry').NEVER.includes('schedule'), 'a specialist never schedules');
});

test('a member sees and changes only their own schedules', async () => {
  const member = await H.signIn('member', 'sched-member@test.local');
  const theirs = await H.api(null, 'POST', '/api/schedules', { message: 'Mine.', every: 30 }, { Cookie: member.cookie });
  assert.equal(theirs.status, 200);
  const list = await H.api(null, 'GET', '/api/schedules', undefined, { Cookie: member.cookie });
  assert.deepEqual(list.body.schedules.map(s => s.id), [theirs.body.id]);
  const ownerOnes = (await H.api(null, 'GET', '/api/schedules')).body.schedules.filter(s => s.by === H.owner.user.id);
  assert.equal((await H.api(null, 'POST', `/api/schedules/${ownerOnes[0].id}/state`, { state: 'paused' }, { Cookie: member.cookie })).status, 404);
  assert.equal((await H.api(null, 'DELETE', `/api/schedules/${theirs.body.id}`, undefined, { Cookie: member.cookie })).status, 200);
});

test('a reminder the person asked for is on at once, fires once on their own devices, and is done (2026-10-07)', async () => {
  const schedules = require('../modules/schedules');
  const devices = require('../modules/api-v1/devices');
  const bus = require('../modules/api-v1/bus');
  const mine = H.mkDevice('Owner watch', 'watch', H.WATCH_CAPS).device;
  devices.update(mine.id, { userId: H.owner.user.id });
  const other = H.mkDevice('Someone else', 'watch', H.WATCH_CAPS).device;
  const out = await require('../modules/harness/tools').call('remind', { text: 'Call Marco', in: 1 }, [], { user: { ...H.owner.user, role: 'owner' } });
  assert.match(out, /Reminder sch_\w+ set for .*Call Marco/);
  const r = schedules.listFor({ ...H.owner.user, role: 'owner' }).find(x => x.kind === 'reminder');
  assert.equal(r.state, 'on', 'no click: they asked');
  await schedules.runNow(r.id);
  assert.equal(schedules.get(r.id).state, 'done');
  const alerts = d => bus.drain(d.id, 0).events.filter(e => e.type === 'alert' && JSON.stringify(e.payload).includes('Call Marco'));
  assert.equal(alerts(mine).length, 1);
  assert.equal(alerts(other).length, 0, 'never another person\'s device');
  assert.match(await require('../modules/harness/tools').call('remind', { text: 'x', at: '2001-01-01T00:00' }, [], { user: H.owner.user }), /not ahead/);
});
