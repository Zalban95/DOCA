'use strict';

/**
 * The asks of 2026-10-10, in a browser where one is found (and the rules without one): people chosen like a mail's
 * To: line (lib/people-pick.js), a project put away with Undo (lib/undo.js), a path chosen from a tree (fp.js), and a
 * page that loads again when the hub runs another version unless something typed would be lost (lib/page-reload.js).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)
const headless = require('../modules/headless');

/* ── The rules, without a page ── */

function rules() {
  const ctx = { escHtml: s => String(s) };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public/js/lib/people-pick.js'), 'utf8'), ctx);
  return ctx;
}
const ids = list => JSON.parse(JSON.stringify([...list].map(p => p.id)));
const PEOPLE = [{ id: 'u1', name: 'Alice Martin', sub: 'Design' }, { id: 'u2', name: 'Alberto Rossi' }, { id: 'u3', name: 'Bob Allen' },
  { id: 'u4', name: 'Carla Bianchi', sub: 'Sales' }, { id: 'u5', name: 'Alma Off', may: false }];

test('suggestions: a name that starts so first, then a word, then anywhere; the chosen and the unreachable last', () => {
  const r = rules();
  assert.deepEqual(ids(r.peoplePickMatch(PEOPLE, 'al')), ['u2', 'u1', 'u5', 'u3', 'u4'], 'Alberto, Alice, Alma (unreachable), then Bob Allen by a word, Carla by a part');
  assert.deepEqual(ids(r.peoplePickMatch(PEOPLE, 'al', ['u1'])), ['u2', 'u5', 'u3', 'u4'], 'the chosen are not offered again');
  assert.deepEqual(ids(r.peoplePickMatch(PEOPLE, 'sales')), ['u4'], 'by team or title too');
  assert.deepEqual(ids(r.peoplePickMatch(PEOPLE, 'zz')), []);
  assert.equal(r.peoplePickMatch(PEOPLE, '').length, 5, 'an empty field offers everyone');
  assert.equal(r.peoplePickEmail('guest@example.org'), 'guest@example.org');
  assert.equal(r.peoplePickEmail(' Guest Person <Guest@Example.org> '), 'guest@example.org');
  assert.equal(r.peoplePickEmail('alice'), null);
  assert.equal(r.peoplePickEmail('a@b'), null);
});

/* ── In a browser ── */

const exe = headless.findBrowser();
const skip = !exe && 'no browser here';
let base, proc, profile, page;
const errors = [];
const evaluate = async expression => {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expression, ms = 15000) => {
  for (let t = 0; t < ms; t += 200) { if (await evaluate(expression)) return true; await headless.sleep(200); }
  return false;
};
const node = (p, extra = '') => `document.querySelector('#fp-list .fp-node${extra}[data-path="' + CSS.escape(${JSON.stringify(p)}) + '"]')`;
const key = async (k, code = k) => {
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: { Enter: 13, Backspace: 8, ArrowDown: 40, ArrowUp: 38 }[k] || 0 });
};
const typeText = async text => { for (const ch of text) await page.send('Input.dispatchKeyEvent', { type: 'char', text: ch }); };
const open = async () => {
  for (let attempt = 1; ; attempt++) {
    await page.send('Page.navigate', { url: `${base}/` });
    const loaded = await until("typeof NAV_TABS !== 'undefined' && typeof peoplePick === 'function' && document.readyState === 'complete'", 30000);
    if (!loaded && attempt < 3) continue;
    assert.ok(loaded, 'the panel loaded');
    break;
  }
  await headless.sleep(600);
};
function killBrowser() {
  if (!proc || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-proc.pid, 'SIGKILL');
  } catch { try { proc.kill('SIGKILL'); } catch { /* gone */ } }
}

before(async () => {
  if (skip) return;
  base = await H.start();
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-safety-'));
  proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...headless.ALONE,
    '--disable-gpu', '--window-size=1300,900', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
    { stdio: 'ignore', detached: process.platform !== 'win32' });
  process.once('exit', killBrowser);
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { killBrowser(); process.exit(1); });
  page = await headless.connect(await headless.devtools(profile));
  page.on(m => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await page.send('Runtime.enable');
  const [name, value] = H.owner.cookie.split('=');
  await page.send('Network.setCookie', { name, value, url: base });
  await open();
});

after(async () => {
  if (skip) return;
  try { page?.close(); } catch { /* gone */ }
  killBrowser();
  await headless.sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the OS cleans temp */ }
  await H.stop();
});

test('people: typed, suggested, added with the keys or a click, taken off with Backspace; a guest by address', { skip }, async () => {
  await evaluate(`(() => {
    const host = document.createElement('div'); host.id = 'pp-probe'; document.body.prepend(host);
    window._pp = peoplePick(host, { people: ${JSON.stringify(PEOPLE)}, emails: true });
    window._pp.input.focus();
  })()`);
  await typeText('alb');
  assert.ok(await until("document.querySelector('#pp-probe .pp-opt.on')?.textContent.includes('Alberto')"), 'Alberto suggested first');
  await key('Enter');
  assert.deepEqual(await evaluate('_pp.value().people'), ['u2']);
  await typeText('a');
  await key('ArrowDown');   // past Alice (first) to Alma, who cannot be reached: Enter adds nobody
  await key('Enter');
  assert.deepEqual(await evaluate('_pp.value().people'), ['u2'], 'an unreachable person is not added');
  await key('ArrowUp');
  await key('Enter');
  assert.deepEqual(await evaluate('_pp.value().people'), ['u2', 'u1'], 'Alice by the arrow keys');
  await typeText('guest@example.org,');
  assert.deepEqual(await evaluate('_pp.value().emails'), ['guest@example.org'], 'an address ended by a comma is a guest');
  await key('Backspace');
  assert.deepEqual(await evaluate('_pp.value()'), { people: ['u2', 'u1'], emails: [] }, 'Backspace takes the last chip off');
  await typeText('car');
  await evaluate(`(() => { const o = document.querySelector('#pp-probe .pp-opt'); o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()`);
  assert.deepEqual(await evaluate('_pp.value().people'), ['u2', 'u1', 'u4'], 'a click adds');
  await evaluate("document.querySelector('#pp-probe .pp-chip[data-id=\"u1\"] .pp-x').click()");
  assert.deepEqual(await evaluate('_pp.value().people'), ['u2', 'u4'], '✕ on a chip takes it off');
  await evaluate("document.getElementById('pp-probe').remove()");
});

test('meetings and the hive chat ask who with the same field', { skip }, async () => {
  await evaluate("nav('meetings')");
  assert.ok(await until("!!document.querySelector('#tab-meetings #mt-who .pp-input')"), 'Meetings: Who is a To: line');
  assert.equal(await evaluate("document.querySelectorAll('#tab-meetings .mt-people input[type=checkbox]').length"), 0, 'no ticking a list');
});

test('a project put away offers Undo, and Undo brings it back', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(process.env.WORKSPACE_DIR, 'undo-'));
  const { body } = await H.api(null, 'POST', '/api/projects', { root: dir });
  await evaluate(`archiveSet('project', ${JSON.stringify(body.project.id)}, true)`);
  assert.ok(await until("[...document.querySelectorAll('.undo-toast')].some(t => /folder .* is untouched/.test(t.textContent))"), 'the toast says the folder stays');
  let list = (await H.api(null, 'GET', '/api/projects')).body.projects;
  assert.ok(!list.some(p => p.id === body.project.id));
  await evaluate("[...document.querySelectorAll('.undo-toast .undo-btn')].at(-1).click()");
  assert.ok(await until("[...document.querySelectorAll('.undo-toast')].some(t => /Brought back/.test(t.textContent))"));
  list = (await H.api(null, 'GET', '/api/projects')).body.projects;
  assert.ok(list.some(p => p.id === body.project.id), 'back in the list');
});

test('a path is chosen from a tree, opened down to what the field holds', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(process.env.WORKSPACE_DIR, 'pick-'));
  fs.mkdirSync(path.join(dir, 'deeper', 'deepest'), { recursive: true });
  await evaluate(`void (window._picked = fpPick({ mode: 'dir', start: ${JSON.stringify(path.join(dir, 'deeper'))} }).then(v => (window._got = v)))`);
  assert.ok(await until(`!!${node(path.join(dir, 'deeper'), '.sel')}`), 'opened down to the folder, which is selected');
  assert.ok(await until(`!!${node(path.join(dir, 'deeper', 'deepest'))}`), 'its folders shown');
  await evaluate(`${node(path.join(dir, 'deeper', 'deepest'))}.click()`);
  await evaluate('fpConfirm()');
  assert.equal(await evaluate('window._got'), path.join(dir, 'deeper', 'deepest'));
  assert.equal(await evaluate("document.getElementById('fp-modal').style.display"), 'none');
});

test('another version: a page with something typed says so and waits (a free one reloads: test/page-reload.test.js)', { skip }, async () => {
  const typed = await evaluate(`(() => {
    const i = document.createElement('input'); i.id = 'pr-probe'; document.body.prepend(i); i.focus();
    return true;
  })()`);
  assert.ok(typed);
  await typeText('not sent yet');
  await evaluate(`pageVersionSeen('0.0.1-was')`);
  await evaluate(`pageVersionSeen('0.0.2-now')`);
  assert.ok(await until("/updated to v0\\.0\\.2-now[\\s\\S]*typed/.test(document.querySelector('.page-reload')?.textContent || '')"), 'it says why it waits');
  assert.ok(await evaluate("!!document.querySelector('.page-reload .undo-btn')"), 'with a Reload button');
});

test('no page error along the way', { skip }, () => {
  assert.deepEqual(errors, []);
});
