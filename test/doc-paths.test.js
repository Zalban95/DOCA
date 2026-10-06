'use strict';

/**
 * Where the docs send a person is a page the panel has (audit 2026-10-06, coh F22; TODO C7): "Settings → API Keys",
 * "Settings → Services" and "Settings → Experiments" had all moved, and a skill the agent follows read them aloud.
 * Every "<Group> → <Page>" in the shipped docs, skills and client READMEs names a page of that group
 * (public/js/nav-groups.js), or for Settings a sub-tab or harness group (public/js/settings/subnav.js).
 * Another program's menus (Home Assistant's, the phone app's) are not the panel's and are left alone.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function pages() {
  const ng = read('public/js/nav-groups.js');
  const groups = eval(`(${ng.match(/const NAV_GROUPS = (\[[\s\S]*?\n\]);/)[1]})`);
  const labels = eval(`(${ng.match(/const NAV_LABELS = (\{[\s\S]*?\});/)[1]})`);
  const sub = read('public/js/settings/subnav.js');
  const out = {};
  for (const g of groups) out[g.label] = g.tabs.map(t => labels[t]);
  out.Settings = [...sub.matchAll(/label: '([^']+)'/g)].map(m => m[1])
    .concat(Object.values(eval(`(${sub.match(/const _HARNESS_GROUPS = (\{[^}]*\});/)[1]})`)), 'Harnesses')
    .filter(l => !['API Keys', 'Connectors'].includes(l));   // Settings panels shown as Field pages since 2.236.0
  return out;
}

function docs() {
  const dir = d => fs.readdirSync(path.join(ROOT, d));
  return ['README.md', 'AGENTS.md', 'PROTOCOL.md', 'clients/browser/README.md', 'clients/node/README.md',
    ...dir('skills').map(d => `skills/${d}/SKILL.md`), ...dir('docs/api').filter(f => f.endsWith('.md')).map(f => `docs/api/${f}`),
    ...dir('docs/experiments').map(f => `docs/experiments/${f}`)].filter(f => fs.existsSync(path.join(ROOT, f)));
}

test('every "<Group> → <Page>" in the docs is a page the panel has', () => {
  const have = pages(), bad = [];
  for (const f of docs())
    for (const line of read(f).split('\n')) {
      if (/Home Assistant|Matter|Assistants|DocaMobile|in its Settings|their phone/.test(line)) continue;
      for (const m of line.matchAll(/\b(Settings|Field|Controls|Agents|Machines|Hub) → \**([A-Z][^→\n]{0,40})/g)) {
        const after = m[2].toLowerCase();
        if (!(have[m[1]] || []).some(p => after.startsWith(p.toLowerCase()))) bad.push(`${f}: ${m[1]} → ${m[2].trim().slice(0, 24)}`);
      }
    }
  assert.deepEqual([...new Set(bad)], []);
});
