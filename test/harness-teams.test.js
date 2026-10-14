'use strict';

// Outside harnesses on a team (modules/harness-teams, modules/teams/outside.js; asked 2026-10-12). The first half needs
// nothing; the second runs a stand-in CLI (test/fixtures/harness-stub) in real agents' computers, so it needs Docker and
// the image doca/computer:1 and is skipped where they are absent — CI included. It removes every computer it made.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
process.env.DOCA_TEAM_POLL_MS = '1000';
const H = require('./helpers');

const SECRET = 'sk-ant-test-SECRET-4242-do-not-show';
let harnesses, teams, ready = false, tgz = null, repo = null, project = null;
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const waitFor = async (fn, ms, what) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await H.sleep(500); } };

before(async () => {
  await H.start();
  harnesses = require('../modules/harness-teams/harnesses');
  teams = require('../modules/teams');
  ready = await require('../modules/computers').imageReady();
});
after(async () => {
  const computers = require('../modules/computers');
  for (const c of computers.rows().filter(x => String(x.agentType || '').startsWith('harness:'))) await computers.remove(c.id).catch(() => {});
  if (tgz) fs.rmSync(path.dirname(tgz), { recursive: true, force: true });
  await H.stop();
});

/* ── Without Docker ───────────────────────────────────── */

test('each headless harness is run as its documented flags say, model included, and a model where there is no flag is refused', () => {
  const row = id => harnesses.all().find(r => r.id === id);
  assert.deepEqual(harnesses.argv(row('claude'), { task: 'do it', model: 'opus' }),
    ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', '--model', 'opus', 'do it']);
  assert.deepEqual(harnesses.argv(row('claude'), { task: 'do it' }), ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', 'do it']);
  assert.deepEqual(harnesses.argv(row('codex'), { task: 't', model: 'gpt-5-codex' }), ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-m', 'gpt-5-codex', 't']);
  assert.deepEqual(harnesses.argv(row('dsh'), { task: 't' }), ['headless', '--json', 't']);
  assert.throws(() => harnesses.argv(row('dsh'), { task: 't', model: 'x' }), /takes its model from its own settings/);
  assert.deepEqual(harnesses.argv(row('gemini'), { task: 't', model: 'gemini-2.5-pro' }), ['--approval-mode', 'yolo', '--output-format', 'stream-json', '-m', 'gemini-2.5-pro', '-p', 't']);
  assert.throws(() => harnesses.argv(row('claude'), { task: 't', model: 'opus; rm -rf /' }), /A model id/);
  assert.deepEqual(harnesses.offered().map(r => r.id), ['claude', 'codex', 'dsh', 'gemini'], 'only harnesses with a team form; cursor\'s curl installer is not one');
  for (const r of harnesses.offered()) assert.ok(harnesses.npmPackage(r), `${r.id} installs with npm into a computer`);
});

test('the owner\'s allow list narrows what may be summoned', () => {
  const prefs = require('../modules/utils');
  const p = prefs.loadPrefs();
  prefs.savePrefs({ ...p, teams: { ...(p.teams || {}), outside: { allow: ['dsh'] } } });
  try {
    assert.deepEqual(harnesses.offered().map(r => r.id), ['dsh']);
    assert.throws(() => harnesses.find('claude'), /not allowed to be summoned/);
  } finally { prefs.savePrefs(p); }
});

test('each CLI\'s own event stream is read mechanically: its commands, files, results and last words', () => {
  const ev = require('../modules/harness-teams/events');
  assert.deepEqual(ev.parse('claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })), [{ type: 'command', text: 'npm test' }]);
  assert.deepEqual(ev.parse('claude', JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'All done', total_cost_usd: 0.4 })), [{ type: 'final', ok: true, text: 'All done', cost: 0.4 }]);
  assert.deepEqual(ev.parse('codex', JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'ls' } })), [{ type: 'command', text: 'ls' }]);
  assert.equal(ev.parse('codex', JSON.stringify({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a.js', kind: 'update' }] } }))[0].path, 'a.js');
  assert.deepEqual(ev.parse('dsh', JSON.stringify({ type: 'tool_call', callId: 'c', tool: 'bash', input: { command: 'make' } })), [{ type: 'command', text: 'make' }]);
  assert.deepEqual(ev.parse('dsh', 'not json'), []);
  const tool = ev.parse('claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'x.md', content: 'secret text' } }] } }))[0];
  assert.deepEqual(tool.args, ['file_path'], 'arguments by name, never their content');
});

test('count makes several alike tasks that share the plan; what came after the counted task comes after every copy', () => {
  const s = teams.shape({ title: 'Five', tasks: [{ id: 'build', agent: 'harness:claude', model: 'opus', task: 'Build it', count: 3 }, { id: 'review', agent: 'work', task: 'Review', after: ['build'] }] }, { workChats: true });
  assert.deepEqual(s.tasks.map(t => t.id), ['build-1', 'build-2', 'build-3', 'review']);
  assert.deepEqual(s.tasks[3].after, ['build-1', 'build-2', 'build-3']);
  assert.equal(s.tasks[0].model, 'opus');
  assert.match(s.tasks[1].title, /\(2\/3\)/);
  assert.throws(() => teams.shape({ title: 'x', tasks: [{ agent: 'harness:nope', task: 't' }] }, { workChats: true }), /No outside harness "nope"/);
  assert.throws(() => teams.shape({ title: 'x', tasks: [{ agent: 'harness:dsh', model: 'v4', task: 't' }] }, { workChats: true }), /takes its model/);
});

test('a team uses an outside harness only when the person asked for it: unasked refused, asked allowed', async () => {
  const outside = require('../modules/teams/outside');
  const tasks = [{ id: 't1', agent: 'harness:claude', task: 'x' }];
  const p = { id: 'prj_x', name: 'p', root: os.tmpdir() };
  assert.throws(() => outside.gate(tasks, { asked: false, project: p }), e => e.status === 403 && /only when the person asked for it/.test(e.message));
  assert.throws(() => outside.gate(tasks, { asked: true, person: { id: 'u', role: 'member', name: 'M' }, project: p }), e => e.status === 403 && /does not hold host/.test(e.message));
  assert.throws(() => outside.gate(tasks, { asked: true }), /works on a project/);
  assert.doesNotThrow(() => outside.gate(tasks, { asked: true, person: { id: 'o', role: 'owner' }, project: p }));
  assert.doesNotThrow(() => outside.gate([{ agent: 'work' }], { asked: false }), 'a team of DOCA\'s own is untouched');
  // Through the tool: asked: true on a turn that is not the person's own (an automatic turn, a mission) is not an ask.
  const tool = require('../modules/harness/toolbox/teams').find(t => t.name === 'team');
  const lead = require('../modules/harness/memory').mainSession().id;
  const unasked = await tool.run({ action: 'create', title: 'T', asked: true, tasks }, { sessionId: lead, byPerson: false, user: H.owner?.user || null });
  assert.match(unasked, /Error: .*only when the person asked for it/);
  assert.ok(require('../modules/harness/turn/tool-calls').byPerson({ client: { user: { id: 'u' } }, isMission: true }) === false, 'a mission never counts as the person');
});

// A stand-in docker is a shell script that runs this very node: a POSIX host's way (Windows cannot run one by its path).
test('the key goes into the worker\'s environment by name only — never an argument', { skip: process.platform === 'win32' && 'a stand-in docker script needs a POSIX shell' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-fake-docker-'));
  const fake = path.join(dir, 'docker');
  fs.writeFileSync(path.join(dir, 'fake.js'), `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), has: process.env.ANTHROPIC_API_KEY === ${JSON.stringify(SECRET)} }));\n`);
  fs.writeFileSync(fake, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(dir, 'fake.js'))} "$@"\n`);
  fs.chmodSync(fake, 0o755);
  process.env.DOCA_CONTAINER_CLI = fake;
  try {
    const child = require('../modules/harness-teams/box').run({ id: 'abcd1234' }, { dir: '/home/agent/teams/w', bin: '/x/claude', args: ['-p', 'task'], env: { ANTHROPIC_API_KEY: SECRET }, pidfile: '/p' });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    await new Promise(r => child.on('close', r));
    const seen = JSON.parse(out);
    assert.ok(seen.has, 'the docker client has it in its environment');
    assert.ok(!seen.argv.join(' ').includes(SECRET), 'and no argument carries it');
    const i = seen.argv.indexOf('ANTHROPIC_API_KEY');
    assert.equal(seen.argv[i - 1], '-e');
    assert.ok(seen.argv.includes('doca-computer-abcd1234') && seen.argv.includes('setsid'));
  } finally { delete process.env.DOCA_CONTAINER_CLI; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a task\'s branch is team/<harness>-<task>-<words>, never one that exists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-branch-'));
  git(root, 'init', '-q', '-b', 'main'); git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one');
  const row = harnesses.all().find(r => r.id === 'claude');
  const name = await require('../modules/harness-teams').branchFor(root, row, { id: 'build-1', title: 'Build the landing page!' });
  assert.equal(name, 'team/claude-build-1-build-the-landing-page');
  git(root, 'branch', name);
  assert.equal(await require('../modules/harness-teams').branchFor(root, row, { id: 'build-1', title: 'Build the landing page!' }), `${name}-2`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('no agent acts on a harness team\'s computer, and the Orchestrator is told when a harness may be named', () => {
  const computers = require('../modules/computers');
  computers.save([...computers.rows(), { id: 'feed1234', name: 'Claude Code worker 1', agentType: 'harness:claude' }]);
  try {
    assert.match(require('../modules/computers/whose').refuse({ id: 'o', role: 'owner' }, 'feed1234'), /kept for claude team workers/);
  } finally { computers.save(computers.rows().filter(c => c.id !== 'feed1234')); }
  const table = require('../modules/harness/coordinator').routing({ held: new Set(['team']) });
  assert.match(table, /only when the person names one in their request/);
});

/* ── In real computers ────────────────────────────────── */

async function setup() {
  if (tgz) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-stub-pack-'));
  const file = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir, path.join(__dirname, 'fixtures', 'harness-stub')], { encoding: 'utf8' }).trim().split('\n').pop();
  tgz = path.join(dir, file);
  harnesses._extra.push({ id: 'stub', label: 'Stub CLI', kind: 'cli', cmd: 'stubcli', installCmd: `npm install -g ${tgz}`,
    team: { ...harnesses.all().find(r => r.id === 'claude').team } });
  repo = fs.mkdtempSync(path.join(process.env.WORKSPACE_DIR, 'proj-'));
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), '# A project\n');
  git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'start');
  project = require('../modules/projects/store').create({ root: repo, name: 'stubproj' });
  require('../modules/provider-keys').set('anthropic', { baseUrl: 'https://api.anthropic.com/v1', apiKey: SECRET, api: 'anthropic-messages', models: [] });
}

const lead = () => require('../modules/harness/memory').mainSession().id;
const doneTeam = id => waitFor(() => { const t = teams.get(id); return t && t.state !== 'running' ? t : null; }, 240000, `team ${id} to end`);

test('two stub workers in their own computers: commands seen, branches back on the hub, contracts checked, notes shared, key never kept', { timeout: 420000 }, async t => {
  if (!ready) return t.skip('no Docker image doca/computer:1 here');
  await setup();
  const team = await teams.create({ title: 'Stub pair', project: 'stubproj', tasks: [
    { id: 'w', agent: 'harness:stub', model: 'opus', task: 'Write the stub file', count: 2, done: 'the stub file exists', check: { file: 'STUB-Write-the-stub-file.md' } }] },
  { by: lead(), asked: true });
  const ended = await doneTeam(team.id);
  const v = teams.view(ended);
  assert.equal(ended.state, 'done', JSON.stringify(v.tasks.map(x => [x.id, x.state, x.why])));
  for (const task of v.tasks) {
    assert.match(task.place.branch, /^team\/stub-w-\d-write-the-stub-file-\d-2$/);
    assert.match(git(repo, 'log', '-1', '--format=%s', task.place.branch), /Stub work/);
    assert.match(fs.readFileSync(path.join(task.place.root, 'STUB-Write-the-stub-file.md'), 'utf8'), /stub opus key:present/, 'the CLI had its key, by name, and its model');
    const m = require('../modules/agents/missions').get(task.missionId);
    assert.equal(m.state, 'done'); assert.match(m.result, /Nothing is left/);
    assert.ok(require('../modules/agents/missions').events(task.missionId).some(e => e.type === 'tool_call' && /echo stub/.test(e.args?.command || '')), 'its commands are on its mission\'s log');
  }
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'the hub\'s checked-out branch is untouched');
  assert.ok((ended.notes || []).some(n => /the stub file is STUB/.test(n.text)), 'a note it appended reached the team');
  const ws = require('../modules/workstream').snapshot().activity;
  assert.ok(ws.some(r => r.kind === 'command' && /echo stub/.test(r.text)), 'the Workstream heard its commands');
  const computers = require('../modules/computers').rows().filter(c => c.agentType === 'harness:stub');
  assert.equal(computers.length, 2, 'one computer each');
  // The key: in no file of the data folder but the protected keys, the transcripts, logs or mission records.
  const grep = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'keys' ? [] : grep(p);
    try { return fs.readFileSync(p).includes(SECRET) ? [p] : []; } catch { return []; }
  });
  assert.deepEqual(grep(process.env.DOCA_DATA_DIR), [], 'the key is in no record');
  // Projects → Team branches: listed with what they add, and merged by the person's click.
  const list = await H.api(null, 'GET', `/api/projects/${project.id}/team-branches`);
  assert.equal(list.status, 200);
  assert.equal(list.body.branches.filter(b => b.by?.harness === 'stub').length, 2);
  const one = list.body.branches.find(b => b.by?.harness === 'stub');
  assert.ok(one.ahead >= 1 && /1 file/.test(one.stat), JSON.stringify(one));
  const diff = await H.api(null, 'GET', `/api/projects/${project.id}/team-branches/diff?branch=${encodeURIComponent(one.branch)}`);
  assert.ok(diff.body.files.some(f => f.path === 'STUB-Write-the-stub-file.md'));
  const merged = await H.api(null, 'POST', `/api/projects/${project.id}/team-branches/merge`, { branch: one.branch });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  assert.ok(fs.existsSync(path.join(repo, 'STUB-Write-the-stub-file.md')), 'merged into main');
});

test('Stop ends the CLI in its computer at once; what it committed still comes back', { timeout: 300000 }, async t => {
  if (!ready) return t.skip('no Docker image doca/computer:1 here');
  await setup();
  const team = await teams.create({ title: 'Slow one', project: 'stubproj', tasks: [{ id: 's', agent: 'harness:stub', task: 'SLOW work' }] }, { by: lead(), asked: true });
  const mid = await waitFor(() => teams.get(team.id)?.tasks[0]?.missionId, 30000, 'its mission');
  await waitFor(() => require('../modules/agents/missions').events(mid).some(e => e.type === 'tool_call'), 180000, 'the CLI at work');
  const r = await H.api(null, 'POST', `/api/harness/missions/${mid}/stop`);
  assert.equal(r.status, 200); assert.equal(r.body.stopped, true);
  const t0 = Date.now();
  await waitFor(() => require('../modules/agents/missions').get(mid).state !== 'running', 60000, 'the mission to end');
  assert.ok(Date.now() - t0 < 60000);
  assert.equal(require('../modules/agents/missions').get(mid).state, 'cancelled');
  const w = require('../modules/harness-teams/store').byMission(mid);
  const ps = await require('../modules/harness-teams/box').exec(require('../modules/computers').get(w.computer), ['sh', '-c', 'ps -eo args | grep -c "[s]tubcli" || true']);
  assert.equal(ps.stdout.trim(), '0', 'no stubcli process is left in the computer');
  assert.match(git(repo, 'log', '-1', '--format=%s', w.branch), /Stub work/, 'its commit came back');
  assert.equal(teams.get(team.id).state, 'failed');
});

test('with no key and no sign-in in its computer, the task fails saying how to sign in once', { timeout: 300000 }, async t => {
  if (!ready) return t.skip('no Docker image doca/computer:1 here');
  await setup();
  require('../modules/provider-keys').remove('anthropic');
  const team = await teams.create({ title: 'No key', project: 'stubproj', tasks: [{ id: 'k', agent: 'harness:stub', task: 'Write' }] }, { by: lead(), asked: true });
  const ended = await doneTeam(team.id);
  const why = teams.view(ended).tasks[0].why;
  assert.match(why, /needs signing in once/); assert.match(why, /Take over/);
});
