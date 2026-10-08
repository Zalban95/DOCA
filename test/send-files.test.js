'use strict';

// Files the agent sends to the person (tell_device `files`, modules/harness/reach-files.js): asked 2026-10-08 after the
// agent, with no tool for it, sent nine voice samples to Telegram by a script that loaded the bot token itself. A stub
// Bot API and a scripted model: the files go through the channel's own upload (audio as audio, the rest as documents,
// each with its caption), to an app as that phone's own media, never to someone else's device, refused with the
// channel's limit — and the token is in no result, no transcript and no frame.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const H = require('./helpers');

const TOKEN = 'TEST:SECRET-BOT-TOKEN-91';
const CHAT = 9001;
let tg, model, script = [];
const sent = [];
const sse = frames => res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`); res.end('data: [DONE]\n\n'); };

/** A multipart upload's fields and file name, read back crudely — enough to see what the channel sent. */
function fieldsOf(buf) {
  const s = buf.toString('latin1'), out = {};
  for (const m of s.matchAll(/name="([^"]+)"(?:; filename="([^"]+)")?\r\n(?:Content-Type: [^\r]+\r\n)?\r\n([\s\S]*?)\r\n--/g)) out[m[1]] = m[2] ? { filename: m[2], bytes: m[3].length } : Buffer.from(m[3], 'latin1').toString('utf8');
  return out;
}

const waitSent = async (pred, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await H.sleep(20)) {
    const i = sent.findIndex(pred);
    if (i >= 0) return sent.splice(i, 1)[0];
  }
  throw new Error(`nothing sent matching; sent: ${JSON.stringify(sent.map(x => x.method))}`);
};

const file = (name, bytes = 2048) => { const p = path.join(H.tmp, name); fs.writeFileSync(p, Buffer.alloc(bytes, 7)); return p; };

before(async () => {
  tg = http.createServer((req, res) => {
    const raw = []; req.on('data', d => raw.push(d));
    req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url) || [];
      if (m[1] !== TOKEN) { res.writeHead(401); return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' })); }
      const buf = Buffer.concat(raw);
      const body = String(req.headers['content-type']).includes('json') ? JSON.parse(buf.toString() || '{}') : fieldsOf(buf);
      sent.push({ method: m[2], body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { message_id: sent.length, chat: { id: CHAT } } }));
    });
  });
  await new Promise(r => tg.listen(0, '127.0.0.1', r));
  process.env.DOCA_TELEGRAM_API = `http://127.0.0.1:${tg.address().port}`;
  model = http.createServer((req, res) => {
    req.on('data', () => {}); req.on('end', () => {
      const next = script.shift() || { text: 'done' };
      if (next.tool) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } }] }])(res);
      return sse([{ choices: [{ delta: { content: next.text } }] }])(res);
    });
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  await H.start();
  const { CONFIG_PATH } = require('../modules/paths');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { fstub: { baseUrl: `http://127.0.0.1:${model.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'fstub', model: 'm1', fallbackChain: [], summarizeAfter: 0 });
  const u = require('../modules/utils'); const p = u.loadPrefs(); p.channels = { telegram: { botToken: TOKEN, pollSec: 0 } }; u.savePrefs(p);
  require('../modules/channels/telegram').link({ id: CHAT, first_name: 'Al' }, H.owner.user.id);
});

after(async () => {
  require('../modules/channels/telegram').stop();
  await H.stop();
  model.closeAllConnections();
  await new Promise(r => tg.close(r));
  await new Promise(r => model.close(r));
});

const owner = () => ({ ...H.owner.user, role: 'owner' });
const tellDevice = (args, user = owner()) => require('../modules/harness/tools').call('tell_device', args, [], { user });
/** A tool's refusal comes back as its result, starting "Error:". */
const refused = async (args, re, user) => assert.match(await tellDevice(args, user), new RegExp(`^Error: [\\s\\S]*${re.source}`));

test('a turn sends audio and a document to the linked Telegram chat, each with its caption; the token is nowhere', async () => {
  const mp3 = file('it-whisper.mp3'), wav = file('kokoro-excited.wav'), pdf = file('notes.pdf');
  const s = require('../modules/harness/memory').createSession('send files', { activate: false });
  script = [{ tool: 'tell_device', args: { to: 'Telegram', title: 'Voice samples', files: [
    { path: mp3, caption: 'Italian — whisper, Qwen3-TTS' }, { path: wav, caption: 'English — excited, Kokoro' }, { path: pdf, caption: 'The notes' }] } },
  { text: 'Sent.' }];
  const events = [];
  await require('../modules/harness/agent').turn({ message: 'send them to my Telegram', sessionId: s.id, emit: e => events.push(e),
    client: { name: 'Dashboard console', kind: 'dashboard', user: owner() } });
  const result = events.find(e => e.type === 'tool_result')?.result || '';
  assert.match(result, /Sent with 3 files .* to:\nTelegram · Al/, result);
  assert.match(result, /kokoro-excited\.wav arrives as a file/, 'the agent is told a WAV does not play in Telegram');

  assert.equal((await waitSent(x => x.method === 'sendMessage')).body.text, 'Voice samples', 'the headline first');
  const audio = await waitSent(x => x.method === 'sendAudio');
  assert.equal(audio.body.caption, 'Italian — whisper, Qwen3-TTS');
  assert.equal(audio.body.audio.filename, 'it-whisper.mp3');
  const docs = [await waitSent(x => x.method === 'sendDocument'), await waitSent(x => x.method === 'sendDocument')];
  assert.deepEqual(docs.map(d => d.body.document.filename).sort(), ['kokoro-excited.wav', 'notes.pdf']);
  assert.deepEqual(docs.map(d => d.body.caption).sort(), ['English — excited, Kokoro', 'The notes']);
  assert.equal(audio.body.chat_id, String(CHAT));

  const transcript = JSON.stringify(require('../modules/harness/memory').getSession(s.id));
  for (const where of [result, transcript, JSON.stringify(events)]) assert.ok(!where.includes(TOKEN), 'the bot token never reaches the agent');
});

test('to an app the files are that phone\'s own media, with what each is; another device cannot fetch them', async () => {
  const phone = H.mkDevice('Al phone', 'phone', H.PHONE_CAPS);
  const other = H.mkDevice('Other phone', 'phone', H.PHONE_CAPS);
  const out = await tellDevice({ to: phone.device.id, title: 'The clip', files: [{ path: file('clip.mp4', 4096), caption: 'The render' }, file('brief.md', 300)] });
  assert.match(out, /Sent with 2 files/);
  const alert = require('../modules/api-v1/bus').drain(phone.device.id, 0).events.filter(e => e.type === 'alert').at(-1);
  const blocks = alert.payload.body.filter(b => b.type === 'media');
  assert.deepEqual(blocks.map(b => [b.kind, b.mime, b.name, b.caption]),
    [['video', 'video/mp4', 'clip.mp4', 'The render'], ['doc', 'text/markdown', 'brief.md', undefined]]);
  assert.equal(blocks[0].bytes, 4096);
  const got = await H.api(phone.token, 'GET', blocks[0].url);
  assert.equal(got.status, 200);
  assert.equal(got.body.length, 4096);
  assert.equal((await H.api(other.token, 'GET', blocks[0].url)).status, 404, 'kept as the recipient\'s own');
});

test('a watch takes pictures only; a file over a channel\'s limit is refused with it; nothing is sent', async () => {
  const watch = H.mkDevice('Al watch', 'watch', H.WATCH_CAPS);
  await refused({ to: watch.device.id, title: 'Listen', files: [file('a.mp3')] }, /watch: it shows pictures only.*a\.mp3/);
  const big = path.join(H.tmp, 'huge.mp4');
  fs.closeSync(fs.openSync(big, 'w')); fs.truncateSync(big, 51 * 1024 * 1024);
  await refused({ to: 'Telegram', title: 'Big', files: [big] }, /Nothing was sent\. Telegram · Al: huge\.mp4 is 51\.0 MB — a Telegram bot sends files up to 50 MB each/);
  await refused({ to: 'Telegram', title: 'Many', files: Array.from({ length: 11 }, (_, i) => file(`f${i}.txt`)) }, /At most 10 files/);
  await refused({ to: 'Telegram', title: 'Settings', files: [process.env.DOCA_PREFS_FILE] }, /holds secrets beside settings and is never sent/);
  await H.sleep(150);
  assert.deepEqual(sent.map(x => x.method), [], 'no refusal sent a message');
});

test('another person\'s device is refused; a person reaches their own', async () => {
  const member = await H.signIn('member');
  const devices = require('../modules/api-v1/devices');
  const theirs = H.mkDevice('Member phone', 'phone', H.PHONE_CAPS);
  devices.update(theirs.device.id, { userId: member.user.id });
  await refused({ to: 'Member phone', title: 'Hi', files: [file('x.mp3')] }, /someone else's: a notice or a file goes only to the person's own/);
  const out = await tellDevice({ to: 'Member phone', title: 'Hi', files: [file('y.mp3')] }, { ...member.user, role: 'member' });
  assert.match(out, /Member phone/);
  const all = await tellDevice({ title: 'To everyone' }, { ...member.user, role: 'member' });
  assert.ok(!/Telegram · Al/.test(all), 'the owner\'s chat is not the member\'s');
});

test('a mail carries the files as attachments', () => {
  const mime = require('../modules/channels/mail/mime');
  const raw = mime.reply({ from: 'doca@x.test', to: 'al@x.test', subject: 'S', text: 'Voice samples', files: [{ name: 'à.mp3', mime: 'audio/mpeg', buffer: Buffer.from('ID3-fake') }] });
  const back = mime.parse(raw);
  assert.equal(back.text, 'Voice samples');
  assert.equal(back.files.length, 1);
  assert.equal(back.files[0].buffer.toString(), 'ID3-fake');
  assert.equal(require('../modules/channels/limits').refusal('mail', [{ name: 'a', bytes: 15e6 }, { name: 'b', bytes: 15e6 }]),
    'These files are 28.6 MB together — one mail carries at most 20 MB of files in all — most mail servers refuse more. Send fewer at a time.');
});
