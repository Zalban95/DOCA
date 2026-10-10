'use strict';

/**
 * Nothing goes without a way back (asked 2026-10-10: "Any delete anywhere in the UI needs a confirmation or a restore.
 * I just deleted a project, it didn't ask"). Every call in the panel that deletes, removes, forgets, revokes, clears
 * or puts something away is read here: it is asked first (appConfirm, machineAsk, appChoose, confirmRemove) or it
 * offers Undo (undoToast, archiveWithUndo) — or it is on ALLOWED below with the reason it needs neither.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', 'public', 'js');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));

/** A call that takes something away. */
const TAKES = /method: '(DELETE)'|\/(delete|forget|clear|purge|unlink)['`]|control\/revoke|\/archive['`].*method: 'POST'/;
/** What makes it safe: a question first, or Undo after. */
const GUARD = /\b(appConfirm|machineAsk|machineAskFirst|appChoose|confirmRemove|undoToast|archiveWithUndo)\(/;

/** file → a piece of the call's line, and why it needs neither a question nor Undo. */
const ALLOWED = [
  ['harness-console/approval.js', 'approval/always', 'forgetting an "always" only makes the agent ask again: it adds a guard, and the next card offers "always" back'],
  ['meet/share.js', "_meetPost('control/revoke')", 'ending someone\'s control of your own screen is the safety stop itself: it must act at once'],
  ['meet/share.js', "control/revoke', { grant", 'the "no" of the question that offered control — nothing was given yet'],
  ['harness-console/teams.js', '/archive', 'a team is put away, not deleted, and comes back from the Archive (file owned by the Teams page work)'],
  ['computers-strays.js', '/archive`', 'adopting a container DOCA did not record: nothing goes, it lands in the Archive'],
  ['wakeword.js', '/samples/', 'part of "Forget your recordings", asked once for both kinds just above'],
];

function sites() {
  const out = [];
  for (const f of walk(ROOT)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (rel === 'lib/undo.js') continue;   // the helper itself
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!TAKES.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const near = lines.slice(Math.max(0, i - 14), i + 9).join('\n');
      out.push({ rel, line: i + 1, text: line.trim(), guarded: GUARD.test(near) });
    });
  }
  return out;
}

test('every delete in the panel asks first or offers Undo', () => {
  const found = sites();
  assert.ok(found.length > 40, `the scan found only ${found.length} deletes: the pattern broke`);
  const bare = found.filter(s => !s.guarded && !ALLOWED.some(([f, piece]) => f === s.rel && s.text.includes(piece)));
  assert.deepEqual(bare.map(s => `${s.rel}:${s.line} ${s.text.slice(0, 120)}`), [],
    'ask with confirmRemove()/appConfirm() naming what goes, or offer undoToast() — or add it to ALLOWED with why');
});

test('every allowlisted delete still exists, and each says why', () => {
  const found = sites();
  for (const [f, piece, why] of ALLOWED) {
    assert.ok(why.length > 20, `${f}: say why`);
    assert.ok(found.some(s => s.rel === f && s.text.includes(piece)), `${f} no longer has "${piece}": take it off ALLOWED`);
  }
});

test('undoToast shows Undo, calls it, and goes by itself', async () => {
  const made = [];
  const el = tag => {
    const e = { tag, children: [], classList: { add() {} }, listeners: {}, remove() { e.removed = true; }, setAttribute() {},
      appendChild(c) { e.children.push(c); return c; }, addEventListener(t, fn) { e.listeners[t] = fn; } };
    made.push(e);
    return e;
  };
  const body = el('body');
  const ctx = { document: { body, getElementById: id => made.find(e => e.id === id) || null, createElement: el },
    setTimeout: (fn, ms) => (ms <= 200 ? fn() : setTimeout(fn, 5)), clearTimeout, apiFetch: async () => ({}) };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/undo.js'), 'utf8'), ctx);
  let undone = 0;
  ctx.undoToast('Project put away — its folder is untouched.', () => { undone++; }, { ms: 1 });
  const toast = body.children[0].children[0];
  assert.equal(toast.children[0].textContent, 'Project put away — its folder is untouched.');
  const undo = toast.children.find(c => c.textContent === 'Undo');
  assert.ok(undo, 'an Undo button');
  await undo.onclick();
  assert.equal(undone, 1);
  await new Promise(r => setTimeout(r, 30));
  assert.ok(toast.removed, 'the toast goes by itself');
});

test('a project put away comes back when its folder is opened again, and from the Archive', async () => {
  await H.start();
  const dir = fs.mkdtempSync(path.join(process.env.WORKSPACE_DIR, 'proj-'));
  const { project } = await H.api(null, 'POST', '/api/projects', { root: dir }).then(r => r.body);
  assert.ok(project?.id);
  let r = await H.api(null, 'POST', `/api/archive/project/${project.id}`, { on: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.root, dir, 'the toast can name the folder that stays');
  assert.ok(fs.existsSync(dir), 'the folder is untouched');
  r = await H.api(null, 'GET', '/api/projects');
  assert.ok(!r.body.projects.some(p => p.id === project.id), 'out of the list');
  r = await H.api(null, 'POST', '/api/projects', { root: dir });
  assert.equal(r.body.project.id, project.id, 'the same project');
  assert.equal(r.body.project.restored, true);
  assert.ok(!r.body.project.archivedAt);
  r = await H.api(null, 'GET', '/api/projects');
  assert.ok(r.body.projects.some(p => p.id === project.id), 'back in the list');
  await H.api(null, 'POST', `/api/archive/project/${project.id}`, { on: true });
  r = await H.api(null, 'POST', `/api/archive/project/${project.id}`, { on: false });   // Undo, and the Archive's Restore
  assert.equal(r.status, 200);
  r = await H.api(null, 'GET', '/api/projects');
  assert.ok(r.body.projects.some(p => p.id === project.id));
  await H.stop();
});
