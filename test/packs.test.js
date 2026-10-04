'use strict';

// Packs (modules/packs, TODO H4): one .dpack (a zip) with every part in its own world's format — Agent Skills,
// subagent markdown, mcpServers JSON, recipes, memory JSONL, AGENTS.md — out of one hive and into another, and
// a zip of another tool's things read as it is. Nothing secret travels; nothing lands outside its folder.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

const upload = async (route, buffer, fields = {}) => {
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'p.dpack');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return H.api(null, 'POST', route, form);
};

test('a pack carries each kind in its native format, and no secret', async () => {
  const dir = path.join(require('../modules/store').dir('skills'), 'greet-skill');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: greet-skill\ndescription: Greets.\n---\n\nSay hello.\n');
  require('../modules/agents/registry').save({ id: 'packer', label: 'Packer', role: 'You pack.', kits: ['files'], tools: ['show_media'] });
  require('../modules/recipes/store').save({ title: 'Pack echo', steps: [{ tool: 'shell', args: { command: 'echo {x}' } }], params: [{ name: 'x', default: 'hi' }] });
  require('../modules/mcp/registry').upsert({ id: 'secretive', label: 'Secretive', transport: 'stdio', command: 'node', args: ['s.js'], env: { API_TOKEN: 'sk-real-secret', MODE: 'fast' } });
  require('../modules/harness/memory').memWrite({ key: 'pack.fact', value: 'packs travel', source: 'user' });

  const res = await fetch(`${H.base}/api/packs/export`, { method: 'POST', headers: { Cookie: H.owner.cookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ name: 'My pack', skills: ['greet-skill'], specialists: ['packer'], recipes: ['pack-echo'], mcp: ['secretive'], memory: true, rules: true }) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /My-pack\.dpack/);
  const buf = Buffer.from(await res.arrayBuffer());
  const files = Object.fromEntries(require('../modules/packs/zip').read(buf).map(f => [f.name, f.data.toString()]));
  const manifest = JSON.parse(files['pack.json']);
  assert.equal(manifest.format, 'dpack');
  assert.deepEqual(manifest.contents.map(c => c.kind).sort(), ['mcp', 'memory', 'recipe', 'rules', 'skill', 'specialist']);
  assert.match(files['skills/greet-skill/SKILL.md'], /^---\nname: greet-skill/);
  assert.match(files['agents/packer.md'], /^---\nname: packer/);
  assert.match(files['recipes/pack-echo.sh'], /^#!\/usr\/bin\/env bash/);
  const mcp = JSON.parse(files['mcp.json']).mcpServers.secretive;
  assert.deepEqual(mcp, { command: 'node', args: ['s.js'], env: { API_TOKEN: '', MODE: 'fast' } });
  assert.ok(!buf.toString('latin1').includes('sk-real-secret'), 'the secret is nowhere in the pack');
  assert.deepEqual(manifest.needs.secrets, ['mcp.secretive.env.API_TOKEN']);
  assert.match(files['memory.jsonl'], /"key":"pack\.fact"/);
  assert.match(files['AGENTS.md'], /^# Rules\n\n1\. /);
  fs.writeFileSync(path.join(require('node:os').tmpdir(), 'doca-test-pack.dpack'), buf);
});

test('bringing a pack in: a dry run first, then only what was chosen; what exists is kept unless replaced', async () => {
  const buf = fs.readFileSync(path.join(require('node:os').tmpdir(), 'doca-test-pack.dpack'));
  require('../modules/recipes/store').remove('pack-echo');
  require('../modules/mcp/registry').remove('secretive');
  const plan = await upload('/api/packs/plan', buf);
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.equal(plan.body.name, 'My pack');
  const keys = Object.fromEntries(plan.body.items.map(i => [i.key, i]));
  assert.equal(keys['recipe:pack-echo'].overwrites, false);
  assert.equal(keys['specialist:packer'].overwrites, true);
  assert.equal(keys['mcp:secretive'].command, 'node s.js');
  assert.deepEqual(plan.body.needs.secrets, ['mcp.secretive.env.API_TOKEN']);
  const done = await upload('/api/packs/import', buf, { only: JSON.stringify(['recipe:pack-echo', 'mcp:secretive', 'specialist:packer']) });
  const by = Object.fromEntries(done.body.done.map(d => [d.key, d]));
  assert.equal(by['recipe:pack-echo'].ok, true);
  assert.equal(by['mcp:secretive'].note, 'added, not started');
  assert.match(by['specialist:packer'].skipped, /exists here/);
  assert.equal(require('../modules/recipes/store').get('pack-echo').steps[0].args.command, 'echo {x}');
  assert.equal(require('../modules/mcp/registry').get('secretive').autostart, false);
  fs.rmSync(path.join(require('node:os').tmpdir(), 'doca-test-pack.dpack'), { force: true });
});

test('a zip of another tool\'s things is read as it is: an Agent Skills folder, a Claude Desktop config, CLAUDE.md rules', async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'foreign-pack.zip'));
  const plan = await upload('/api/packs/plan', buf);
  assert.equal(plan.body.native, true);
  assert.deepEqual(plan.body.items.map(i => i.key).sort(), ['mcp:filesystem', 'mcp:github', 'rules:CLAUDE.md', 'skill:pdf-tools']);
  assert.ok(plan.body.needs.secrets.includes('mcp.github.env.GITHUB_TOKEN'), 'an empty token is a secret to fill in');
  assert.deepEqual(plan.body.skipped.map(s => s.path), ['notes.txt']);
  const done = await upload('/api/packs/import', buf, { only: JSON.stringify(['skill:pdf-tools', 'rules:CLAUDE.md']) });
  assert.ok(done.body.done.every(d => d.ok), JSON.stringify(done.body));
  const skill = require('../modules/harness/skills').read('pdf-tools');
  assert.match(skill.body, /qpdf/);
  assert.deepEqual(skill.files, ['scripts/split.sh']);
  const rules = require('../modules/harness/memory').rules().rules;
  assert.ok(rules.includes('Answer in British English.') && rules.includes('Never push to main without asking.'));
  assert.ok(!rules.includes('Some prose that is not a rule.'));
  assert.equal(require('../modules/mcp/registry').get('filesystem'), null, 'not chosen, not added');
});

test('an entry that would land outside the pack\'s folder refuses the whole pack', async () => {
  const zip = require('../modules/packs/zip');
  const evil = zip.write([{ name: 'ok/SKILL.md', data: '---\nname: ok\n---\n' }, { name: '../../auth/users.json', data: '{}' }]);
  const r = await upload('/api/packs/plan', evil);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /outside the pack/);
  for (const n of ['/etc/passwd', 'C:/Windows/x', 'a/../../b']) assert.equal(zip.safeName(n), null, n);
  const member = await H.signIn('member', 'pack-member@test.local');
  assert.equal((await H.api(null, 'GET', '/api/packs/contents', undefined, { Cookie: member.cookie })).status, 403);
});
