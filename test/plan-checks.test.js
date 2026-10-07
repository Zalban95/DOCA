'use strict';

/** Plan contracts' checks that look at the result as a person would (plan-contracts.js; TODO P1.4): the page as
 *  rendered, a clean-up, a server stopped. */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder
const http   = require('node:http');
const pc     = require('../modules/harness/plan-contracts');

test('absent: a clean-up holds when the file is gone', async () => {
  const f = require('node:path').join(H.tmp, 'leftover.txt');
  require('node:fs').writeFileSync(f, 'x');
  assert.equal((await pc.verify({ check: { absent: f } })).ok, false);
  require('node:fs').rmSync(f);
  assert.equal((await pc.verify({ check: { absent: f } })).ok, true);
});

test('free: a server stopped holds when nothing listens on its port', async () => {
  const s = http.createServer((q, r) => r.end('x'));
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  assert.match((await pc.verify({ check: { free: port } })).why, /still listens/);
  await new Promise(r => s.close(r));
  assert.equal((await pc.verify({ check: { free: port } })).ok, true);
});

test('page: the page as rendered, not just an address that answers', { skip: !require('../modules/headless').findBrowser() && 'no browser here' }, async () => {
  const s = http.createServer((q, r) => {
    r.setHeader('Content-Type', 'text/html');
    if (q.url === '/broken') return r.end('<p>Chair</p><script>throw new Error("the model did not load")</script>');
    r.end('<div id="viewer"></div><script>document.getElementById("viewer").textContent = "Chair ready"</script>');
  });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.equal((await pc.verify({ check: { page: `${base}/`, contains: 'Chair ready', selector: '#viewer', noErrors: true } })).ok, true, 'drawn by its script');
    assert.match((await pc.verify({ check: { page: `${base}/`, contains: 'A table' } })).why, /does not show "A table"/);
    assert.match((await pc.verify({ check: { page: `${base}/broken`, contains: 'Chair', noErrors: true } })).why, /console has errors: .*the model did not load/);
  } finally { await new Promise(r => s.close(r)); }
});

test('a page check reaches only the owner\'s own addresses', () => {
  assert.throws(() => pc.split({ title: 'x', check: { page: 'https://example.com' } }), /owner's own addresses/);
});
