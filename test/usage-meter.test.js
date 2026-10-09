'use strict';
require('./helpers');

/**
 * The usage meter (public/js/agent-ui/context-meter.js): a window's use over the window with its fold point, else
 * each turn against 1,000,000 with the finished turns as chips; nothing measured is "—", never 0; a harness that
 * reports nothing gets no meter. Run in a sandbox: the file is a classic script of globals.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

function load() {
  const ctx = { document: { addEventListener() {}, getElementById: () => null }, escHtml: s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'agent-ui', 'context-meter.js'), 'utf8'), ctx);
  return ctx;
}
const width = html => Number(/um-fill" style="[^"]*width:([\d.]+)%/.exec(html)[1]);
const label = html => /class="um-num">([^<]*)</.exec(html)[1];
const unit  = html => /class="um-unit"> ([^<]*)</.exec(html)[1];
const chips = html => (html.match(/<i style=/g) || []).length;

test('a declared window: used over the window, the fold as a tick, the value for a reader', () => {
  const m = load();
  const html = m.usageMeterHtml({ contextTokens: 60000, contextWindow: 1000000, compactPercent: 70, compactAt: 700000 }, 'a');
  assert.equal(label(html), '60k');
  assert.match(html, /um-of"> of 1M</);
  assert.equal(unit(html), 'context');
  assert.equal(width(html), 6);
  assert.match(html, /class="um-fold" style="left:70%"/);
  assert.match(html, /role="meter"[^>]*aria-valuenow="60000"/);
  assert.match(html, /Past 70%, older messages fold into a summary/);
});

test('a token budget is a limit too: the one closest to it is shown, every one is in the card', () => {
  const m = load();
  m.usageBudget = () => ({ budget: { tokensPerDay: { limit: 5e6, from: 'own' } }, today: 4.2e6, month: 9e6 });
  let html = m.usageMeterHtml({ contextTokens: 60000, contextWindow: 1000000 }, 'e');
  assert.equal(unit(html), 'today');
  assert.equal(label(html), '4.2M');
  assert.match(html, /Today: 4.2M of your 5M budget, set by you\./);
  assert.match(html, /Context: 60k of the model/);
  m.usageBudget = () => ({ budget: { tokensPerDay: { limit: 5e6, from: 'admin' } }, today: 10, month: 10 });
  html = m.usageMeterHtml({ contextTokens: 900000, contextWindow: 1000000 }, 'e');
  assert.equal(unit(html), 'context');
  assert.match(html, /set by an admin/);
});

test('the colour walks the heat map from the first stop to the last', () => {
  const m = load();
  assert.equal(m.usageHeat(0), 'color-mix(in oklch, var(--heat-1) 0%, var(--heat-0))');
  assert.equal(m.usageHeat(0.5), 'color-mix(in oklch, var(--heat-3) 0%, var(--heat-2))');
  assert.equal(m.usageHeat(1), 'color-mix(in oklch, var(--heat-4) 100%, var(--heat-3))');
  assert.equal(m.usageHeat(7), m.usageHeat(1), 'past the limit stays red');
});

test('no window: each turn against 1M, finished turns become chips, a redraw adds nothing', () => {
  const m = load();
  let html = m.usageMeterHtml(null, 'b');
  assert.equal(label(html), '—', 'nothing measured is not 0');
  assert.equal(unit(html), 'this turn');
  assert.equal(width(html), 0);
  assert.doesNotMatch(html, /aria-valuenow/);
  const s1 = { steps: 1, totalTokens: 20000, promptTokens: 19000, completionTokens: 1000, contextWindow: null };
  const s2 = { steps: 2, totalTokens: 250000, promptTokens: 240000, completionTokens: 10000, contextWindow: null };
  m.usageMeterHtml(s1, 'b');
  html = m.usageMeterHtml(s2, 'b');
  assert.equal(label(html), '250k');
  assert.match(html, /This turn: 250k of 1M — no limit set\./);
  assert.equal(chips(html), 0, 'the same turn is not a chip');
  html = m.usageMeterHtml(s2, 'b');
  assert.equal(chips(html), 0, 'drawing the same event again is not a new turn');
  html = m.usageMeterHtml({ steps: 1, totalTokens: 1600000, promptTokens: 1500000, completionTokens: 100000 }, 'b');
  assert.equal(chips(html), 1, 'the turn before is a chip');
  assert.equal(label(html), '1.6M');
  assert.equal(width(html), 100);
  html = m.usageMeterHtml(null, 'b');
  assert.equal(label(html), '1.6M', 'opening the conversation again keeps what was measured');
  assert.match(html, /a scale, not a limit/);
  assert.match(html, /Turns before: 250k\./);
  assert.equal(chips(m.usageMeterHtml(null, 'c')), 0, 'another conversation has its own');
});

test('a harness that reports nothing gets no meter; an estimate is marked', () => {
  const m = load();
  assert.equal(m.usageMeterHtml(undefined, 'd'), '');
  const html = m.usageMeterHtml({ steps: 1, totalTokens: 900, source: 'estimated' }, 'd');
  assert.equal(label(html), '~900');
  assert.match(html, /Estimated/);
});

test('the meter is loaded with its stylesheet, and the dotted ring is gone', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /css\/usage-meter\.css/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'usage-meter.css'), 'utf8');
  for (let i = 0; i < 5; i++) assert.equal((css.match(new RegExp(`--heat-${i}:`, 'g')) || []).length, 2, `--heat-${i} on both grounds`);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'components.css'), 'utf8'), /\.ctx-ring/);
});
