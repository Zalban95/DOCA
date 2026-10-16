'use strict';

/**
 * Parametric projects, phase 1 (modules/params): a project's project.params.json read and checked, its values saved
 * from the mask and built at once with no model — each stage a recipe run, outputs promoted only when every check
 * holds, a stamp proving the deliverables came from the values — and the checks "built from the current values" and
 * "a value typed twice". End to end with a tiny build: two Node scripts writing files from the parameters.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const H = require('./helpers');

test.before(() => H.start());
test.after(() => H.stop());

const MAKE = `const fs = require('fs'), path = require('path');
const [params, out] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(params, 'utf8'));
const v = k => (d.values && k in d.values ? d.values[k] : d.params[k].default);
if (v('w') > v('bed') - 5) { console.error('w ' + v('w') + ' does not fit the bed'); process.exit(1); }
fs.mkdirSync(path.join(out, 'parts'), { recursive: true });
fs.writeFileSync(path.join(out, 'parts', 'box.txt'), 'W=' + v('w') + ' H=' + v('h') + '\\n');
fs.mkdirSync(path.join(out, 'build'), { recursive: true });
fs.writeFileSync(path.join(out, 'build', 'derived.json'), JSON.stringify({ area: v('w') * v('h') }));
`;
const SHEET = `const fs = require('fs'), path = require('path');
const [, out, spec] = process.argv.slice(2);
fs.mkdirSync(path.join(out, 'sheet'), { recursive: true });
fs.copyFileSync(spec, path.join(out, 'sheet', 'out.json'));
`;
const PARAMS = {
  format: 1, title: 'A box',
  groups: [{ id: 'size', label: 'Size' }, { id: 'look', label: 'Look' }],
  params: {
    w: { type: 'number', default: 200, min: 100, max: 400, unit: 'mm', group: 'size' },
    h: { type: 'number', default: 125, min: 50, max: 300, unit: 'mm', group: 'size' },
    bed: { type: 'number', default: 260, unit: 'mm', group: 'size', advanced: true },
    label: { type: 'string', default: 'Box', group: 'look' },
  },
  values: {},
  build: [
    { id: 'parts', recipe: 'node-params-script', values: { script: 'make.js' }, reads: ['size'], writes: ['parts/*', 'build/derived.json'],
      checks: [{ file: 'parts/box.txt', contains: 'W=${w}' }] },
    { id: 'sheet', recipe: 'node-params-script', values: { script: 'sheet.js' }, template: 'sheet.tmpl.json', writes: ['sheet/*'],
      checks: [{ file: 'sheet/out.json', contains: '"area"' }] },
  ],
};

let root, id;
const P = s => `/api/projects/${id}${s}`;
const done = async () => {
  const projects = require('../modules/projects/store');
  await require('../modules/params/build').wait(projects.get(id));
  for (let i = 0; i < 50 && require('../modules/params/build').status(projects.get(id)).running; i++) await H.sleep(20);
};

test('a project with parameters: the mask reads them, Save writes only what differs and builds at once', async () => {
  root = fs.mkdtempSync(path.join(H.tmp, 'box-'));
  fs.writeFileSync(path.join(root, 'make.js'), MAKE);
  fs.writeFileSync(path.join(root, 'sheet.js'), SHEET);
  fs.writeFileSync(path.join(root, 'sheet.tmpl.json'), JSON.stringify({ title: '${label|upper}', width: '${w}', area: '${derived.area}', note: 'w is ${w|fixed:1} mm' }));
  fs.writeFileSync(path.join(root, 'project.params.json'), JSON.stringify(PARAMS, null, 2));
  const made = await H.api(null, 'POST', '/api/projects', { root });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  id = made.body.project.id;

  const r = await H.api(null, 'GET', P('/params'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.errors, []);
  assert.deepEqual(r.body.params.map(x => x.name), ['w', 'h', 'bed', 'label']);
  assert.equal(r.body.params.find(x => x.name === 'bed').advanced, true);
  assert.equal(r.body.params.find(x => x.name === 'w').unit, 'mm');

  const out = await H.api(null, 'POST', P('/params'), { values: { w: 210, h: 130 }, ifMatch: r.body.hash });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.changes.map(c => c.name), ['w', 'h']);
  assert.ok(out.body.build, 'the save started the build');
  await done();
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'project.params.json'), 'utf8'));
  assert.deepEqual(saved.values, { w: 210, h: 130 }, 'only what differs from the defaults is written');
  assert.equal(fs.readFileSync(path.join(root, 'parts', 'box.txt'), 'utf8').trim(), 'W=210 H=130');
  const sheet = JSON.parse(fs.readFileSync(path.join(root, 'sheet', 'out.json'), 'utf8'));
  assert.deepEqual(sheet, { title: 'BOX', width: 210, area: 27300, note: 'w is 210.0 mm' }, 'the template took the values and the derived area');
  assert.ok(!fs.existsSync(path.join(root, 'build', '.next')), 'the build folder is gone once promoted');
  const stamp = JSON.parse(fs.readFileSync(path.join(root, 'project.build.json'), 'utf8'));
  assert.equal(stamp.ok, true);
  assert.equal(stamp.stages.length, 2);

  const ck = await H.api(null, 'GET', P('/params/check'));
  assert.equal(ck.body.checks.find(c => c.check === 'built').ok, true, JSON.stringify(ck.body));
  assert.equal(ck.body.checks.find(c => c.check === 'literals').ok, true);
  const usage = await require('../modules/harness/usage').summary({ days: 1 });
  assert.equal(usage.total.calls, 0, 'the build asked no model: the usage ledger has no call');
});

test('a stale Save is refused with the values now; a value out of range is refused by the hub', async () => {
  const stale = await H.api(null, 'POST', P('/params'), { values: { w: 220 }, ifMatch: 'not-the-hash' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale');
  assert.equal(stale.body.values.find(v => v.name === 'w').value, 210);
  const far = await H.api(null, 'POST', P('/params'), { values: { w: 999 } });
  assert.equal(far.status, 400);
  assert.match(far.body.error, /at most 400 mm/);
  const secret = require('../modules/params/file').check({ format: 1, params: { api_key: { type: 'string', default: '' } } });
  assert.match(secret.join(' '), /never a parameter/);
});

test('a change that only one stage reads skips the other; a build that fails leaves the deliverables as they were', async () => {
  let r = await H.api(null, 'POST', P('/params'), { values: { label: 'Crate' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await done();
  let stamp = JSON.parse(fs.readFileSync(path.join(root, 'project.build.json'), 'utf8'));
  assert.equal(stamp.stages[0].skipped, true, 'parts reads only the size group');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'sheet', 'out.json'), 'utf8')).title, 'CRATE');

  r = await H.api(null, 'POST', P('/params'), { values: { w: 258 } });   // over the bed (260 - 5)
  assert.equal(r.status, 200);
  await done();
  stamp = JSON.parse(fs.readFileSync(path.join(root, 'project.build.json'), 'utf8'));
  assert.equal(stamp.ok, false);
  assert.equal(stamp.failed, 'parts');
  assert.equal(fs.readFileSync(path.join(root, 'parts', 'box.txt'), 'utf8').trim(), 'W=210 H=130', 'the last good deliverable stays');
  const ck = await H.api(null, 'GET', P('/params/check'));
  const built = ck.body.checks.find(c => c.check === 'built');
  assert.equal(built.ok, false);
  assert.match(built.why, /failed/);
  const st = await H.api(null, 'GET', P('/params/build'));
  assert.equal(st.body.last.ok, false);
});

test('a value typed twice into a template is found', async () => {
  fs.writeFileSync(path.join(root, 'bad.tmpl.json'), JSON.stringify({ box: [258, 130, 8], caption: 'Crate 258 x 130', w: '${w}' }));
  const r = await require('../modules/checks').run({ literals: path.join(root, 'bad.tmpl.json') }, { cwd: root });
  assert.equal(r.ok, false);
  assert.match(r.why, /5 values typed in/);   // 258 and 130 in the list and the caption, and the label
  assert.match(r.why, /box\[0\] = 258 \(\$\{w\}\)/);
});

test('a build changed since this person ran it is shown before the next Save, and runs once accepted', async () => {
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'project.params.json'), 'utf8'));
  doc.build[1].checks.push({ file: 'sheet/out.json', contains: 'title' });
  fs.writeFileSync(path.join(root, 'project.params.json'), JSON.stringify(doc, null, 2));
  let r = await H.api(null, 'POST', P('/params'), { values: { w: 205 } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'build_changed');
  assert.ok(r.body.change.diff.some(l => l.includes('title')), JSON.stringify(r.body.change));
  r = await H.api(null, 'POST', P('/params'), { values: { w: 205 }, acceptBuild: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await done();
  assert.equal(fs.readFileSync(path.join(root, 'parts', 'box.txt'), 'utf8').trim(), 'W=205 H=130');
  assert.equal(require('../modules/params/stamp').builtNow(root).ok, true);
});

test('the agent reads the parameters and builds when asked, with no model', async () => {
  const tools = require('../modules/harness/tools');
  const chat = await H.api(null, 'POST', P('/chat'));
  const ctx = { sessionId: chat.body.sessionId, user: { ...H.owner.user, role: 'owner', orgId: H.owner.orgId }, byPerson: true };
  const shown = await tools.call('project_params', { action: 'show' }, [], ctx);
  assert.match(shown, /w = 205 mm/);
  assert.match(shown, /Built from the current values/);
  const notAsked = await tools.call('project_params', { action: 'set', values: { w: 215 } }, [], ctx);
  assert.match(notAsked, /^Not set/);
  const set = await tools.call('project_params', { action: 'set', values: { w: 215 }, asked: true }, [], ctx);
  assert.match(set, /Saved w 205 → 215/);
  await done();
  assert.equal(fs.readFileSync(path.join(root, 'parts', 'box.txt'), 'utf8').trim(), 'W=215 H=130');
  const status = await tools.call('project_params', { action: 'status' }, [], ctx);
  assert.match(status, /Built from the current values/);
});
