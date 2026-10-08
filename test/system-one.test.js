'use strict';

/**
 * The System 1 decision model (experiment systemOne, docs/experiments/system-one.md): the decide client against a stub
 * that speaks TypeSafe's /v1/systemone wire (as laya-serve and Jev do), today's way deciding when the model is under
 * the threshold, nothing changing with the flag off, Jev's key sent only to its own address, and computer_next only on
 * the turn's own computer. No Python, no weights: the stub answers what each test sets.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)

let server, reply = () => ({});
const seen = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push({ url: req.url, auth: req.headers.authorization || '', body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'laya-rl-agent', answers: reply(body), usage: { input_tokens: 10, output_tokens: 0 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  process.env.DOCA_SYSTEM_ONE_URL = `http://127.0.0.1:${server.address().port}/v1/systemone`;
  process.env.DOCA_SYSTEM_ONE_KEY = 'stub-secret';
});
after(async () => { delete process.env.DOCA_SYSTEM_ONE_URL; delete process.env.DOCA_SYSTEM_ONE_KEY; server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });
beforeEach(() => { seen.length = 0; });

const one = () => require('../modules/system-one');
const experiments = () => require('../modules/experiments');
const flag = v => { experiments().setDeveloper(true); experiments().set('systemOne', v); experiments().set('adaptiveLimits', true); };
const choice = (probs, extra = {}) => { const [top] = Object.entries(probs).sort((a, b) => b[1] - a[1]); return { type: 'choice', choice: top[0], probabilities: probs, answer_confidence: top[1], confidence: 0.1, ...extra }; };

test('decide: DOCA\'s questions become the wire\'s map, with the bearer; the confidence is the top choice\'s probability', async () => {
  reply = () => ({ size: choice({ small: 0.1, medium: 0.2, large: 0.7 }), ok: { type: 'noul', noul: 0.9 } });
  const r = await one().decide({ state: 'Someone asks: build me a site', questions: [
    { id: 'size', type: 'choice', instructions: 'How big?', options: { small: 'tiny', medium: 'some', large: 'big' } },
    { id: 'ok', type: 'noul', instructions: 'Is it fine?' }] });
  assert.equal(seen[0].auth, 'Bearer stub-secret');
  assert.deepEqual(seen[0].body.questions.size, { type: 'choice', instructions: 'How big?', criteria: { small: 'tiny', medium: 'some', large: 'big' } });
  assert.equal(seen[0].body.questions.ok.criteria, undefined, 'a yes/no question carries no options');
  assert.equal(seen[0].body.model, 'english');
  assert.equal(r.answers.size.choice, 'large');
  assert.equal(r.answers.size.confidence, 0.7, 'answer_confidence, not the entropy measure');
  assert.equal(r.answers.ok.yes, 0.9); assert.equal(r.answers.ok.confidence, 0.9);
  await assert.rejects(one().decide({ state: 'x', questions: [{ id: 'q', type: 'guess' }] }), /choice, score or noul/);
});

test('the flag off: nothing is asked, the triage and the call\'s front decide as today, computer_next does not exist', async () => {
  flag(false);
  const front = require('../modules/harness/turn/front');
  const decisions = require('../modules/system-one/decisions');
  assert.equal(await decisions.size('Find every file that mentions invoice'), null);
  assert.equal(await decisions.route('Build me a website'), null);
  const wrist = { name: 'Wrist', mode: 'assistant' };
  for (const message of ['Turn on the lights', 'Build a whole app from scratch that tracks every plant in the garden, with a website'])
    assert.equal(JSON.stringify(await front.planned({ client: wrist, message })), JSON.stringify(front.plan({ client: wrist, message })));
  assert.equal(seen.length, 0, 'the model was never asked');
  assert.ok(require('../modules/harness/turn/tool-shape').switches().some(x => x.name === 'computer_next'));
});

test('under the threshold, today\'s way decides; at or over it, the model does', async () => {
  flag(true);
  const triage = require('../modules/harness/turn/triage'), front = require('../modules/harness/turn/front');
  const p = { maxSteps: 8 };
  const unsure = 'Find every file in the workspace that mentions the word invoice.';   // the rules say medium, unsure
  assert.equal(triage.rate({ message: unsure }).sure, false);
  reply = () => ({ size: choice({ small: 0.3, medium: 0.2, large: 0.5 }), pace: choice({ A: 0.5, B: 0.5 }) });
  let v = await triage.verdict({ message: unsure, p });
  assert.equal(v.difficulty, 'medium'); assert.equal(v.by, 'rules');
  reply = () => ({ size: choice({ small: 0.05, medium: 0.05, large: 0.9 }), pace: choice({ A: 0.1, B: 0.9 }) });
  v = await triage.verdict({ message: unsure, p });
  assert.equal(v.difficulty, 'large'); assert.match(v.by, /^System 1: laya/);
  assert.equal(v.steps, 32);
  seen.length = 0;
  await triage.verdict({ message: 'What is 17 × 23?', p });
  assert.equal(seen.length, 0, 'where the rules are sure, nothing is asked');

  const wrist = { name: 'Wrist', mode: 'assistant' };
  reply = () => ({ route: choice({ now: 0.45, later: 0.55 }) });
  assert.equal((await front.planned({ client: wrist, message: 'Set up a home media server on the spare machine.' })).delegate, false, 'unsure: the rules keep it in the call');
  reply = () => ({ route: choice({ now: 0.05, later: 0.95 }) });
  const sure = await front.planned({ client: wrist, message: 'Set up a home media server on the spare machine.' });
  assert.equal(sure.delegate, true); assert.match(sure.why, /System 1/);
  seen.length = 0;
  assert.equal((await front.planned({ client: wrist, message: 'Think harder about which laptop I should buy for music' })).deep, true);
  assert.equal(seen.length, 0, 'an explicit "think harder" is the person\'s words, never second-guessed');
  flag(false);
});

test('a model that fails or is slow: today\'s way, with no error reaching the turn', async () => {
  flag(true);
  const url = process.env.DOCA_SYSTEM_ONE_URL;
  process.env.DOCA_SYSTEM_ONE_URL = 'http://127.0.0.1:9/v1/systemone';   // nothing listens
  const v = await require('../modules/harness/turn/triage').verdict({ message: 'Find every file in the workspace that mentions the word invoice.', p: { maxSteps: 8 } });
  assert.equal(v.by, 'rules');
  process.env.DOCA_SYSTEM_ONE_URL = url;
  flag(false);
});

test('jev: the key for services goes only to TypeSafe\'s own address', async () => {
  const keys = require('../modules/service-keys'), { loadPrefs, savePrefs } = require('../modules/utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, systemOne: { provider: 'jev', jevKey: 'typesafe' } });
  const calls = [], real = global.fetch;
  global.fetch = async (url, o) => { calls.push({ url: String(url), auth: o.headers.Authorization }); return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'jev-1.13.0', answers: { q: { type: 'noul', noul: 0.8, confidence: 0.5 } } }) }; };
  try {
    await assert.rejects(one().decide({ state: 'x', questions: [{ id: 'q', type: 'noul', instructions: 'ok?' }] }), /No key named "typesafe"/);
    keys.save({ name: 'typesafe', origin: 'https://evil.example', key: 'k-123456' });
    await assert.rejects(one().decide({ state: 'x', questions: [{ id: 'q', type: 'noul', instructions: 'ok?' }] }), /only to https:\/\/evil.example/);
    keys.save({ name: 'typesafe', origin: 'https://api.typesafe.ai', key: 'k-123456' });
    const r = await one().decide({ state: 'x', questions: [{ id: 'q', type: 'noul', instructions: 'ok?' }] });
    assert.deepEqual(calls.at(-1), { url: 'https://api.typesafe.ai/v1/systemone', auth: 'Bearer k-123456' });
    assert.equal(r.provider, 'jev'); assert.equal(r.answers.q.yes, 0.8);
  } finally { global.fetch = real; keys.remove('typesafe'); savePrefs(prefs); }
});

const SNAP = `title: DOCA Panel\nurl: https://hub.example/\n\n${Array.from({ length: 23 }, (_, i) => `[${i + 1}] button:submit "B${i + 1}"`).join('\n')}\n[24] input:text "Search pages"\n\n--- text ---\nsome text`;

test('the browser: a page read as numbered elements, answered as a tournament, a field typed into', async () => {
  const b = require('../modules/system-one/browser');
  const page = b.parse(SNAP);
  assert.equal(page.elements.length, 24); assert.equal(page.title, 'DOCA Panel');
  reply = body => Object.fromEntries(Object.entries(body.questions).map(([id, q]) => {
    const keys = Object.keys(q.criteria);
    return [id, choice(Object.fromEntries(keys.map(k => [k, k === 'e24' ? 0.9 : 0.1 / (keys.length - 1)])))];
  }));
  const p = await b.propose({ goal: 'search for backups', snapshot: SNAP });
  assert.equal(seen.length, 2, 'round one: the groups in one call; round two: their winners');
  assert.equal(Object.keys(seen[0].body.questions).length, 3, 'groups of ten');
  assert.ok(Object.keys(seen[0].body.questions.g0.criteria).length <= b.GROUP);
  assert.match(seen[0].body.state, /I want to search for backups/);
  assert.equal(p.choices[0].ref, 24); assert.equal(p.choices[0].how, 'type');
  assert.match(b.say('search for backups', p), /\[24\] input:text "Search pages" — 90% → browser_type/);
});

test('computer_next: only on this conversation\'s own computer, and only while the experiment is on', async () => {
  const b = require('../modules/system-one/browser');
  assert.match(await b.next({ computer: 'abc', goal: 'open Settings' }, {}), /experiment that is off/);
  flag(true);
  const whose = require('../modules/computers/whose');
  const mcp = require('../modules/mcp/tools');
  const real = { of: whose.ofConversation, check: whose.check, call: mcp.call };
  const read = [];
  whose.ofConversation = sid => (sid === 'mine' ? ['c0ffee'] : []);
  whose.check = () => {};
  mcp.call = async name => { read.push(name); return SNAP; };
  reply = body => Object.fromEntries(Object.keys(body.questions).map(id => [id, choice(Object.fromEntries(Object.keys(body.questions[id].criteria).map((k, i) => [k, i === 0 ? 0.5 : 0.5 / (Object.keys(body.questions[id].criteria).length - 1)])))]));
  try {
    assert.match(await b.next({ computer: 'c0ffee', goal: 'open Settings' }, { sessionId: 'theirs' }), /not one this conversation works in/);
    assert.match(await b.next({ computer: 'deadbe', goal: 'open Settings' }, { sessionId: 'mine' }), /yours: c0ffee/);
    assert.equal(read.length, 0, 'another computer\'s page is never read');
    const said = await b.next({ computer: 'c0ffee', goal: 'open Settings' }, { sessionId: 'mine' });
    assert.deepEqual(read, ['mcp__computer-c0ffee__browser_snapshot']);
    assert.match(said, /It only proposes/);
    assert.match(said, /under the owner's threshold/, '0.5 is under the default 0.6');
  } finally { Object.assign(whose, { ofConversation: real.of, check: real.check }); mcp.call = real.call; flag(false); }
});

test('the panel: settings checked against their types, a test asked as DOCA would, all a host\'s', async () => {
  let r = await H.api(null, 'POST', '/api/system-one/settings', { threshold: 2 });
  assert.equal(r.status, 400);
  r = await H.api(null, 'POST', '/api/system-one/settings', { threshold: '0.75', provider: 'laya' });
  assert.equal(r.status, 200); assert.equal(r.body.settings.threshold, 0.75);
  assert.equal((await H.api(null, 'POST', '/api/system-one/settings', { provider: 'gpt' })).status, 400);
  reply = () => ({ size: choice({ small: 0.9, medium: 0.05, large: 0.05 }), pace: choice({ A: 0.8, B: 0.2 }), route: choice({ now: 0.8, later: 0.2 }) });
  r = await H.api(null, 'POST', '/api/system-one/test', { text: 'What time is it?' });
  assert.equal(r.status, 200);
  assert.equal(r.body.answers.size.choice, 'small'); assert.equal(r.body.answers.size.sure, true); assert.equal(r.body.answers.route.choice, 'now');
  r = await H.api(null, 'GET', '/api/system-one');
  assert.equal(r.body.service.state, 'stopped'); assert.equal(r.body.jev.present, false);
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/system-one', undefined, { Cookie: member.cookie, 'X-Doca-Password': '' })).status, 403);
  await H.api(null, 'POST', '/api/system-one/settings', { threshold: 0.6 });
});
