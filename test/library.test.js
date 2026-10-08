'use strict';

// The Library (modules/library; docs/experiments/library.md), with a stub that answers Ollama's /api/embed and a speech
// service's verbose_json from words written into the test files — so a picture "shows" what its bytes say and a
// recording "says" its marker, deterministically, with no model. The machine's own ffmpeg and friends are switched
// off for the run, so it behaves the same on every CI runner: pictures go as they are, sound only as words.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const H = require('./helpers');
const { CONFIG_PATH } = require('../modules/paths');

// Each concept is one dimension; a text (or a file's bytes) counts the concept words in it.
const CONCEPTS = [['bicycle', 'bike', 'red'], ['boiler', 'heating', 'code'], ['beach', 'sea', 'sand'], ['invoice', 'receipt', 'total'], ['dog', 'puppy'], ['music', 'song']];
const vec = t => { const w = String(t).toLowerCase().split(/[^a-z0-9]+/); return CONCEPTS.map(c => w.filter(x => c.includes(x)).length + 0.01); };
let srv, embedded = [], heard = 0;

// A PNG header (what the model takes as a picture) followed by words the stub reads as what it shows.
const png = words => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 32]), Buffer.from(` ${words} `)]);

before(async () => {
  srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (req.url === '/api/embed') {
        const body = JSON.parse(raw.toString());
        const out = body.input.map(it => {
          if (typeof it === 'string') { embedded.push(`text:${it.slice(0, 40)}`); return vec(it); }
          const bytes = Buffer.from(it.image || it.audio, 'base64').toString('latin1');
          embedded.push(`${it.image ? 'image' : 'audio'}:${bytes.slice(24, 60).trim()}`);
          return vec(bytes);
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ model: body.model, embeddings: out }));
      }
      if (req.url === '/v1/audio/transcriptions') {
        heard++;
        const said = (/SAYS:([a-z ]+)/.exec(raw.toString('latin1')) || [])[1] || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ text: `hello there. ${said}`, language: 'en', duration: 40,
          segments: [{ start: 0, end: 3, text: 'hello there.' }, { start: 34.5, end: 39, text: said }] }));
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: { providers: { emb: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: '', models: ['gemma-stub'] } } } }));
  await H.start();
  const { loadPrefs, savePrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), voiceServices: { sttUrl: `http://127.0.0.1:${port}`, sttModel: 'stub' } });
  const M = require('../modules/library/media');
  M.have = () => ({ ffmpeg: false, ffprobe: false, pdftotext: false, soffice: false, exiftool: false });
});

after(async () => { require('../modules/library').stopTicker(); await H.stop(); await new Promise(r => srv.close(r)); });

const dirA = path.join(H.tmp, 'lib-a'), dirB = path.join(H.tmp, 'lib-b');
const write = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
async function index() {
  const r = await H.api(null, 'POST', '/api/library/run');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const I = require('../modules/library/indexer');
  for (let i = 0; i < 200 && I.running(); i++) await H.sleep(25);
  assert.equal(I.running(), false);
  return I.view();
}

test('off by default: nothing is searched, indexed or offered, and the ticker does nothing', async () => {
  write(path.join(dirA, 'notes.txt'), 'The boiler code is 4471; the heating comes on at six.');
  assert.equal((await H.api(null, 'GET', '/api/library/search?q=boiler')).status, 409);
  assert.equal((await H.api(null, 'POST', '/api/library/run')).status, 409);
  const names = require('../modules/harness/tools').schemas().map(t => t.function?.name || t.name);
  assert.ok(!names.includes('library_search'), 'the tool is absent while the experiment is off');
  embedded = [];
  require('../modules/library').tick();
  assert.deepEqual(embedded, [], 'no model was asked');
});

test('a folder outside the Files roots is refused; the chosen ones are indexed by kind', async () => {
  const E = require('../modules/experiments');
  E.setDeveloper(true); E.set('library', true);
  assert.equal((await H.api(null, 'POST', '/api/library', { folders: ['/etc'] })).status, 400);
  fs.rmSync(path.join(dirA, 'notes.txt'));   // the first test's file: the recording alone says the code here
  write(path.join(dirA, 'clip.mp3'), Buffer.from('ID3 fake audio SAYS:the boiler code is four four seven one'));
  write(path.join(dirA, 'photo.png'), png('a red bike leaning on a wall'));
  write(path.join(dirB, 'shore.png'), png('beach sea sand waves beach'));
  write(path.join(dirB, '.hidden', 'x.txt'), 'boiler');
  write(path.join(dirB, 'song.txt'), 'A song about music and a dog.');
  const set = await H.api(null, 'POST', '/api/library', { provider: 'emb', model: 'gemma-stub', folders: [dirA, dirB], open: [dirB] });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.on, true);
  const st = await index();
  assert.equal(st.read, 4, JSON.stringify(st));
  const S = require('../modules/library/store');
  const items = new Map((await S.items()).map(i => [path.basename(i.path), i]));
  assert.ok(!items.has('x.txt'), 'hidden folders are skipped');
  assert.equal(items.get('clip.mp3').kind, 'audio');
  assert.match(items.get('clip.mp3').note || '', /ffmpeg/, 'what could not be read here is said');
  assert.equal(items.get('photo.png').meta.width, 64, 'dimensions read from the header');
  assert.ok(items.get('shore.png').meta.tags.some(t => t.tag === 'beach'), JSON.stringify(items.get('shore.png').meta.tags));
  const pieces = await S.piecesOf(items.get('clip.mp3').path, 'gemma-stub');
  const said = pieces.find(p => p.kind === 'transcript' && /boiler/.test(p.text));
  assert.equal(said.at, 34.5, 'the words keep their time');
});

test('search finds an audio by what it says, at the moment, and a picture by what it shows', async () => {
  const r = await H.api(null, 'GET', '/api/library/search?q=heating%20code');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.results[0].name, 'clip.mp3');
  assert.equal(r.body.results[0].match.kind, 'transcript');
  assert.equal(r.body.results[0].match.at, 34.5);
  const pic = await H.api(null, 'GET', '/api/library/search?q=bicycle&kinds=images');
  assert.equal(pic.body.results[0].name, 'photo.png');
  assert.ok(pic.body.results.every(x => x.kind === 'images'));
  const tagged = await H.api(null, 'GET', '/api/library/search?q=anything&tags=beach');
  assert.deepEqual(tagged.body.results.map(x => x.name), ['shore.png']);
  const like = await H.api(null, 'GET', `/api/library/similar?path=${encodeURIComponent(path.join(dirB, 'shore.png'))}`);
  assert.equal(like.status, 200);
  assert.ok(!like.body.results.some(x => x.name === 'shore.png'), 'not itself');
});

test('incremental: unchanged files cost nothing, a changed one is read again, a deleted one leaves', async () => {
  embedded = []; heard = 0;
  let st = await index();
  assert.equal(st.read, 0);
  assert.deepEqual(embedded, [], 'nothing embedded again');
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dirA, 'photo.png'), t, t);   // a new time, the same content: the hash says unchanged
  write(path.join(dirB, 'song.txt'), 'An invoice with a total.');
  fs.rmSync(path.join(dirA, 'clip.mp3'));
  st = await index();
  assert.equal(st.read, 1, JSON.stringify(st));
  assert.equal(st.removed, 1);
  assert.ok(embedded.every(e => !e.startsWith('image:')), 'the picture was not embedded again');
  assert.equal(heard, 0);
  const r = await H.api(null, 'GET', '/api/library/search?q=receipt');
  assert.equal(r.body.results[0].name, 'song.txt');
  assert.ok(!(await require('../modules/library/store').item(path.join(dirA, 'clip.mp3'))));
});

test('a member searches only the folders opened to everyone, and opens only those files', async () => {
  const member = await H.signIn('member');
  const r = await H.api(null, 'GET', '/api/library/search?q=bicycle', undefined, { Cookie: member.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.results.length && r.body.results.every(x => x.path.startsWith(dirB)), JSON.stringify(r.body.results.map(x => x.path)));
  const theirs = await H.api(null, 'GET', `/api/library/file?path=${encodeURIComponent(path.join(dirB, 'shore.png'))}`, undefined, { Cookie: member.cookie });
  assert.equal(theirs.status, 200);
  const notTheirs = await H.api(null, 'GET', `/api/library/file?path=${encodeURIComponent(path.join(dirA, 'photo.png'))}`, undefined, { Cookie: member.cookie });
  assert.equal(notTheirs.status, 404);
  assert.equal((await H.api(null, 'POST', '/api/library/run', undefined, { Cookie: member.cookie })).status, 403, 'indexing is a host\'s');
  const tool = require('../modules/harness/toolbox/library')[0];
  const out = await tool.run({ query: 'bicycle' }, { user: { id: member.user.id, role: 'member' } });
  assert.ok(!out.includes(dirA), out);
});

test('the agent\'s tool answers with paths and moments, framed as the person\'s own files', async () => {
  const names = require('../modules/harness/tools').schemas().map(t => t.function?.name || t.name);
  assert.ok(names.includes('library_search'));
  const out = await require('../modules/harness/toolbox/library')[0].run({ query: 'bicycle', kinds: ['images'] }, {});
  assert.match(out, /photo\.png/);
  assert.match(out, /matched by the picture/);
  assert.match(require('../modules/harness/untrusted').sourceOf('library_search', {}), /person's own files/);
});
