'use strict';

// The model scout (modules/scout; docs/experiments/model-scout.md): a look against a stub Hugging Face and feed —
// growth measured between looks, a release noticed — suggestions filed by the tool, accepted into a TODO.md, declined
// with a reason; nothing while the experiment is off.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const H = require('./helpers');

let srv, likes = 100;
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-scout-repo-'));
before(async () => {
  srv = http.createServer((req, res) => {
    if (req.url.startsWith('/api/models')) {
      const task = new URL(req.url, 'http://x').searchParams.get('pipeline_tag') || 'any';
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(task === 'automatic-speech-recognition' ? [{ id: 'acme/whisper-next', likes, downloads: 5000 }] : []));
    }
    if (req.url === '/feed.atom') return res.end(`<feed><entry><title>v2.0 &amp; faster</title><link href="https://example.com/r/2"/><updated>2026-10-05</updated></entry></feed>`);
    res.statusCode = 404; res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.DOCA_HF_API = `http://127.0.0.1:${srv.address().port}/api`;
  await H.start();
  const u = require('../modules/utils');
  u.savePrefs({ ...u.loadPrefs(), scout: { watch: [], feeds: [`http://127.0.0.1:${srv.address().port}/feed.atom`], repo, growthLikes: 50 } });
});
after(async () => { delete process.env.DOCA_HF_API; await H.stop(); await new Promise(r => srv.close(r)); fs.rmSync(repo, { recursive: true, force: true }); });

const has = () => require('../modules/harness/tools').schemas().some(t => t.function.name === 'scout');

test('off: no tool, no card, no routine', async () => {
  assert.equal(has(), false);
  assert.equal(await require('../modules/scout').tick(), null);
  assert.equal((await H.api(null, 'GET', '/api/scout')).body.experiment, false);
});

test('a look: the first sets the baseline; the next measures growth and notices news', async () => {
  const signals = require('../modules/scout/signals');
  const first = await signals.look();
  assert.equal(first.first, true);
  assert.deepEqual(first.notable, [], 'nothing to compare with: nothing is news');
  likes = 400;
  const second = await signals.look();
  const m = second.models.find(x => x.id === 'acme/whisper-next');
  assert.equal(m.gained, 300);
  assert.equal(m.fast, true);
  assert.deepEqual(m.roles, ['stt']);
  assert.ok(second.notable.some(n => n.kind === 'growing' && n.what === 'acme/whisper-next'));
  assert.match(signals.brief(second), /Speech to text[\s\S]*acme\/whisper-next · 400 likes \(\+300\)[\s\S]*GROWING FAST/);
  const third = await signals.look();
  assert.equal(third.fresh.length, 0, 'a news item is new once');
});

test('on: the tool files suggestions once each; a person accepts one into TODO.md and declines another', async () => {
  require('../modules/experiments').setDeveloper(true); require('../modules/experiments').set('modelScout', true);
  assert.equal(has(), true);
  const tools = require('../modules/harness/tools');
  const out = await tools.call('scout', { action: 'suggest', title: 'A faster speech-to-text', role: 'stt', candidate: 'acme/whisper-next', replaces: 'whisper large-v3-turbo', why: 'Half the latency at the same word error rate.', evidence: ['https://example.com/card'], tryWith: 'voiceServices.sttModel' });
  assert.match(out, /Filed S1/);
  assert.match(await tools.call('scout', { action: 'suggest', title: 'again', role: 'stt', candidate: 'ACME/whisper-next' }), /Filed S1/, 'the same candidate is the same card');
  await tools.call('scout', { action: 'suggest', title: 'A video model', role: 'new', candidate: 'acme/video' });
  assert.match(await tools.call('scout', { action: 'signals' }), /^⟦/, 'the look is outside words');

  fs.writeFileSync(path.join(repo, 'TODO.md'), '# TODO\n\n## Other\n\n- [ ] something\n');
  const a = await H.api(null, 'POST', '/api/scout/S1/accept', {});
  assert.equal(a.body.state, 'accepted');
  const todo = fs.readFileSync(path.join(repo, 'TODO.md'), 'utf8');
  assert.match(todo, /## Other\n\n- \[ \] something\n\n## Scout suggestions\n/);
  assert.match(todo, /- \[ \] \*\*S1\*\* A faster speech-to-text — stt \(replaces whisper large-v3-turbo\); candidate: acme\/whisper-next\./);
  const d = await H.api(null, 'POST', '/api/scout/S2/decline', { reason: 'no GPU room for video' });
  assert.equal(d.body.state, 'declined');
  assert.match(await tools.call('scout', { action: 'list' }), /S2 \[declined\] A video model .* — declined: no GPU room for video/);
  assert.equal((await H.api(null, 'POST', '/api/scout/S2/work', {})).status, 409, 'only accepted work starts');
  const member = await H.signIn('member', 'scout-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/scout/S1/accept', {}, { Cookie: member.cookie })).status, 403, 'a host\'s decisions');
});

test('a second accepted suggestion lands in the same section; a mission never holds the tool', async () => {
  const scout = require('../modules/scout');
  const s = scout.suggest({ title: 'A smaller embedder', role: 'embeddings', candidate: 'acme/embed-s', why: 'Same recall at a third of the size.' });
  scout.accept(s.id);
  const todo = fs.readFileSync(path.join(repo, 'TODO.md'), 'utf8');
  assert.equal(todo.match(/## Scout suggestions/g).length, 1);
  assert.ok(todo.indexOf('**S1**') < todo.indexOf(`**${s.id}**`));
  assert.ok(require('../modules/agents/registry').NEVER.includes('scout'));
});

test('the feed reader takes RSS and Atom', () => {
  const { feedItems } = require('../modules/scout/signals');
  assert.deepEqual(feedItems('<rss><item><title><![CDATA[Big news]]></title><link>https://x/1</link><pubDate>Mon</pubDate></item></rss>'), [{ title: 'Big news', link: 'https://x/1', date: 'Mon' }]);
  assert.equal(feedItems('<feed><entry><title>t</title><link href="https://x/2"/></entry></feed>')[0].link, 'https://x/2');
});
