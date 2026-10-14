'use strict';

/**
 * The Workstream's activity reads as a two-column transcript (newcomer run 2026-10-14, b9): who in its own column,
 * what beside it, and the name once per run of lines by the same speaker. Run in a sandbox over workstream.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('a speaker\'s name heads its run of lines, in a column of its own', () => {
  const rows = [];
  const box = { scrollHeight: 0, scrollTop: 0, clientHeight: 0, append: r => rows.push(r), get lastElementChild() { return rows[rows.length - 1] || null; }, get firstElementChild() { return rows[0]; } };
  const ctx = { escHtml: s => String(s), document: { getElementById: id => (id === 'ws-console' ? box : null), createElement: () => ({ dataset: {} }) } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'workstream.js'), 'utf8'), ctx);
  ctx._wsActivity({ at: 1, who: 'Orchestrator', kind: 'thinking', text: 'The person asks' });
  ctx._wsActivity({ at: 2, who: 'Orchestrator', kind: 'command', text: 'skill(action, name)' });
  ctx._wsActivity({ at: 3, who: 'Tester', kind: 'text', text: 'done' });
  assert.match(rows[0].innerHTML, /^<span class="ws-who">Orchestrator<\/span><span class="ws-body">The person asks<\/span>$/);
  assert.match(rows[1].innerHTML, /^<span class="ws-who again">Orchestrator<\/span><span class="ws-body">skill\(action, name\)<\/span>$/);
  assert.match(rows[2].innerHTML, /^<span class="ws-who">Tester<\/span>/);
});
