'use strict';

/**
 * Skills from public collections (harness/skill-online.js), against a stub of GitHub's API and raw files: searched,
 * looked at as a dry run (its SKILL.md, the audit, its files and scripts), imported with a click — files copied, never
 * run — and a host's alone.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)

const FILES = {
  'skills/pdf-tools/SKILL.md': '---\nname: pdf-tools\ndescription: Fill and merge PDF forms.\n---\n\n1. **Read** the form with Read.\n2. Run scripts/fill.py.\n',
  'skills/pdf-tools/scripts/fill.py': 'import sys\nopen("/tmp/doca-skill-online-ran", "w").write("ran")\n',
  'skills/slides/SKILL.md': '---\nname: slides\ndescription: Make a slide deck.\n---\nSteps.\n',
};
let server, asked = [];
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`);
    if (/^\/repos\/[^/]+\/[^/]+\/git\/trees\/HEAD/.test(req.url)) {
      const own = req.url.startsWith('/repos/anthropics/skills/');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ tree: own ? Object.entries(FILES).map(([p, t]) => ({ path: p, type: 'blob', size: t.length })) : [] }));
    }
    const m = /^\/anthropics\/skills\/HEAD\/(.+)$/.exec(req.url);
    const body = m && FILES[decodeURIComponent(m[1])];
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200); res.end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  process.env.DOCA_SKILLS_API = process.env.DOCA_SKILLS_RAW = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

test('search, look, import: a dry run first, files copied and never run', async () => {
  const s = await H.api(null, 'GET', '/api/harness/skills/online?q=pdf forms');
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body.results.map(r => r.name), ['pdf-tools']);
  assert.equal(s.body.results[0].source, 'Anthropic');
  const p = await H.api(null, 'GET', '/api/harness/skills/online/plan?repo=anthropics/skills&dir=skills/pdf-tools');
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.scripts, ['scripts/fill.py']);
  assert.match(p.body.text, /Fill and merge PDF forms/);
  assert.ok(['ready', 'adapt'].includes(p.body.audit.status), 'the audit says whether it needs translating');
  assert.equal(require('../modules/harness/skills').list().some(x => x.name === 'pdf-tools'), false, 'the look wrote nothing');
  const posts = asked.filter(a => !a.startsWith('GET'));
  assert.deepEqual(posts, [], 'GET only');
  const imp = await H.api(null, 'POST', '/api/harness/skills/online/import', { repo: 'anthropics/skills', dir: 'skills/pdf-tools' });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  const here = require('../modules/harness/skills').list().find(x => x.name === 'pdf-tools');
  assert.equal(here.source, 'local');
  const script = path.join(here.dir, 'scripts', 'fill.py');
  assert.ok(fs.existsSync(script));
  if (process.platform !== 'win32') assert.equal(fs.statSync(script).mode & 0o111, 0, 'not executable');
  assert.equal(fs.existsSync('/tmp/doca-skill-online-ran'), false, 'nothing it carries ran');
  assert.equal(require('../modules/harness/skill-use').all().find(x => x.name === 'pdf-tools').use, 'fits', 'an imported skill is used when it fits');
  const other = await H.api(null, 'GET', '/api/harness/skills/online/plan?repo=someone/else&dir=x');
  assert.equal(other.status, 400, 'only the collections listed');
});

test('a member cannot search or import public collections', async () => {
  const member = await H.signIn('member');
  const r = await H.api(null, 'GET', '/api/harness/skills/online?q=pdf', undefined, { Cookie: member.cookie, 'X-Doca-Password': '' });
  assert.equal(r.status, 403);
  const i = await H.api(null, 'POST', '/api/harness/skills/online/import', { repo: 'anthropics/skills', dir: 'skills/slides' }, { Cookie: member.cookie, 'X-Doca-Password': '' });
  assert.equal(i.status, 403);
  const t = await H.api(null, 'POST', '/api/harness/skills/slides/triggers/suggest', {}, { Cookie: member.cookie, 'X-Doca-Password': '' });
  assert.equal(t.status, 403);
  const sug = await H.api(null, 'GET', '/api/harness/skills/suggest?q=build%20the%20android%20apk', undefined, { Cookie: member.cookie, 'X-Doca-Password': '' });
  assert.equal(sug.status, 200, 'the composer\'s suggestion is any reader\'s');
  assert.deepEqual(sug.body.suggestions.map(x => x.name), ['android-app']);
});
