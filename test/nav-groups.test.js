'use strict';

/** The pages in groups (public/js/nav-groups.js): every page is in exactly one group, with a label. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('every page the panel routes is in exactly one group, and every group\'s page is a page', () => {
  const js = f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
  const ctx = { localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(`${js('nav.js')}\n${js('nav-groups.js')}\nthis.out = { NAV_TABS, NAV_GROUPS, NAV_LABELS };`, ctx);
  const { NAV_TABS, NAV_GROUPS, NAV_LABELS } = JSON.parse(JSON.stringify(ctx.out));
  const grouped = NAV_GROUPS.flatMap(g => g.tabs);
  assert.deepEqual([...grouped].sort(), [...NAV_TABS].sort(), 'a page outside every group is reachable nowhere');
  assert.equal(new Set(grouped).size, grouped.length, 'a page in two groups');
  for (const t of NAV_TABS) assert.ok(NAV_LABELS[t], `${t} has a label`);
});
