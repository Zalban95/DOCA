'use strict';

// A call that feels alive and quick (2.304.0; asked 2026-10-07 from the watch): the front — a spoken turn answers at
// once with a short kit, or hands the request to a work chat before any model is asked (turn/front.js); what lands in
// the conversation while the call is open is said in it (realtime/calls.js); the answer is spoken while the model is
// still writing it, and the call's frames say each state (heard, background, report).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const WebSocket = require('ws');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

let modelServer, voice, watch, script = [];
const bodies = [];
/** A scripted reply: its pieces streamed with a pause between them, so a test can see the first sentence played early. */
function reply(res, { parts = ['(script exhausted)'], gapMs = 0 } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  let i = 0;
  const next = () => {
    if (i >= parts.length) return res.end('data: [DONE]\n\n');
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
    setTimeout(next, i === 1 ? gapMs : 0);
  };
  next();
}
const tone = (ms, amp = 6000) => { const b = Buffer.alloc(ms * 48); for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(amp * Math.sin(i / 5)), i * 2); return b; };
const quiet = ms => tone(ms, 30);
let transcript = 'Turn on the lights.';

before(async () => {
  modelServer = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d));
    req.on('end', () => { try { bodies.push(JSON.parse(Buffer.concat(chunks))); } catch { /* not JSON */ } reply(res, script.shift()); });
  });
  await new Promise(r => modelServer.listen(0, '127.0.0.1', r));
  voice = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/v1/models') return res.end('{"data":[]}');
      if (req.url === '/v1/audio/transcriptions') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ text: transcript })); }
      if (req.url === '/v1/audio/speech') return res.end(Buffer.alloc(4800));
      res.statusCode = 404; res.end();
    });
  });
  await new Promise(r => voice.listen(0, '127.0.0.1', r));
  process.env.DOCA_STT_URL = process.env.DOCA_TTS_URL = `http://127.0.0.1:${voice.address().port}`;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { stub: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, apiKey: 'k', models: ['stub-model'] } } } }));
  await H.start();
  require('../modules/terminal').setup(H.server());
  await H.api(null, 'POST', '/api/harness/doca/config', { provider: 'stub', model: 'stub-model' });
  watch = H.mkDevice('Wrist', 'watch', H.WATCH_CAPS);
});
after(async () => { delete process.env.DOCA_STT_URL; delete process.env.DOCA_TTS_URL; await H.stop(); modelServer.close(); voice.close(); });

/** Open a call as the watch; `until(frames)` decides when it has seen enough. Resolves with the frames and their times. */
function call({ until, speak = true, onOpen = () => {} }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${H.base.replace(/^http/, 'ws')}/api/v1/call`, { headers: { Authorization: `Bearer ${watch.token}` } });
    const g = { json: [], at: {}, audio: 0, firstAudioAt: null, t0: Date.now() };
    const timer = setTimeout(() => { ws.close(); reject(new Error(JSON.stringify(g.json))); }, 15000);
    ws.on('message', (d, bin) => {
      if (bin) { g.audio += d.length; g.firstAudioAt = g.firstAudioAt || Date.now(); }
      else { const f = JSON.parse(d); g.json.push(f); g.at[f.type] = g.at[f.type] || Date.now(); }
      if (!bin && g.json.at(-1).type === 'ready') {
        onOpen(g.json[0].sessionId, ws);
        if (speak) { for (let i = 0; i < 8; i++) ws.send(tone(100)); ws.send(quiet(1200)); }
      }
      if (until(g)) { clearTimeout(timer); ws.close(); resolve(g); }
    });
    ws.on('error', reject);
  });
}

test('the front: a spoken turn holds a short kit, thinks at assistant mode\'s effort and is not triaged', () => {
  const front = require('../modules/harness/turn/front');
  const wrist = { name: 'Wrist', mode: 'assistant' };
  assert.equal(front.plan({ client: { name: 'Panel' }, message: 'Turn on the lights' }), null, 'a typed turn is not a front turn');
  assert.equal(front.plan({ client: wrist, message: 'x', profile: { id: 'tester', tools: [] } }), null, 'a specialist is never one');
  const p = front.plan({ client: wrist, message: 'Turn on the lights' });
  assert.equal(p.delegate, false); assert.equal(p.steps, front.STEPS);
  const off = new Set(p.off([]));
  for (const held of ['remind', 'memory_write', 'tell_device', 'work_chats', 'effort']) assert.ok(!off.has(held), `${held} is held`);
  for (const not of ['shell', 'write_file', 'git', 'computer']) assert.ok(off.has(not), `${not} is not`);
  const deep = front.plan({ client: wrist, message: 'Think harder about which laptop I should buy for music' });
  assert.equal(deep.delegate, true); assert.equal(deep.deep, true);
  assert.equal(front.plan({ client: wrist, message: 'Prenditi il tempo e confronta i tre preventivi della cucina' }).deep, true);
  assert.equal(front.plan({ client: wrist, message: 'think harder' }).delegate, false, 'just "think harder" is answered: there is nothing to hand on');
  assert.equal(front.plan({ client: wrist, message: 'Build a whole app from scratch that tracks every plant in the garden, with a website' }).delegate, true);
  assert.equal(front.plan({ client: wrist, message: 'Turn on focus mode' }).delegate, false, 'a "focus" that is not about thinking stays in the call');
});

test('a call\'s quick request: the watch is assistant mode, the model gets the short kit, the first sentence plays before the last is written', async () => {
  bodies.length = 0;
  transcript = 'Turn on the lights.';
  script = [{ parts: ['Sure, the lights. ', 'They are on now.'], gapMs: 1200 }];
  const g = await call({ until: g => g.json.some(f => f.type === 'done') });
  const types = g.json.map(f => f.type);
  assert.ok(types.indexOf('heard') < types.indexOf('user'), 'heard comes the moment speech ends, before the words');
  assert.ok(types.indexOf('user') < types.indexOf('working'));
  const tools = (bodies[0].tools || []).map(t => t.function.name);
  assert.ok(tools.includes('remind') && !tools.includes('shell') && !tools.includes('write_file'), `the front's kit: ${tools.join(', ')}`);
  assert.ok(String(bodies[0].messages[0].content).includes('quick voice of this call'), 'the front is told what it is');
  const firstAt = g.json.findIndex(f => f.type === 'agent');
  assert.equal(g.json[firstAt].text.trim(), 'Sure, the lights.');
  assert.ok(g.firstAudioAt - g.at.heard < 1000, `first audio ${g.firstAudioAt - g.at.heard} ms after speech ended — before the model finished writing (1.2 s later)`);
  assert.deepEqual(g.json.filter(f => f.type === 'agent').map(f => f.text.trim()), ['Sure, the lights.', 'They are on now.']);
  const sid = g.json[0].sessionId;
  assert.equal(sid, require('../modules/harness/memory').mainSession().id, 'a host\'s call goes where their typed messages go');
  const user = require('../modules/harness/memory').messages(sid).filter(m => m.role === 'user').at(-1);
  assert.equal(user.from.formFactor, 'watch');
});

test('"think harder about…" goes to a work chat before any model is asked; the call says one line and shows it working', async () => {
  bodies.length = 0;
  transcript = 'Think harder about which laptop I should buy for music production.';
  script = [];
  const memory = require('../modules/harness/memory');
  const before = new Set(memory.listSessions().sessions.map(s => s.id));
  const g = await call({ until: g => g.json.some(f => f.type === 'done') });
  assert.equal(bodies.filter(b => String(b.messages?.[0]?.content).includes('quick voice of this call')).length, 0, 'the call asked no model');
  const bg = g.json.find(f => f.type === 'background');
  assert.ok(bg && bg.sessionId, 'a background frame names the work chat');
  assert.match(g.json.filter(f => f.type === 'agent').map(f => f.text).join(''), /take my time/);
  const chat = memory.getSession(bg.sessionId);
  assert.ok(!before.has(chat.id)); assert.equal(chat.kind, 'work'); assert.equal(chat.effort, 'high', 'it thinks hard there, not in the call');
  for (let i = 0; i < 50 && require('../modules/harness/agent').isRunning(chat.id); i++) await H.sleep(50);
});

test('what lands in the conversation while the call is open is said in it — and only to its own person', async () => {
  const calls = require('../modules/realtime/calls');
  const memory = require('../modules/harness/memory');
  transcript = '';
  let chatId = null;
  const g = await call({
    speak: false,
    onOpen: sid => setTimeout(() => {
      calls.landed(sid, { text: 'Your two work chats reported. The backup finished.' });   // an automatic turn there
      const chat = require('../modules/harness/organization').create({ title: 'Render the logo' });
      memory.updateSession(chat.id, { parentId: 'elsewhere' });   // reports somewhere no woken turn will say it
      chatId = chat.id;
      calls.follow(sid, chat.id);
      require('../modules/harness/organization').report(chat.id, 'done', 'The logo is rendered. It is in the chat as logo.png.');
      // A mission this conversation dispatched itself (its index row, as missions.js keeps it), finishing.
      const store = require('../modules/store'), doc = store.readJson('agents/missions', { missions: [] });
      store.writeJson('agents/missions', { missions: [...doc.missions, { id: 'msn_call', agentId: 'researcher', label: 'Researcher', by: sid, state: 'done', result: 'Three laptops fit. The lightest is 1.1 kg.' }] });
      require('../modules/live').changed('missions', 'msn_call', 'done');
      require('../modules/live').changed('missions', 'msn_call', 'done');   // seen later: said once
    }, 50),
    until: g => g.json.filter(f => f.type === 'done').length >= 3,
  });
  const reports = g.json.filter(f => f.type === 'report').map(f => f.text);
  assert.deepEqual(reports, ['the hive', 'Render the logo', 'Researcher']);
  assert.match(g.json.filter(f => f.type === 'agent').map(f => f.text).join(' '), /Researcher finished\./);
  const said = g.json.filter(f => f.type === 'agent').map(f => f.text.trim()).join(' ');
  assert.match(said, /The backup finished\./); assert.match(said, /Render the logo: The logo is rendered\./);
  assert.ok(chatId);
  // Another person's call never hears a conversation that is not theirs.
  const heard = [], other = memory.createSession('Someone else\'s');
  require('../modules/harness/session-access').claim({ id: 'u-someone-else' }, other.id);
  const off = calls.open(other.id, { person: { id: 'u-member', role: 'member' }, deviceId: 'd1', notice: t => heard.push(t) });
  assert.equal(calls.speak(other.id, 'secret'), false); assert.deepEqual(heard, []);
  off();
});

test('the call\'s frames are the contract a watch draws from', () => {
  const { FRAMES } = require('../modules/realtime');
  for (const t of ['ready', 'heard', 'user', 'working', 'agent', 'done', 'background', 'report', 'interrupted', 'error', 'closed']) assert.ok(FRAMES[t], t);
  const doc = fs.readFileSync(require('node:path').join(__dirname, '..', 'PROTOCOL.md'), 'utf8');
  for (const t of Object.keys(FRAMES)) assert.ok(doc.includes(`\`${t}\``), `PROTOCOL.md names the ${t} frame`);
});
