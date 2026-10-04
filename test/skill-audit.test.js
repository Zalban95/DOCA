'use strict';

// A skill written for another harness is found, translated while read, and adapted on a click (skill-audit.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const skills = require('../modules/harness/skills');
const audit = require('../modules/harness/skill-audit');
const store = require('../modules/store');

const CC = `---
name: pr-review
description: Review a pull request
allowed-tools: Bash, Read, Grep
argument-hint: <pr number>
---

Review PR $ARGUMENTS.

!\`gh pr diff\`

1. Use the Bash tool to run the tests.
2. \`Read\` every changed file, and use Grep to find callers.
3. Track the findings with TodoWrite tool.
4. Bash is not mentioned as a tool here, nor is reading.
`;

before(async () => {
  await H.start();
  const put = (name, text) => { const d = path.join(store.dir('skills'), name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'SKILL.md'), text); };
  put('pr-review', CC);
  put('explain', '---\nname: explain\ndescription: Explain code\n---\nExplain {{args}} step by step.\n');
  put('native', '---\nname: native\ndescription: A DOCA skill\n---\nRun the tests with `shell`, read files with `read_file`.\n');
});
after(() => H.stop());

test('the dialect is found, with lines and the DOCA equivalent; a DOCA skill is ready', () => {
  const a = audit.audit('pr-review');
  assert.equal(a.status, 'adapt');
  assert.equal(a.label, 'Claude Code');
  const whats = a.findings.map(f => f.what);
  assert.ok(whats.includes('front matter "allowed-tools" (read by Claude Code only)'));
  assert.ok(a.findings.some(f => f.what === 'the Bash tool' && f.fix === 'shell' && f.line === 12));
  assert.ok(a.findings.some(f => f.what === 'the Read tool' && f.fix === 'read_file'));
  assert.ok(a.findings.some(f => f.what === 'the Grep tool' && f.fix === 'search_files'));
  assert.ok(a.findings.some(f => f.what === 'the TodoWrite tool' && f.fix === 'work_plan'));
  assert.ok(a.findings.some(f => /\$ARGUMENTS/.test(f.what)));
  assert.ok(a.findings.some(f => /gh pr diff/.test(f.what) && f.review), 'a ! command is for review, not rewritten');
  assert.equal(a.findings.filter(f => f.what === 'the Bash tool').length, 1, 'the plain word Bash on line 10 is not a tool');
  assert.equal(audit.audit('explain').label, 'Gemini CLI');
  assert.equal(audit.audit('native').status, 'ready');
});

test('until adapted, the manifest tags it and reading it carries the translation', () => {
  assert.match(skills.manifestBlock(), /- pr-review: Review a pull request \[written for Claude Code; reading it says how to translate\]/);
  assert.match(skills.manifestBlock(), /- native: A DOCA skill\n|- native: A DOCA skill$/m);
  const body = skills.read('pr-review').body;
  assert.match(body, /^\[Written for Claude Code, not adapted for DOCA yet\. Translate as you follow it: Bash → shell, Read → read_file/);
  assert.match(body, /Review PR \$ARGUMENTS/, 'the original text follows, untouched');
});

test('adapt previews, writes only on apply, keeps the original, and restore puts it back', async () => {
  const preview = await H.api(null, 'POST', '/api/harness/skills/pr-review/adapt', {});
  assert.equal(preview.status, 200);
  assert.equal(preview.body.applied, false);
  assert.match(preview.body.after, /1\. Use the shell tool to run the tests\./);
  assert.match(preview.body.after, /2\. `read_file` every changed file, and use search_files to find callers\./);
  assert.match(preview.body.after, /Review PR the user's request\./);
  assert.doesNotMatch(preview.body.after, /allowed-tools|argument-hint/);
  assert.match(preview.body.after, /adaptedFor: doca/);
  assert.match(preview.body.after, /4\. Bash is not mentioned/, 'plain words are left alone');
  assert.deepEqual(preview.body.remaining.map(f => Boolean(f.review)), [true], 'only the ! command is left, for a person');
  assert.equal(fs.readFileSync(path.join(store.dir('skills'), 'pr-review', 'SKILL.md'), 'utf8'), CC, 'nothing written by a preview');

  const applied = await H.api(null, 'POST', '/api/harness/skills/pr-review/adapt', { apply: true });
  assert.equal(applied.body.applied, true);
  assert.equal(skills.list().find(s => s.name === 'pr-review').harness, 'Claude Code', 'still flagged: the ! line needs a person');
  assert.ok(!skills.read('pr-review').files.includes('SKILL.original.md'), 'the kept original is not offered as a skill file');

  const restored = await H.api(null, 'POST', '/api/harness/skills/pr-review/restore', {});
  assert.equal(restored.status, 200);
  assert.equal(fs.readFileSync(path.join(store.dir('skills'), 'pr-review', 'SKILL.md'), 'utf8'), CC);
});

test('a shipped skill is not adapted, and adapting is the host\'s right', async () => {
  const shipped = await H.api(null, 'POST', '/api/harness/skills/write-a-skill/adapt', {});
  assert.equal(shipped.status, 400);
  const member = await H.signIn('member');
  const r = await H.api(null, 'POST', '/api/harness/skills/explain/adapt', { apply: true }, { Cookie: member.cookie });
  assert.equal(r.status, 403);
});
