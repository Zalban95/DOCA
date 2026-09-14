'use strict';

/**
 * Attachments are files, and what the model gets is a path.
 *
 * The things pinned here are the ones a later edit could undo without any test
 * going red on its own: a name can never leave the directory, an existing file
 * is never overwritten, the directory itself is the index (so a file dropped in
 * by hand is an attachment), and the note the model reads says these are files
 * rather than pictures — which is the whole difference between this and media.
 */
const fs   = require('fs');
const path = require('path');
const test   = require('node:test');
const assert = require('node:assert/strict');

const h = require('./helpers');           // must come first: it sets the env
const attachments = require('../modules/attachments');
const paths       = require('../modules/paths');
const agent       = require('../modules/harness/agent');
const memory      = require('../modules/harness/memory');

test.before(async () => { await h.start(); attachments.ensureDir(); });
test.after(async () => { await h.stop(); });

test('the attachments directory is a path the panel manages, so the agent is told where it is', () => {
  const row = paths.describe().find(p => p.key === 'ATTACHMENTS_DIR');
  assert.ok(row, 'ATTACHMENTS_DIR is missing from Settings → Paths');
  assert.equal(row.kind, 'dir');
  assert.match(row.note, /agent|path/i);
});

test('a name can never leave the directory', () => {
  for (const evil of ['../../etc/passwd', '/etc/passwd', '..\\..\\win.ini', '.ssh', '....//x']) {
    const safe = attachments.safeName(evil);
    assert.ok(!safe.includes('/') && !safe.includes('\\'), `${evil} survived as ${safe}`);
    assert.ok(!safe.startsWith('.'), `${evil} stayed hidden as ${safe}`);
    const abs = path.resolve(attachments.dir(), safe);
    assert.ok(abs.startsWith(path.resolve(attachments.dir())), `${evil} escaped to ${abs}`);
  }
});

test('an existing file is never overwritten', () => {
  const a = attachments.save(Buffer.from('first'), 'report.pdf');
  const b = attachments.save(Buffer.from('second'), 'report.pdf');
  assert.equal(a.name, 'report.pdf');
  assert.equal(b.name, 'report-2.pdf');
  assert.equal(fs.readFileSync(a.path, 'utf8'), 'first', 'the first file was clobbered');
});

test('the directory is the index: a file dropped in by hand is an attachment', () => {
  fs.writeFileSync(path.join(attachments.dir(), 'dropped-by-hand.csv'), 'a,b\n1,2\n');
  const found = attachments.list().find(x => x.name === 'dropped-by-hand.csv');
  assert.ok(found, 'a file with no sidecar entry was invisible');
  assert.equal(found.mime, 'text/csv');
  assert.equal(found.bytes, 8);
});

test('resolve keeps what is there and silently drops what is not', () => {
  attachments.save(Buffer.from('x'), 'present.txt');
  const got = attachments.resolve(['present.txt', 'never-existed.txt']);
  assert.equal(got.length, 1);
  assert.equal(got[0].name, 'present.txt');
  assert.ok(path.isAbsolute(got[0].path));
});

test('the note tells the model these are files, not pictures', () => {
  const rec = attachments.save(Buffer.from('col\n1\n'), 'data.csv');
  const note = attachments.note([{ name: rec.name, path: rec.path, bytes: rec.bytes, mime: rec.mime }]);
  assert.match(note, /read_file/, 'the note has to name the way in');
  assert.ok(note.includes(rec.path), 'the note has to carry the absolute path');
  assert.equal(attachments.note([]), '', 'a message with no attachments gets no note at all');
});

test('a turn stores attachments beside the message, not glued into it', async () => {
  const rec = attachments.save(Buffer.from('hello'), 'note.txt');
  const session = memory.activeSession();
  memory.append(session.id, {
    role: 'user', content: 'look at this',
    attachments: [{ name: rec.name, path: rec.path, bytes: rec.bytes, mime: rec.mime }],
  });
  const row = memory.messages(session.id).at(-1);
  assert.equal(row.content, 'look at this', 'the stored message must stay the user\'s own words');
  assert.equal(row.attachments[0].name, 'note.txt');

  const prompt = agent.preview({ message: 'look at this' });
  assert.ok(typeof prompt === 'string' || typeof prompt === 'object');
});

test('POST /api/attachments stores the file and answers with its path', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(['x,y\n1,2\n'], { type: 'text/csv' }), 'uploaded.csv');
  const res = await h.api(null, 'POST', '/api/attachments', fd);
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'uploaded.csv');
  assert.ok(path.isAbsolute(res.body.path));
  assert.equal(fs.readFileSync(res.body.path, 'utf8'), 'x,y\n1,2\n');

  const listed = await h.api(null, 'GET', '/api/attachments');
  assert.equal(listed.status, 200);
  assert.ok(listed.body.attachments.some(a => a.name === 'uploaded.csv'));
  assert.equal(listed.body.dir, attachments.dir());
});

test('an upload with no file is a 400, not a crash', async () => {
  const res = await h.api(null, 'POST', '/api/attachments', new FormData());
  assert.equal(res.status, 400);
});
