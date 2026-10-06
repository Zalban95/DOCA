'use strict';

/**
 * Contracts the hub and its clients share, held on the hub's side (audit 2026-10-06, cl 27, 31; TODO D2).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const protocol = fs.readFileSync(path.join(ROOT, 'PROTOCOL.md'), 'utf8');
const table = protocol.slice(protocol.indexOf('| Family | Canonical tools |'), protocol.indexOf('### 22.2'));

test('the family table names every tool a shipped skill or doca-client uses for a device', () => {
  const named = new Set([...table.matchAll(/`([a-z]+_[a-z_]+|shell)`/g)].map(m => m[1]));
  const client = fs.readdirSync(path.join(ROOT, 'clients/node')).filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(ROOT, 'clients/node', f), 'utf8')).join('\n');
  const used = new Set([...client.matchAll(/\b((?:files|screen|shell|processes|apps|device)_[a-z_]+)\b/g)].map(m => m[1]));
  for (const d of fs.readdirSync(path.join(ROOT, 'skills'))) {
    const f = path.join(ROOT, 'skills', d, 'SKILL.md');
    if (fs.existsSync(f)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/`((?:files|screen|input|apps|processes|device|media)_[a-z_]+)`/g)) used.add(m[1]);
  }
  assert.deepEqual([...used].filter(n => !named.has(n)).sort(), [], 'add it to the family table in PROTOCOL §22.1');
});
