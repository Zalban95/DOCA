'use strict';

/** What ships names nobody in particular (CONSTITUTION P8, P9; audit 2026-10-06): no owner's name, home folder,
 *  machine or tailnet in the panel, the server, the skills or the tests' sample data. CONSTITUTION.md, AGENTS.md
 *  and the design records name the owner on purpose — they are for the people and agents who build DOCA. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.name === 'node_modules' || e.name === 'vendor' ? []
  : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const PERSONAL = /\/home\/al\b|\/media\/al\b|al-office-desk|tail08f157|\bAl's\b|\bwith Al\b|\bportal PC\b/i;

test('the panel, the server, the skills and the tests name no particular person or machine', () => {
  const hits = [];
  for (const dir of ['public', 'modules', 'skills', 'bin', 'clients', 'test'])
    for (const f of walk(path.join(ROOT, dir)).filter(f => /\.(js|html|css|md|json)$/.test(f) && f !== __filename))
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (PERSONAL.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`); });
  assert.deepEqual(hits, []);
});
