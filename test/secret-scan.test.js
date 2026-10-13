'use strict';

// The secret scanner (modules/secret-scan.js): what leaves the hive — a pack, a shared skill, a draft — is looked at
// for keys by shape. A finding is a line and a kind, never the value; placeholders and short strings are not findings.
// Every fake key here is made at run time from random characters, so this file holds none to be found.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

const scan = () => require('../modules/secret-scan');
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const rnd = (n, alpha = ALNUM) => [...crypto.randomBytes(n)].map(b => alpha[b % alpha.length]).join('');
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');

const FAKES = {
  google: () => `AI${'za'}${rnd(35)}`,
  openai: () => `s${'k'}-proj-${rnd(40)}`,
  github: () => `gh${'p'}_${rnd(36)}`,
  slack: () => `xo${'xb'}-${rnd(12, '0123456789')}-${rnd(24)}`,
  aws: () => `AK${'IA'}${rnd(16, UPPER)}`,
  jwt: () => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: rnd(12), iat: 1760000000 })}.${rnd(43)}`,
};

test('each kind is found on its line, and the value is never in a finding or the refusal', () => {
  for (const [kind, make] of Object.entries(FAKES)) {
    const value = make();
    const text = `# Notes\n\nUse it like this:\n  call(${JSON.stringify(value)})\n`;
    const found = scan().scan(text, { name: 'SKILL.md' });
    assert.deepEqual(found, [{ file: 'SKILL.md', line: 4, kind }], kind);
    assert.ok(!JSON.stringify(found).includes(value));
    assert.throws(() => scan().guardText(text, 'SKILL.md', 'The pack'), e => {
      assert.equal(e.status, 422); assert.equal(e.code, 'secret_found');
      assert.match(e.message, /SKILL\.md line 4/); assert.ok(!e.message.includes(value), `${kind} value echoed`);
      return true;
    });
  }
});

test('a PEM private key with a body, and a long random value given to a secret name', () => {
  const body = Array.from({ length: 4 }, () => rnd(64, `${ALNUM}+/`)).join('\n');
  const pem = `x\n-----BEGIN ${'PRIVATE'} KEY-----\n${body}\n-----END ${'PRIVATE'} KEY-----\n`;
  assert.deepEqual(scan().scan(pem), [{ line: 2, kind: 'pem' }]);
  assert.deepEqual(scan().scan(`config:\n  api_token: "${rnd(40)}"\n`), [{ line: 2, kind: 'assigned' }]);
  assert.deepEqual(scan().scan(`CLIENT_SECRET=${rnd(32, '0123456789abcdef')}\n`), [{ line: 1, kind: 'assigned' }]);
});

test('placeholders, examples and short or ordinary values are not findings', () => {
  const quiet = [
    'Set the key: sk-... (from your account page).',
    'OPENAI_API_KEY=YOUR_KEY_HERE_PLEASE_REPLACE_IT',
    `password: ${'•'.repeat(8)} and the token: ••••••••`,
    'api_key: "<your api key goes here>"',
    'token = process.env.GITHUB_TOKEN_FOR_THE_RELEASE',
    `AWS: AK${'IA'}IOSFODNN7EXAMPLE`,
    'secret: hunter2',
    'key: model.contextWindowTokens.default',
    'The task-management-and-planning-overview is long.',
    `-----BEGIN ${'PRIVATE'} KEY-----\n...\n-----END ${'PRIVATE'} KEY-----`,
    'sha: 0123456789abcdef',
    'keyboard_layout = "us-international-with-dead-keys"',
  ];
  for (const t of quiet) assert.deepEqual(scan().scan(t), [], t);
});

test('the files of a zip are scanned, binary ones skipped', () => {
  const zip = require('../modules/packs/zip');
  const buf = zip.write([{ name: 'a.md', data: 'plain words\n' }, { name: 'img.png', data: Buffer.from([0x89, 0x50, 0, 0, 1, 2]) },
    { name: 'skills/x/SKILL.md', data: `---\nname: x\n---\n\ntoken: ${FAKES.github()}\n` }]);
  assert.deepEqual(scan().scanZip(buf), [{ file: 'skills/x/SKILL.md', line: 5, kind: 'github' }]);
  assert.deepEqual(scan().scanFiles([{ name: 'b', data: Buffer.from([0, 1, 2]) }, { name: 'c', text: 'fine' }]), []);
});

test('a pack holding a skill with a key is refused, naming the file and line', async () => {
  const value = FAKES.openai();
  const dir = path.join(require('../modules/store').dir('skills'), 'leaky-skill');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: leaky-skill\ndescription: Leaks.\n---\n\nCall with OPENAI_API_KEY=${value}\n`);
  const res = await fetch(`${H.base}/api/packs/export`, { method: 'POST', headers: { Cookie: H.owner.cookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ name: 'Leaky', skills: ['leaky-skill'] }) });
  assert.equal(res.status, 422);
  const text = await res.text();
  assert.match(text, /skills\/leaky-skill\/SKILL\.md line 6/);
  assert.ok(!text.includes(value));
  // The agent's `pack` save and a kept library pack go through the same build.
  assert.throws(() => require('../modules/packs/export').build({ skills: ['leaky-skill'] }), /looks like a secret/);
  // Saving or bringing in such a skill is refused too.
  assert.throws(() => require('../modules/harness/skills').write('leaky-two', { description: 'x', body: `key: ${value}` }), e => e.status === 422);
  const [r] = require('../modules/harness/skills').importFrom(path.dirname(dir), { overwrite: true }).filter(x => x.name === 'leaky-skill');
  assert.match(r.skipped, /SKILL\.md line 6/);
});

test('the agent\'s service and MCP drafts refuse a key written into them', () => {
  const value = FAKES.google();
  assert.throws(() => require('../modules/mcp/drafts').draft({ name: 'maps', command: 'npx', args: ['maps-mcp', `--key=${value}`] }), e => e.status === 422 && !e.message.includes(value));
  assert.throws(() => require('../modules/service-drafts').draft({ name: 'maps', origin: 'https://maps.example.com', note: `use ${value}` }), e => e.status === 422);
  assert.equal(require('../modules/mcp/drafts').draft({ name: 'maps', command: 'npx', args: ['maps-mcp'], env: { MAPS_KEY: value } }).env.MAPS_KEY, '');
});
