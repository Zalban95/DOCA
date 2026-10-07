'use strict';

// One decision for what the agent may do for a person (auth/permits.js, docs/design/permissions.md §3).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const permits = require('../modules/auth/permits');
const grants = require('../modules/auth/grants');
const levels = require('../modules/auth/levels');
const approval = require('../modules/harness/approval');

let member, admin, server, script = [];
const person = who => ({ ...who.user, role: who.role });

before(async () => {
  await H.start();
  member = await H.signIn('member');
  admin = await H.signIn('admin');
  levels.create({ name: 'Git only', rights: ['read', 'chat'], tools: { allow: ['shell:git', 'read_file'], deny: ['shell:rm'] }, approval: 'mode' }, { actorLevel: 'owner' });
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const next = script.shift() || { text: 'done' };
      const message = next.tool ? { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } : { content: next.text };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { pstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'pstub', model: 'm', fallbackChain: [], summarizeAfter: 0 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('the level decides: allowed, refused with why, and whether it asks', () => {
  const git = { ...member.user, role: 'git-only' };
  assert.deepEqual(permits.tool({ person: git, name: 'shell', args: { command: 'git status' } }), { allowed: true, ask: false, level: 'Git only' });
  const rm = permits.tool({ person: git, name: 'shell', args: { command: 'rm -rf x' } });
  assert.equal(rm.allowed, false);
  assert.match(rm.why, /Git only, does not allow shell:rm/);
  assert.equal(permits.tool({ person: person(member), name: 'write_file', args: { path: 'x' } }).ask, true, 'a member\'s calls are asked');
  assert.equal(permits.tool({ person: person(member), name: 'shell', args: { command: 'ls' } }).allowed, false, 'and the hub\'s command line is beyond a member\'s reach (auth/reach.js)');
  assert.equal(permits.tool({ person: person(admin), name: 'shell', args: { command: 'ls' } }).ask, false, 'an admin follows the panel\'s mode');
  assert.equal(permits.tool({ person: null, name: 'shell', args: { command: 'rm x' } }).allowed, true, 'no person: not narrowed (as before accounts)');
});

test('a grant is an exception: it widens the level, approve: removes the question, revoking takes it back', () => {
  const git = { ...member.user, role: 'git-only' };
  const g = grants.create({ subject: { kind: 'user', id: git.id }, permission: 'tool:shell:rm', by: { kind: 'user', id: H.owner.user.id } });
  assert.equal(permits.tool({ person: git, name: 'shell', args: { command: 'rm x' } }).allowed, true);
  grants.revoke(g.id);
  assert.equal(permits.tool({ person: git, name: 'shell', args: { command: 'rm x' } }).allowed, false);
  const a = grants.create({ subject: { kind: 'user', id: member.user.id }, permission: 'approve:shell:ls', by: { kind: 'user', id: H.owner.user.id } });
  assert.equal(permits.tool({ person: person(member), name: 'shell', args: { command: 'ls' } }).ask, false);
  grants.revoke(a.id);
  assert.equal(grants.covers('tool:shell', 'tool:shell:git'), true);
  assert.equal(grants.covers('tool:shell:git', 'tool:shell:rm'), false);
  assert.equal(grants.covers('setting:harness', 'setting:harness.config.doca.maxSteps'), true);
});

test('who may give: delegate is needed, never above your level, never what you do not hold', () => {
  assert.match(permits.mayGrant({ giver: person(member), subject: { kind: 'specialist', id: 'scribe' }, permission: 'tool:shell' }), /does not hold delegate/);
  assert.match(permits.mayGrant({ giver: person(admin), subject: { kind: 'user', id: H.owner.user.id }, permission: 'tool:shell' }), /level is above yours/);
  assert.equal(permits.mayGrant({ giver: person(admin), subject: { kind: 'user', id: member.user.id }, permission: 'tool:shell' }), null);
  const gitAgent = { ...member.user, role: 'git-only', agent: true };
  assert.match(permits.mayGrant({ giver: gitAgent, subject: { kind: 'mission', id: 'msn_x' }, permission: 'tool:shell:rm' }), /do not hold tool:shell:rm/, 'an agent delegates only what its person holds');
  assert.equal(permits.mayGrant({ giver: gitAgent, subject: { kind: 'mission', id: 'msn_x' }, permission: 'tool:shell:git' }), null);
});

test('a member\'s turn is asked even in Auto mode, and the member answers their own call (not another member)', async () => {
  approval.setMode('auto');
  const other = await H.signIn('member');
  const s = require('../modules/harness/memory').createSession('member turn', { activate: false });
  // write_file, not shell: a member's reach (own-devices, auth/reach.js) leaves the hub's command line to admins.
  script = [{ tool: 'write_file', args: { path: 'from-a-member.txt', content: 'from-a-member' } }, { text: 'done' }];
  const events = [];
  const turn = require('../modules/harness/agent').turn({ message: 'go', sessionId: s.id, emit: e => events.push(e),
    client: { name: 'Dashboard console', kind: 'dashboard', user: person(member) } });
  let asked;
  for (let i = 0; i < 100 && !asked; i++) { asked = events.find(e => e.type === 'approval' && e.state === 'asked'); if (!asked) await H.sleep(20); }
  assert.ok(asked, 'asked, though the panel is in Auto');
  assert.equal(asked.level, true);
  const stranger = await H.api(null, 'POST', `/api/harness/approvals/${asked.id}`, { decision: 'once' }, { Cookie: other.cookie });
  assert.equal(stranger.status, 403, 'another member cannot answer it');
  const own = await H.api(null, 'POST', `/api/harness/approvals/${asked.id}`, { decision: 'always' }, { Cookie: member.cookie });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  await turn;
  assert.match(events.find(e => e.type === 'tool_result').result, /from-a-member/);
  assert.ok(!approval.settings().always.some(k => k.startsWith('write_file')), 'their "always" did not touch the panel\'s allowlist');
  assert.ok(grants.list({ subjectKind: 'user', subjectId: member.user.id }).some(g => g.permission.startsWith('approve:write_file')), 'it became their own grant');
});

test('the Orchestrator grants its mission a tool; a specialist cannot grant; applying a proposal is bound to the level\'s settings', async () => {
  const missions = require('../modules/agents/missions');
  const store = require('../modules/store');
  const orch = require('../modules/harness/memory').createSession('orch', { activate: false });
  store.writeJson('agents/missions', { missions: [{ id: 'msn_grant', agentId: 'scribe', label: 'Scribe', by: orch.id, state: 'running', sessionId: 'spec' }] });
  const tools = require('../modules/harness/tools');
  const ok = await tools.call('permission_grant', { mission: 'msn_grant', permission: 'tool:shell:git', note: 'needs git log' }, [], { sessionId: orch.id, user: person(admin) });
  assert.match(ok, /^Granted tool:shell:git to msn_grant/);
  assert.deepEqual(permits.grantedTools({ profile: { id: 'scribe' }, missionId: 'msn_grant' }), ['shell']);
  assert.ok(require('../modules/agents/registry').NEVER.includes('permission_grant'), 'no specialist holds it');
  assert.match(await tools.call('permission_grant', { mission: 'msn_grant', permission: 'setting:paths' }, [], { sessionId: orch.id, user: person(admin) }), /a person's to give/);
  store.writeJson('agents/missions', { missions: [] });

  const settings = require('../modules/harness/settings');
  const made = settings.propose({ changes: [{ path: 'harness.config.doca.maxSteps', value: 9 }], reason: 'test' });
  const p = made?.proposal || made;
  assert.ok(p?.id, JSON.stringify(made));
  {
    levels.create({ name: 'Models only', rights: ['read', 'chat', 'propose'], settings: ['models'], tools: { allow: [] }, approval: 'ask' }, { actorLevel: 'owner' });
    const mo = await H.signIn('models-only');
    const r = await H.api(null, 'POST', `/api/harness/proposals/${p.id}/apply`, {}, { Cookie: mo.cookie });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /does not cover harness\.config\.doca\.maxSteps/);
  }
});

test('a symlink inside an allowed folder does not reach outside it (audit 2026-10-04)', () => {
  const { fmSafe } = require('../modules/utils');
  const inside = fs.mkdtempSync(path.join(H.tmp, 'root-'));
  const link = path.join(inside, 'escape');
  // A folder that exists outside every root on this OS (the Windows folder, or /etc).
  const outside = process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\Windows') : '/etc';
  try { fs.symlinkSync(outside, link, 'dir'); } catch { return; }   // no symlinks here (Windows without the right)
  assert.equal(fmSafe(inside), true);
  assert.equal(fmSafe(path.join(link, 'hostname')), false, 'through the link is outside');
});

test('approvals by device and by panel: Always and Approve all, offered by what the answerer may decide', async () => {
  const answer = require('../modules/harness/approval-answer');
  const req = { tool: 'shell', keys: ['shell:ls'], summary: 'ls', personId: member.user.id };
  const a = approval.ask(req, {}), b = approval.ask({ ...req, keys: ['shell:pwd'] }, {}), c = approval.ask({ ...req, personId: 'someone-else' }, {});
  const memberChoices = answer.deviceChoices(req, person(member)).map(x => x.id);
  assert.deepEqual(memberChoices, ['approve', 'always', 'approve_all', 'deny'], 'no Full auto without host');
  assert.ok(answer.deviceChoices(req, { ...H.owner.user, role: 'owner' }).some(x => x.id === 'full_auto'));
  assert.ok(!answer.deviceChoices({ tool: 'write_file', keys: null, forced: true }, person(admin)).some(x => x.id === 'always'), 'a forced question has no Always');
  assert.equal(answer.answerAs({ id: a.id, decision: 'approve_all', person: person(member) }), true);
  assert.equal(await a.answer, 'once'); assert.equal(await b.answer, 'once');
  assert.ok(approval.entry(c.id), 'someone else\'s request was not approved by the member\'s Approve all');
  assert.throws(() => answer.answerAs({ id: c.id, decision: 'once', person: person(member) }), /someone else's turn/);
  approval.decide(c.id, 'deny');
});

test('a host\'s "always" on a member\'s level-asked call is that member\'s grant, not the panel\'s allowlist (live test)', () => {
  const answer = require('../modules/harness/approval-answer');
  const q = approval.ask({ tool: 'shell', keys: ['shell:uname'], summary: 'uname', level: true, personId: member.user.id }, {});
  assert.equal(answer.answerAs({ id: q.id, decision: 'always', person: { ...H.owner.user, role: 'owner' } }), true);
  assert.ok(!approval.settings().always.includes('shell:uname'), 'the allowlist was not touched');
  const g = grants.list({ subjectKind: 'user', subjectId: member.user.id }).find(x => x.permission === 'approve:shell:uname');
  assert.ok(g, 'the member holds it now');
  assert.equal(permits.tool({ person: person(member), name: 'shell', args: { command: 'uname' } }).ask, false);
  grants.revoke(g.id);
});
