'use strict';

/**
 * The shape of the source tree, held in place.
 *
 * The project started as many small files and drifted back into a few large
 * ones, one reasonable addition at a time — no single commit made a file too
 * big, so no single review said so. These tests are the review that does not
 * get tired. See TODO.md → "Modules with explicit contracts, not one function
 * per file" for why the unit is one idea per file, not one function.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const frontend = require('./frontend');

const ROOT = path.join(__dirname, '..');

/** A file past this many lines is doing more than one thing. */
const CEILING = 400;

/**
 * Files already past the ceiling when it was introduced, at the size they were.
 * A file here may shrink but not grow, and once it shrinks its number here must
 * come down with it — so this list only ever gets shorter. Do not add to it:
 * split the file instead.
 */
const OVER = {
  'modules/harness/agent.js':      433,  // runTurn alone is 320 lines: next, split the turn's steps
  'public/index.html':            1537,  // + the split scripts' <script> tags; ES modules take them back out
  'public/css/components.css':    1171,
  'public/js/chat.js':             986,
  'public/js/files.js':            875,
  'public/js/settings.js':         515,
  'public/js/models.js':           687,
  'modules/harness/memory.js':     608,
  'modules/api-v1/router.js':      597,
  'modules/api-v1/openapi.js':     583,
  'modules/agents/missions.js':    496,
  'modules/api-v1/prompts.js':     467,
  'public/js/markdown.js':         462,
  'server.js':                     358,
  'modules/harness/budget.js':     424,
  'modules/chat.js':               412,
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? walk(path.join(dir, e.name))
    : [path.join(dir, e.name)]);
}

function sources() {
  return [
    ...walk(path.join(ROOT, 'public')).filter(f => /\.(js|css|html)$/.test(f)),
    ...walk(path.join(ROOT, 'modules')).filter(f => f.endsWith('.js')),
    path.join(ROOT, 'server.js'),
  ].map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

const lines = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').length - 1;

test(`no source file grows past ${CEILING} lines`, () => {
  const files = sources();
  assert.ok(files.length > 100, 'the walk found the source tree');   // not an empty pass

  const over = files.filter(f => !(f in OVER) && lines(f) > CEILING)
    .map(f => `${f} (${lines(f)})`);
  assert.deepEqual(over, [], `past ${CEILING} lines — split it along its seams rather than raise the ceiling`);

  const grew = Object.entries(OVER).filter(([f, max]) => files.includes(f) && lines(f) > max)
    .map(([f, max]) => `${f}: ${max} → ${lines(f)}`);
  assert.deepEqual(grew, [], 'an oversized file grew; move the new code to its own file');
});

test('the list of oversized files only gets shorter', () => {
  // A file that shrank keeps its old allowance unless the number here comes
  // down too, and then it could quietly grow back to it.
  const stale = Object.entries(OVER).filter(([f, max]) => {
    const p = path.join(ROOT, f);
    return !fs.existsSync(p) || lines(f) < max;
  }).map(([f, max]) => `${f}: listed ${max}, now ${fs.existsSync(path.join(ROOT, f)) ? lines(f) : 'gone'}`);
  assert.deepEqual(stale, [], 'lower (or remove) its entry in OVER');
});

test('no two front-end files define the same global', () => {
  // The page is classic scripts sharing one global scope. A second
  // `function x` in a later file silently replaces the first everywhere, and
  // a second `const x` stops the later file from loading at all.
  const where = new Map();
  for (const f of frontend.scripts()) {
    for (const m of frontend.read(f).matchAll(/^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (!where.has(m[1])) where.set(m[1], []);
      where.get(m[1]).push(f);
    }
  }
  const twice = [...where].filter(([, fs]) => fs.length > 1).map(([n, fs]) => `${n}: ${fs.join(', ')}`);
  assert.deepEqual(twice, [], 'rename one, or move the shared one to lib/');
});

test('every script the page loads exists, and every script that exists is loaded', () => {
  // index.html loads the app; login.html loads only its own script.
  const loginPage = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
  const loaded = [...frontend.scripts(), ...[...loginPage.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1])];
  const onDisk = frontend.files();
  assert.deepEqual(loaded.filter(f => !onDisk.includes(f)), [], 'index.html loads a file that is not there');
  assert.deepEqual(onDisk.filter(f => !loaded.includes(f)), [], 'a front-end file nothing loads');
});
