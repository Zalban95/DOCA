'use strict';

/**
 * A repository served as a page (TODO H10.18): what a computer serves on its page port reaches the person through a
 * preview (canvas/previews.js) and Machines → Live pictures it; a computer's control and screen ports never become a
 * preview; and the skill that walks the agent through it is shipped. No Docker: the computer is a record whose page
 * port is a local server, which is all the hub ever sees of one.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

const H = require('./helpers');   // first: it points the settings at a temporary folder

let page, dead;
test.before(async () => {
  await H.start();
  page = http.createServer((req, res) => res.end('<h1>the repository, running</h1>'));
  await new Promise(r => page.listen(0, '127.0.0.1', r));
  dead = http.createServer();
  await new Promise(r => dead.listen(0, '127.0.0.1', r));
  const free = dead.address().port;
  await new Promise(r => dead.close(r));   // a port nothing answers on
  require('../modules/store').writeJson('computers', { computers: [
    { id: 'c0ffee01', name: 'run-repo', token: 't', mcpPort: 50001, vncPort: 50002, servePort: page.address().port },
    { id: 'c0ffee02', name: 'quiet', token: 't', mcpPort: 50003, vncPort: 50004, servePort: free },
    { id: 'c0ffee03', name: 'old', token: 't', mcpPort: 50005, vncPort: 50006 },
  ] });
});
test.after(async () => { page.close(); require('../modules/machines/shots').close(); await H.stop(); });

test('a computer\'s page port is previewed by naming the computer; its control and screen ports never are', async () => {
  const previews = require('../modules/canvas/previews');
  const p = previews.create({ computer: 'c0ffee01' });
  assert.equal(p.port, page.address().port);
  assert.equal(p.computer, 'c0ffee01');
  assert.match(p.where, /port 8080 in computer c0ffee01 "run-repo"/);
  assert.throws(() => previews.create({ computer: 'c0ffee03' }), e => e.status === 409 && /make a new one/.test(e.message));
  assert.throws(() => previews.create({ computer: 'nope' }), e => e.status === 404);
  for (const port of [50001, 50002]) assert.throws(() => previews.create({ port }), e => e.status === 403 && /control or screen/.test(e.message));

  const shown = [];
  const out = await require('../modules/harness/tools').call('canvas', { action: 'preview', computer: 'c0ffee01', title: 'the repo' }, [], { show: m => shown.push(m) });
  assert.match(out, /of port 8080 in computer c0ffee01/);
  assert.ok(shown[0].previewId);

  const r = await H.api(null, 'POST', '/api/harness/previews', { computer: 'c0ffee01' });
  assert.equal(r.status, 200);
  assert.match((await H.api(null, 'GET', `/api/harness/previews/${r.body.preview.id}`)).body.preview.where, /computer c0ffee01/);
  const member = await H.signIn('member', 'serve-member@test.local');
  assert.equal((await H.api(null, 'POST', '/api/harness/previews', { computer: 'c0ffee01' }, { Cookie: member.cookie })).status, 403);
});

test('Machines → Live lists a running computer\'s page only when something answers on it', async () => {
  const m = require('../modules/machines');
  const view = id => ({ ...require('../modules/computers').get(id), state: 'running',
    serve: require('../modules/computers').get(id).servePort ? { inside: 8080, port: require('../modules/computers').get(id).servePort } : null });
  const pages = await m.computerPages([view('c0ffee01'), view('c0ffee02'), view('c0ffee03'), { ...view('c0ffee01'), id: 'stopped', state: 'exited' }]);
  assert.deepEqual(pages.map(p => p.computer), ['c0ffee01']);
  assert.equal(pages[0].inside, 8080);
  assert.equal(pages[0].url, `http://127.0.0.1:${page.address().port}/`);

  // Through the route the page reads, with the computers as Docker would list them.
  const computers = require('../modules/computers');
  const was = computers.detailed;
  computers.detailed = async () => [view('c0ffee01')];
  try {
    const { served } = (await H.api(null, 'GET', '/api/machines')).body;
    assert.ok(served.some(s => s.computer === 'c0ffee01' && s.key === 'computer-c0ffee01'));
  } finally { computers.detailed = was; }
});

test('the skill is shipped and keeps a stranger\'s repository off the hub unless the person says', () => {
  const text = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'skills', 'serve-a-repository', 'SKILL.md'), 'utf8');
  assert.match(text, /^name: serve-a-repository$/m);
  assert.match(text, /Not the person's own → an agents' computer/);
  assert.match(text, /0\.0\.0\.0/);
  assert.match(text, /`recipe` save_last/);
});
