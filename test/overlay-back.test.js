'use strict';

// Overlays and Back (public/js/agent-ui/media-viewer.js overlayBack): one overlay closing itself on another — a
// select's sheet on the Cast sheet (2026-10-13) — steps history back once, and the overlay beneath stays; Back then
// closes the one on top only. Run in a sandbox with a stand-in history: no browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sandbox() {
  const stack = [{}], listeners = new Set();
  const history = {
    get state() { return stack[stack.length - 1]; },
    pushState(s) { stack.push(s); },
    back() { if (stack.length > 1) { stack.pop(); queueMicrotask(() => { for (const fn of [...listeners]) fn(); }); } },
  };
  const window = { addEventListener: (t, fn) => t === 'popstate' && listeners.add(fn), removeEventListener: (t, fn) => listeners.delete(fn) };
  const ctx = vm.createContext({ history, window, document: { getElementById: () => null }, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/agent-ui/media-viewer.js'), 'utf8'), ctx);
  return { ctx, history, depth: () => stack.length };
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('a sheet closing itself on the Cast sheet leaves the Cast sheet open', async () => {
  const { ctx, depth } = sandbox();
  const closed = [];
  ctx.overlayBack(() => closed.push('cast'));
  const releaseSheet = ctx.overlayBack(() => closed.push('sheet'));
  releaseSheet();   // a choice was made: the sheet takes its own step back
  await tick();
  assert.deepEqual(closed, []);
  assert.equal(depth(), 2, 'the Cast sheet\'s step is still there');
});

test('Back closes the one on top, then the one beneath', async () => {
  const { ctx, history } = sandbox();
  const closed = [];
  ctx.overlayBack(() => closed.push('cast'));
  ctx.overlayBack(() => closed.push('sheet'));
  history.back(); await tick();
  assert.deepEqual(closed, ['sheet']);
  history.back(); await tick();
  assert.deepEqual(closed, ['sheet', 'cast']);
});
