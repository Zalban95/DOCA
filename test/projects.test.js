'use strict';

/**
 * Projects (modules/projects): a folder recognised for what it is, how it
 * builds and what it needs; git; search and replace across files; and a work
 * chat bound to it, whose shell and paths start at its root.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');

const H        = require('./helpers');
const projects = require('../modules/projects/store');
const { inspect } = require('../modules/projects/inspect');
const search   = require('../modules/projects/search');
const git      = require('../modules/projects/git');
const tools    = require('../modules/harness/tools');

test.before(() => H.start());
test.after(() => H.stop());

const mk = (root, files) => {
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), body);
  }
  return root;
};
const dir = name => fs.mkdtempSync(path.join(H.tmp, `${name}-`));

test('an Android project is recognised, with its Gradle commands and what they need', async () => {
  process.env.ANDROID_HOME = path.join(H.tmp, 'no-sdk-here');
  const root = mk(dir('android'), {
    'settings.gradle': "include ':app'",
    'app/build.gradle': "plugins { id 'com.android.application' }\nandroid { namespace 'x' }",
    'gradlew': '#!/bin/sh\necho gradle',
  });
  const r = await inspect(root);
  assert.equal(r.kinds[0].kind, 'android');
  const byName = Object.fromEntries(r.commands.map(c => [c.name, c]));
  assert.equal(byName.build.run, './gradlew assembleDebug');
  assert.equal(byName.test.run, './gradlew testDebugUnitTest');
  assert.ok(byName.install.needs.includes('adb'));
  assert.ok(byName.build.missing.includes('android-sdk'), 'no SDK where it looks: said, not hidden');
  assert.equal(r.kinds.some(k => k.kind === 'gradle'), false, 'an Android build is not also listed as plain Gradle');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 0' } }));
  const both = await inspect(root);
  assert.equal(both.commands.find(c => c.name === 'test').kind, 'android');
  assert.equal(both.commands.find(c => c.name === 'node:test').run, 'npm test', 'the second kind\'s test is still runnable');
});

test('a Node project\'s own scripts are its commands; the owner can add one; run waits and reports', async () => {
  const root = mk(dir('node'), { 'package.json': JSON.stringify({ scripts: { test: 'node -e 1', build: 'node -e 2' } }) });
  const r = await inspect(root);
  assert.deepEqual(r.commands.map(c => c.name).sort(), ['build', 'install', 'test']);
  assert.equal(r.commands.find(c => c.name === 'test').run, 'npm test');

  const p = projects.create({ root, name: 'Nodey' });
  assert.equal(projects.create({ root }).id, p.id, 'the same folder is the same project');
  projects.update(p.id, { commands: { hello: 'echo hello from $PWD' } });
  const out = await require('../modules/projects/run').run(p.id, 'hello', { waitSec: 10 });
  assert.equal(out.job.state, 'exited');
  assert.equal(out.job.code, 0);
  assert.match(out.output, new RegExp(`hello from ${root.replace(/[/\\]/g, '.')}`), 'run in the project root');
  await assert.rejects(require('../modules/projects/run').run(p.id, 'nope'), /not a command of Nodey/);
  assert.throws(() => projects.create({ root: '/etc' }), /outside the folders|not a folder/);
});

test('git: status, history, diffs and a file as it was — the same calls the panel and the agent make', async () => {
  const root = mk(dir('repo'), { 'a.txt': 'one\n', 'b.txt': 'bee\n' });
  const g = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'pipe' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 'T');
  g('add', '.'); g('commit', '-qm', 'first');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(root, 'new.txt'), 'new\n');

  let st = await git.status(root);
  assert.equal(st.branch, 'main');
  assert.deepEqual(st.files.map(f => [f.path, f.unstaged]).sort(), [['a.txt', 'M'], ['new.txt', '?']]);
  assert.match(await git.diff(root, { file: 'a.txt' }), /\+two/);
  assert.equal(await git.show(root, 'a.txt'), 'one\n', 'the version at HEAD, for the compare view');

  const c = await git.commit(root, 'second', { files: ['a.txt', 'new.txt'] });
  assert.equal(c.subject, 'second');
  assert.deepEqual((await git.log(root)).map(x => x.subject), ['second', 'first']);
  assert.deepEqual((await git.log(root, { file: 'b.txt' })).map(x => x.subject), ['first'], 'history of one file');
  st = await git.status(root);
  assert.equal(st.files.length, 0);
  assert.deepEqual((await git.branches(root)).map(b => [b.name, b.current]), [['main', true]]);
  await git.checkout(root, 'feature', { create: true });
  assert.deepEqual((await git.branches(root)).filter(b => b.current).map(b => b.name), ['feature']);
  await assert.rejects(git.checkout(root, '--force'), /Not a branch name/);

  const t = await tools.call('git', { action: 'log', path: root });
  assert.match(t, /second.*\n.*first/);
});

test('search in files: plain, regex, case, whole word, globs; skips what nobody means to search', async () => {
  const root = mk(dir('search'), {
    'src/Main.kt': 'val count = 1\nval counter = 2\nfun Count() {}\n',
    'src/util.js': 'let count = 3;\n',
    'node_modules/x/index.js': 'count count count\n',
    'bin.dat': Buffer.from([0, 1, 2, 99, 111, 117, 110, 116]),
  });
  for (const engine of ['rg', 'built-in']) {
    const which = require('../modules/shell').which;
    if (engine === 'built-in') require('../modules/shell').which = n => (n === 'rg' ? null : which(n));
    try {
      let r = await search.search(root, { query: 'count' });
      assert.equal(r.matches.length, 4, `${engine}: case-insensitive by default, node_modules and binaries skipped`);
      r = await search.search(root, { query: 'count', caseSensitive: true, wholeWord: true });
      assert.deepEqual(r.matches.map(m => `${m.file}:${m.line}:${m.col}`).sort(), ['src/Main.kt:1:5', 'src/util.js:1:5']);
      r = await search.search(root, { query: 'count(er)?\\b', regex: true, include: '*.kt' });
      assert.ok(r.matches.every(m => m.file.endsWith('.kt')));
    } finally { require('../modules/shell').which = which; }
  }
  await assert.rejects(search.search(root, { query: '(', regex: true }), /Not a valid regular expression/);
});

test('replace in files shows first, then writes; $1 in regex mode, a $ is a $ in plain text', () => {
  const root = mk(dir('replace'), { 'a.kt': 'val oldName = 1\nprint(oldName)\n', 'b.kt': 'oldName\n', 'c.txt': 'price: $5\n' });
  let r = search.replaceInFiles(root, { query: 'oldName', replacement: 'newName', dryRun: true });
  assert.equal(r.replacements, 3);
  assert.equal(r.written, false);
  assert.match(fs.readFileSync(path.join(root, 'a.kt'), 'utf8'), /oldName/, 'a dry run writes nothing');
  r = search.replaceInFiles(root, { query: 'oldName', replacement: 'newName', only: ['a.kt'] });
  assert.equal(r.files, 1);
  assert.equal(fs.readFileSync(path.join(root, 'a.kt'), 'utf8'), 'val newName = 1\nprint(newName)\n');
  assert.equal(fs.readFileSync(path.join(root, 'b.kt'), 'utf8'), 'oldName\n', 'only what was chosen');
  search.replaceInFiles(root, { query: 'val (\\w+) =', replacement: 'var $1 =', regex: true });
  assert.match(fs.readFileSync(path.join(root, 'a.kt'), 'utf8'), /^var newName = 1/);
  search.replaceInFiles(root, { query: '$5', replacement: '$6' });
  assert.equal(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'price: $6\n');
});

test('a work chat bound to a project works in it; its specialists too; its prompt carries the brief', async () => {
  const root = mk(dir('bound'), { 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }), 'README.md': 'hi\n' });
  const p = projects.create({ root, name: 'Bound app' });
  const r = await H.api(null, 'POST', `/api/projects/${p.id}/chat`);
  assert.equal(r.status, 200);
  const sid = r.body.sessionId;
  assert.equal((await H.api(null, 'POST', `/api/projects/${p.id}/chat`)).body.sessionId, sid, 'one work chat per project');

  assert.match(await tools.call('shell', { command: 'pwd' }, [], { sessionId: sid }), new RegExp(root.replace(/[/\\]/g, '.')));
  assert.match(await tools.call('read_file', { path: 'README.md' }, [], { sessionId: sid }), /hi/);
  const memory = require('../modules/harness/memory');
  const spec = memory.createSession('Helper', { activate: false, kind: 'specialist', parentId: sid });
  assert.equal(projects.forSession(spec.id).id, p.id, 'a specialist it dispatched works there too');

  const brief = await require('../modules/projects/brief').forSession(sid);
  assert.match(brief, /# Project: Bound app/);
  assert.match(brief, /Commands \(project action run\): install, test/);
  assert.match(brief, /search_files/);
  assert.equal(await require('../modules/projects/brief').forSession(memory.mainSession().id), '', 'nothing for a conversation outside projects');

  const prompt = require('../modules/harness/turn/prompt').systemPrompt({ p: require('../modules/harness/agent').params(), userText: '', summary: '', projectBrief: brief });
  assert.match(prompt, /# Project: Bound app/);
});

test('the routes are the host\'s', async () => {
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/projects', undefined, { Cookie: member.cookie })).status, 403);
  const root = mk(dir('routes'), { 'x.txt': 'needle\n' });
  const p = (await H.api(null, 'POST', '/api/projects', { root })).body.project;
  const d = await H.api(null, 'GET', `/api/projects/${p.id}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.git, null, 'not a repository: said, not an error');
  const s = await H.api(null, 'POST', `/api/projects/${p.id}/search`, { query: 'needle' });
  assert.equal(s.body.matches[0].file, 'x.txt');
});
