'use strict';

/**
 * Who is working now, and how far each is (workstream/workers.js, outside-agents/sessions.js; asked 2026-10-17). Two
 * sessions of one agent in one folder read apart by their own titles; one that keeps a todo list or a plan shows done
 * of total; one that keeps none shows what it did — edits, commands, commits — counted from its record; the folder a
 * command moves into names its repository; a file it edits is named after that session. Nothing asked of any agent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const fs = require('node:fs');
const path = require('node:path');

test.after(() => H.stop());

const line = (session, content, extra = {}) => JSON.stringify({ type: 'assistant', sessionId: session, cwd: H.tmp, timestamp: new Date().toISOString(), message: { content }, ...extra });
const call = (name, input, id = Math.random().toString(36).slice(2)) => ({ type: 'tool_use', id, name, input });

test('outside sessions read apart by title and repository, with their own progress or their counts', async () => {
  await H.start();
  const claude = require('../modules/outside-agents/claude'), sessions = require('../modules/outside-agents/sessions');
  sessions._reset();
  const repo = path.join(H.tmp, 'StatENS'); fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const a = {}, b = {};
  claude.parse(JSON.stringify({ type: 'ai-title', aiTitle: 'GitHub repositories audit', sessionId: 's-a' }), a);
  claude.parse(JSON.stringify({ type: 'ai-title', aiTitle: 'Horus event sources', sessionId: 's-b' }), b);
  const steps = [
    ...claude.parse(line('s-a', [call('Bash', { command: `cd ${repo} && python3 check.py` })]), a),
    ...claude.parse(line('s-a', [call('Edit', { file_path: path.join(repo, 'README.md') })]), a),
    ...claude.parse(line('s-a', [call('Bash', { command: 'git commit -q -m "x"' })]), a),
    ...claude.parse(line('s-b', [call('TodoWrite', { todos: [{ status: 'completed' }, { status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] })]), b),
    ...claude.parse(line('s-b', [call('Bash', { command: 'ls' })]), b),
  ];
  for (const s of steps) sessions.note(s, s.command || s.kind);
  const list = sessions.list();
  const sa = list.find(w => w.name.includes('GitHub repositories audit')), sb = list.find(w => w.name.includes('Horus event sources'));
  assert.ok(sa && sb, JSON.stringify(list));
  assert.equal(sa.where, 'StatENS', 'the folder its command moved into names the repository');
  assert.deepEqual([sa.activity.edits, sa.activity.commands, sa.activity.commits], [1, 2, 1]);
  assert.equal(sa.progress, null, 'no list of its own: only what it did');
  assert.deepEqual([sb.progress.done, sb.progress.total, sb.progress.percent, sb.progress.from], [2, 4, 50, 'its todo list']);
  assert.match(sessions.whoOf(steps[1]), /^Claude Code · GitHub repositories audit · StatENS$/, 'how its lines and edits are named');
});

test('a session resumed is named from the title near its end; task tools count as its list', async () => {
  const claude = require('../modules/outside-agents/claude'), sessions = require('../modules/outside-agents/sessions');
  const file = path.join(H.tmp, 'resumed.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Old name', sessionId: 's-c' })}\n${JSON.stringify({ type: 'ai-title', aiTitle: 'Fix the build', sessionId: 's-c' })}\n`);
  assert.equal(claude.head(file, {}).title, 'Fix the build');
  const m = { title: 'Fix the build' };
  for (const s of [
    ...claude.parse(line('s-c', [call('TaskCreate', { subject: 'a' }), call('TaskCreate', { subject: 'b' })]), m),
    ...claude.parse(line('s-c', [call('TaskUpdate', { taskId: '1', status: 'completed' })]), m),
  ]) sessions.note(s);
  const w = sessions.list().find(x => x.name.includes('Fix the build'));
  assert.deepEqual([w.progress.done, w.progress.total, w.progress.from], [1, 2, 'its task list']);
});

test('the Workstream answers who is working now', async () => {
  const r = await H.api(null, 'GET', '/api/workstream/workers');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.workers));
  assert.ok(r.body.workers.some(w => w.kind === 'outside' && /GitHub repositories audit/.test(w.name)));
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/workstream/workers', undefined, { Cookie: member.cookie })).status, 403, 'a host\'s, like the rest of the Workstream');
});
