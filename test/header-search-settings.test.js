'use strict';

/**
 * The header search finds settings, not only pages (deep test A, 2026-10-08: 15 of 22 newcomer words — "theme",
 * "dark", "manual", "wake word" — found nothing). In a real browser: a word lists the setting from the hub's own rows
 * (GET /api/settings/find), and choosing it opens its page and marks the field — every Advanced fold around it opened.
 * Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const B = require('./panel-browser');

before(() => B.start({ setup: B.pastFirstRun }));
after(() => B.stop());

const search = async q => {
  await B.evaluate(`(() => { document.getElementById('global-search-results').innerHTML = '';
    const i = document.getElementById('global-search'); i.value = ${JSON.stringify(q)}; globalSearchDebounced(); })()`);
  assert.ok(await B.until(`[...document.querySelectorAll('#global-search-results .header-search-item')].some(e => e.textContent.includes('✎'))`), `settings listed for "${q}"`);
  return B.evaluate(`[...document.querySelectorAll('#global-search-results .header-search-item')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`);
};
const choose = label => B.evaluate(`(() => { const i = _searchPlaces.findIndex(p => p.setting && p.label.startsWith(${JSON.stringify(label)})); globalSearchPlace(i); return i; })()`);

test('"theme" lists the colour theme, and choosing it opens Appearance marked', { skip: B.skip }, async () => {
  const items = await search('theme');
  assert.ok(items.some(t => /Colour theme .*Settings → General/.test(t)), items.join(' | '));
  if (process.env.DOCA_SHOTS) await B.shot(`${process.env.DOCA_SHOTS}/settings-search-results.png`);
  assert.ok(await choose('Colour theme') >= 0);
  assert.ok(await B.until("document.querySelector('#theme-picker-grid.setting-found') !== null"), 'the colours are marked');
  assert.equal(await B.evaluate("typeof pageShown === 'function' ? pageShown('settings') : true"), true);
  if (process.env.DOCA_SHOTS) await B.shot(`${process.env.DOCA_SHOTS}/settings-search-theme.png`);
});

test('"approval" opens the Auto / Manual switch on Agents → Harness', { skip: B.skip }, async () => {
  const items = await search('approval');
  assert.ok(items.some(t => /Approval mode/.test(t)), items.join(' | '));
  await choose('Approval mode');
  assert.ok(await B.until("document.querySelector('#hc-approval.setting-found') !== null"), 'the switch is marked');
});

test('a setting under Advanced has its fold opened', { skip: B.skip }, async () => {
  await search('mcp timeout');
  await choose('MCP timeouts');
  const ok = await B.until(`(() => { const f = document.querySelector('[data-leaf="mcpSettings.callTimeoutMs"]');
    return f && f.classList.contains('setting-found') && f.closest('details').open; })()`);
  assert.ok(ok, await B.evaluate(`JSON.stringify({ tab: typeof currentTab !== 'undefined' && currentTab, f: !!document.querySelector('[data-leaf="mcpSettings.callTimeoutMs"]'), cls: document.querySelector('[data-leaf="mcpSettings.callTimeoutMs"]')?.className })`));
  if (process.env.DOCA_SHOTS) await B.shot(`${process.env.DOCA_SHOTS}/settings-search-fold.png`);
  assert.deepEqual(B.errors, []);
});
