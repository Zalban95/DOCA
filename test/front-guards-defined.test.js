'use strict';

/**
 * A front-end call behind `typeof name === 'function'` must name something that exists. The panel's scripts guard
 * calls to each other this way so a page loads without the others — and so a name that exists nowhere fails in
 * silence: `authHasRight`, guarding every "host only" part of the panel since 2.205, was never defined, and every such
 * check passed for everyone (audit 2026-10-17); `settingsLoad` and `toast` likewise did nothing. Browser built-ins and
 * libraries loaded at run time are listed by name.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const BUILTIN = new Set(['document', 'window', 'navigator', 'MutationObserver', 'ResizeObserver', 'Notification', 'AbortSignal', 'matchMedia',
  'getComputedStyle', 'requestIdleCallback', 'Worker', 'setInterval', 'structuredClone', 'BroadcastChannel', 'IntersectionObserver',
  'Terminal', 'FitAddon', 'monaco', 'require', 'module', 'process', 'chrome', 'browser', 'ort', 'THREE']);   // xterm, Monaco, ONNX, three.js: fetched when a page needs them

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));

test('every typeof-guarded name in the panel\'s scripts is defined somewhere', () => {
  const files = walk(path.join(ROOT, 'js'));
  const all = files.map(f => fs.readFileSync(f, 'utf8')).join('\n') + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const missing = [];
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*[!=]==?\s*['"](?:function|undefined)['"]/g)) {
      const n = m[1];
      if (BUILTIN.has(n)) continue;
      const e = n.replace(/\$/g, '\\$');
      const defined = new RegExp(`function\\s*\\*?\\s*${e}\\s*\\(|(?:let|const|var|class)\\s+${e}\\b|[,{]\\s*${e}\\s*=|(?:window|globalThis)\\.${e}\\s*=`).test(all);
      if (!defined) missing.push(`${n} (${path.relative(ROOT, f)})`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'guarded calls to something no script defines');
});
