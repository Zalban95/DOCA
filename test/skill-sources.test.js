'use strict';

// Procedures from other harnesses become DOCA skills (modules/harness/skill-sources.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

const fakeHome = path.join(H.tmp, 'home');
const put = (rel, text) => { const f = path.join(fakeHome, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
let realHome, realProfile;

before(async () => {
  realHome = process.env.HOME; realProfile = process.env.USERPROFILE;
  process.env.HOME = process.env.USERPROFILE = fakeHome;
  put('.claude/skills/pdf-tables/SKILL.md', '---\nname: pdf-tables\ndescription: Pull tables out of PDFs.\n---\nUse pdfplumber.\n');
  put('.claude/plugins/cache/mkt/eng/1.0/skills/deploy-check/SKILL.md', '---\nname: deploy-check\ndescription: Before a deploy.\n---\nRun the checklist.\n');
  put('.claude/commands/Review PR.md', '---\ndescription: Review the current branch\n---\nRead the diff and list risks.\n');
  put('.codex/prompts/release-notes.md', '# Write release notes\n\nFrom git log since the last tag.\n');
  put('.gemini/commands/explain.toml', 'description = "Explain the selected code"\nprompt = """\nExplain {{args}} step by step.\n"""\n');
  put('proj/.cursor/rules/style.mdc', '---\ndescription: House style for TypeScript\nglobs: ["**/*.ts"]\n---\nNo default exports.\n');
  put('.codex/prompts/empty.md', '');
  await H.start();
});
after(async () => { process.env.HOME = realHome; process.env.USERPROFILE = realProfile; await H.stop(); });

test('each harness\'s own shape is found, named and described', async () => {
  const r = await H.api(null, 'GET', `/api/harness/skills/sources?project=${encodeURIComponent(path.join(fakeHome, 'proj'))}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.sources.map(s => [s.id, s.items]));
  assert.deepEqual(by['claude-skills'].map(i => i.name), ['pdf-tables']);
  assert.deepEqual(by['claude-plugins'].map(i => i.name), ['deploy-check'], 'nested plugin skills are found');
  assert.deepEqual(by['claude-commands'][0], { name: 'review-pr', description: 'Review the current branch', here: false });
  assert.equal(by['codex-prompts'].find(i => i.name === 'release-notes').description, 'Write release notes', 'no front matter: the first line');
  assert.ok(!by['codex-prompts'].some(i => i.name === 'empty'), 'an empty file is not offered');
  assert.deepEqual(by['gemini-commands'][0], { name: 'explain', description: 'Explain the selected code', here: false });
  assert.equal(by['cursor-rules'][0].description, 'House style for TypeScript');
});

test('importing makes them ordinary skills the agent loads; the originals are untouched', async () => {
  const skills = require('../modules/harness/skills');
  for (const source of ['claude-commands', 'gemini-commands', 'claude-plugins']) {
    const r = await H.api(null, 'POST', '/api/harness/skills/import', { source });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const review = skills.read('review-pr');
  assert.match(review.body, /Read the diff and list risks\./);
  assert.match(review.body, /Imported from Claude Code commands/);
  assert.match(skills.read('explain').body, /Explain \{\{args\}\} step by step\./);
  assert.match(skills.read('deploy-check').body, /Run the checklist/);
  assert.ok(fs.existsSync(path.join(fakeHome, '.claude/commands/Review PR.md')), 'the source file is still there');
  assert.match(skills.manifestBlock(), /- review-pr: Review the current branch/, 'and they reach the manifest');

  const again = await H.api(null, 'POST', '/api/harness/skills/import', { source: 'claude-commands' });
  assert.deepEqual(again.body.imported, [{ name: 'review-pr', skipped: 'exists here' }], 'nothing is overwritten unless asked');
  const listed = await H.api(null, 'GET', '/api/harness/skills/sources');
  assert.equal(listed.body.sources.find(s => s.id === 'claude-commands').items[0].here, true);
});

test('importing is the host\'s right, a project outside the allowed roots is refused, and a writing guide ships', async () => {
  const member = await H.signIn('member');
  const r = await H.api(null, 'POST', '/api/harness/skills/import', { source: 'codex-prompts' }, { Cookie: member.cookie });
  assert.equal(r.status, 403);
  const bad = await H.api(null, 'GET', '/api/harness/skills/sources?project=%2Fetc');
  assert.equal(bad.status, 400);
  const guide = require('../modules/harness/skills').read('write-a-skill');
  assert.equal(guide.source, 'shipped');
  assert.match(guide.body, /The description is the trigger/);
});

test('one search covers DOCA\'s skills and every other harness\'s, saying which are in DOCA', async () => {
  const r = await H.api(null, 'GET', '/api/harness/skills/search?q=release%20notes');
  assert.equal(r.status, 200);
  const top = r.body.results[0];
  assert.equal(top.name, 'release-notes');
  assert.equal(top.where, 'Codex prompts');
  assert.equal(top.inDoca, false);
  assert.match(top.snippet, /git log since the last tag/);
  const doca = await H.api(null, 'GET', '/api/harness/skills/search?q=specialist');
  assert.ok(doca.body.results.some(x => x.name === 'make-a-specialist' && x.where === 'DOCA (shipped)' && x.inDoca));
  const both = await H.api(null, 'GET', '/api/harness/skills/search?q=diff%20risks');
  assert.ok(both.body.results.some(x => x.name === 'review-pr' && x.where === 'DOCA (this machine)'), 'imported earlier, found in DOCA');
  assert.ok(both.body.results.some(x => x.name === 'review-pr' && x.where === 'Claude Code commands' && x.inDoca), 'and at its source, marked as already in');
  assert.deepEqual((await H.api(null, 'GET', '/api/harness/skills/search?q=')).body.results, []);
  const tool = await require('../modules/harness/tools').call('skill', { action: 'search', query: 'pdf tables' }, []);
  assert.match(tool, /pdf-tables — Claude Code skills/);
});

test('an imported skill named to climb out of the skills folder is refused (audit 2026-10-04)', async () => {
  put('.claude/skills/evil/SKILL.md', '---\nname: ../../escaped\ndescription: x\n---\nbody\n');
  const r = await H.api(null, 'POST', '/api/harness/skills/import', { source: 'claude-skills' });
  assert.equal(r.status, 200);
  const evil = r.body.imported.find(i => i.name === '../../escaped');
  assert.match(evil.skipped, /not a skill name/);
  const store = require('../modules/store');
  assert.equal(fs.existsSync(path.join(store.dir('skills'), '..', '..', 'escaped')), false);
});
