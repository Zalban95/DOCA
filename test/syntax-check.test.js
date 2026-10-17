'use strict';

/**
 * A file the agent writes is checked for a syntax error at once (toolbox/syntax.js): the write happens, and its result
 * carries one line telling the agent to fix it now — JSON, JavaScript (module or script, by its package), Python, shell.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder

test.before(() => H.start());
test.after(() => H.stop());

test('a broken file says so in the write\'s result; a clean one says nothing more', async () => {
  const tools = require('../modules/harness/tools');
  const dir = fs.mkdtempSync(path.join(H.tmp, 'syntax-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const w = (name, content) => tools.call('write_file', { path: path.join(dir, name), content }, [], {});
  assert.doesNotMatch(await w('ok.js', 'export const a = 1;\n'), /does not parse/, 'an ES module in a module package is fine');
  assert.match(await w('bad.js', 'export function f( {\n  return 1;\n}\n'), /^Wrote \d+ bytes[\s\S]*\n⚠ It does not parse — fix it now: .*bad\.js/);
  assert.match(await w('bad.json', '{"a": 1,}'), /⚠ It does not parse/);
  assert.doesNotMatch(await w('ok.json', '{"a": 1}'), /does not parse/);
  assert.doesNotMatch(await w('notes.md', '# Not code (\n'), /does not parse/, 'a kind with no checker says nothing');
  const py = await w('bad.py', 'def f(:\n  pass\n');
  if (!/does not parse/.test(py)) console.error('[syntax] no python3 here: the Python check said nothing, as designed');
  assert.ok(fs.existsSync(path.join(dir, 'bad.js')), 'the write happened anyway');
  const r = await tools.call('replace_in_files', { path: path.join(dir, 'ok.js'), query: 'a = 1;', replacement: 'a = (1;', apply: true }, [], {});
  assert.match(r, /Replaced 1 occurrence[\s\S]*⚠ ok\.js: It does not parse/);
});
