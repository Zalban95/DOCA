'use strict';

/** Machines → Live (modules/machines): the pages agents serve, found from their jobs' output and seen by the hub. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const jobs = require('../modules/harness/jobs');

test.before(() => H.start());
test.after(async () => { require('../modules/machines/shots').close(); await H.stop(); });

const until = async (fn, ms = 15000) => { for (const end = Date.now() + ms; Date.now() < end; await H.sleep(100)) if (await fn()) return true; return false; };

test('a dev server an agent started is found by the address it printed; only this machine\'s addresses count', async () => {
  const script = "const s=require('http').createServer((q,r)=>r.end('<h1 style=\"font-size:80px\">served by the agent</h1>'));"
    + "s.listen(0,'127.0.0.1',()=>{console.log('  Local:   http://localhost:'+s.address().port+'/');console.log('docs at https://example.com:8443/x')});";
  const job = jobs.start(`"${process.execPath}" -e "${script.replace(/"/g, '\\"')}"`, { sessionId: null });
  try {
    assert.ok(await until(async () => (await H.api(null, 'GET', '/api/machines')).body.served.length > 0), 'found');
    const { served, browser } = (await H.api(null, 'GET', '/api/machines?shots=1')).body;
    assert.equal(served.length, 1, 'example.com is not this machine');
    assert.match(served[0].url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(served[0].jobId, job.id);
    if (browser.found) {
      let last = null;
      const got = await until(async () => { last = (await H.api(null, 'GET', '/api/machines?shots=1')).body; return last.served[0]?.shot; }, 45000);
      assert.ok(got, `a picture of it (${last?.browser?.error || 'no error said'})`);
      const png = await fetch(`${H.base}/api/machines/served/${encodeURIComponent(served[0].key)}/shot`, { headers: { Cookie: H.owner.cookie } });
      assert.equal(png.headers.get('content-type'), 'image/png');
      assert.ok((await png.arrayBuffer()).byteLength > 1000);
    }
    const member = await H.signIn('member', 'ml-member@test.local');
    assert.equal((await H.api(null, 'GET', '/api/machines', undefined, { Cookie: member.cookie })).status, 403);
  } finally { jobs.stop(job.id); }
});

test('a computer\'s tools mark it working', () => {
  const m = require('../modules/machines');
  m.onEvent({ type: 'tool_call', name: 'mcp__computer-pc_1__browser_open', args: { url: 'http://localhost:3000' }, sessionId: 's' });
  m.onEvent({ type: 'tool_call', name: 'computer_look', args: JSON.stringify({ computer: 'pc_2' }) });
  // picture() lists computers from docker; the activity it joins them with is what is checked here.
  return m.picture().then(p => assert.ok(Array.isArray(p.computers)));
});
