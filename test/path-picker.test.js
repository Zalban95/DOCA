'use strict';

/**
 * A path is chosen from a tree (asked 2026-10-10: "When opening any path, let's open a tree, not just typing the
 * address"). The tree reads the Files tab's own routes, so it follows the Files tab's rule: this machine's folders are
 * a host's to browse, inside the roots the panel may open, never a protected folder. And every field in the panel that
 * takes a path on this machine offers the tree beside it.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

test('the tree is a host\'s, inside the roots, and never a protected folder', async () => {
  await H.start();
  try {
    let r = await H.api(null, 'GET', '/api/files/roots');
    assert.equal(r.status, 200);
    assert.ok(r.body.roots.length, 'roots to start from');
    const dir = fs.mkdtempSync(path.join(process.env.WORKSPACE_DIR, 'tree-'));
    fs.mkdirSync(path.join(dir, 'inner'));
    r = await H.api(null, 'GET', `/api/files/list?path=${encodeURIComponent(dir)}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.entries.some(e => e.name === 'inner' && e.isDir), 'a level at a time, folders marked');
    // The protected keys folder is refused even to a host, as the Files tab refuses it.
    const keys = path.join(process.env.DOCA_DATA_DIR, 'keys');
    fs.mkdirSync(keys, { recursive: true });
    r = await H.api(null, 'GET', `/api/files/list?path=${encodeURIComponent(keys)}`);
    assert.equal(r.status, 403);
    r = await H.api(null, 'GET', `/api/files/list?path=${encodeURIComponent(path.join(dir, '..', '..', '..', '..', '..', 'proc', '1'))}`);
    assert.notEqual(r.status, 200, 'a climb out of the roots reads nothing');
    // Someone without host is told to type the path: the routes refuse them.
    const member = await H.signIn('member');
    r = await H.api(null, 'GET', '/api/files/roots', undefined, { Cookie: member.cookie, 'X-Doca-Password': '' });
    assert.equal(r.status, 403);
    r = await H.api(null, 'GET', `/api/files/list?path=${encodeURIComponent(dir)}`, undefined, { Cookie: member.cookie, 'X-Doca-Password': '' });
    assert.equal(r.status, 403);
  } finally { await H.stop(); }
});

/** Fields that look like a path but are not one on this machine, and why. */
const NOT_A_PICK = [
  ['index.html', 'fmGoPath(event)', 'the Files tab\'s own address bar: the tree is beside it already'],
  ['index.html', 'server-filesystem', 'an MCP server\'s arguments, one per line'],
  ['index.html', '/host/path:/container/path', 'a container\'s volumes, host and container paths in pairs'],
  ['js/settings/service-keys.js', 'paths:', 'an OpenAPI document, not a path'],
];

test('every field that takes a path offers the tree', () => {
  const files = ['index.html', ...fs.readdirSync(path.join(PUB, 'js'), { recursive: true }).filter(f => f.endsWith('.js')).map(f => `js/${f.split(path.sep).join('/')}`)];
  const bare = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(PUB, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = /placeholder="([^"]*)"/.exec(line);
      if (!m || !/(^|\s|“)(\/[\w.-]+\/|~\/|[A-Z]:\\)|\bfolder on this machine\b|\/path\/to/.test(m[1])) return;
      if (NOT_A_PICK.some(([file, piece]) => file === f && line.includes(piece))) return;
      const near = lines.slice(Math.max(0, i - 1), i + 4).join('\n');
      if (!/data-path-pick|fpOpen\(|snapBrowsePath|fpPick\(/.test(near)) bare.push(`${f}:${i + 1} ${m[1]}`);
    });
  }
  assert.deepEqual(bare, [], 'add data-path-pick="dir|file" to the input (fp.js draws its 📁), or say on NOT_A_PICK why it is not a path');
});

test('the picker opens the way down to the path a field already holds', () => {
  const src = fs.readFileSync(path.join(PUB, 'js/fp.js'), 'utf8');
  for (const fn of ['fpOpen', 'fpPick', 'pathPickEnhance', '_fpLoadRoots', 'fpConfirm', 'fpClose']) assert.match(src, new RegExp(`function ${fn}\\(`));
  assert.match(src, /\/api\/files\/roots/);
  assert.match(src, /\/api\/files\/list\?path=/);
  // + Open folder on Projects asks through the tree, not a typed prompt.
  const ide = fs.readFileSync(path.join(PUB, 'js/projects/ide.js'), 'utf8');
  assert.match(ide, /async function pjNew\(\)[\s\S]{0,200}fpPick\(/);
});

/** The picker run in a sandbox over a made-up disk: what it asked for, and what it said. */
async function pickerOver(disk, want) {
  const vm = require('node:vm');
  const asked = [];
  const el = () => ({ innerHTML: '', textContent: '', value: '', style: {}, setAttribute() {}, querySelector: () => null });
  const els = { 'fp-list': el(), 'fp-breadcrumb': el(), 'fp-selected': el(), 'fp-modal': el(), 'fp-title': el() };
  const ctx = { document: { getElementById: id => els[id] || null }, escHtml: s => String(s), CSS: { escape: s => s },
    apiFetch: async url => {
      asked.push(url);
      if (url === '/api/files/roots') return { roots: ['/home/a'] };
      const p = decodeURIComponent(url.split('path=')[1]);
      if (!disk[p]) throw new Error('404 There is no folder');
      return { entries: disk[p] };
    } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUB, 'js/fp.js'), 'utf8'), ctx);
  await ctx._fpLoadRoots(want);
  return { asked, crumb: els['fp-breadcrumb'].textContent, selected: vm.runInContext('FP.selected', ctx) };
}

test('a folder that does not exist yet: nothing is asked for it, and the tree starts from the nearest one that does', async () => {
  const disk = { '/home/a': [{ name: 'docs', isDir: true }, { name: 'x.txt', isDir: false }], '/home/a/docs': [] };
  const r = await pickerOver(disk, '/home/a/.ollama/models');
  assert.deepEqual(r.asked, ['/api/files/roots', `/api/files/list?path=${encodeURIComponent('/home/a')}`], 'no 404 for a folder not there');
  assert.equal(r.selected, '/home/a', 'the nearest folder that exists is where it starts');
  assert.match(r.crumb, /\/home\/a\/\.ollama\/models does not exist yet — this starts from \/home\/a, the nearest folder that does/);
  // One that exists opens all the way down, with no note.
  const ok = await pickerOver(disk, '/home/a/docs');
  assert.equal(ok.selected, '/home/a/docs');
  assert.equal(ok.crumb, '/home/a/docs');
  assert.equal(ok.asked.length, 3);
});
