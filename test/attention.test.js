'use strict';

/**
 * The panel tells the app hosting it which dialogs wait for the person (public/js/lib/attention.js): kinds only, and
 * by the dialogs' own ids, which this holds to index.html and the code that opens them — a renamed dialog fails here
 * instead of silently stopping DocaDesk's notices.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('every id attention.js reads is a dialog the panel really opens', () => {
  const src = pub('js/lib/attention.js');
  const ids = JSON.parse(src.match(/ATTENTION_IDS = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  const html = pub('index.html');
  for (const id of [ids.prompt, ids.promptInput, ids.confirm]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(pub('js/agent-ui/approval.js'), new RegExp(`overlay.id = '${ids.approval}'`));
  assert.match(html, /js\/lib\/attention\.js/, 'loaded by the page');
});

test('it posts the kinds only, and once per change', () => {
  const els = {};
  const el = (open, extra = {}) => ({ classList: { contains: c => c === 'open' && el.state[open] }, ...extra });
  el.state = {};
  els['app-prompt-modal'] = el('prompt');
  els['app-prompt-input'] = { type: 'password', value: 'secret-value' };
  els['app-confirm-modal'] = el('confirm');
  const sent = [];
  const ctx = { document: { getElementById: id => els[id] || null, readyState: 'complete', body: {} }, MutationObserver: class { observe() {} },
    JSON };
  ctx.window = ctx; ctx.window.top = ctx;
  ctx.window.chrome = { webview: { postMessage: m => sent.push(m) } };
  vm.runInNewContext(pub('js/lib/attention.js'), ctx);
  const last = () => JSON.parse(JSON.stringify(sent.at(-1)));   // made in another realm
  assert.deepEqual(last().kinds, []);
  el.state.prompt = true; ctx.attentionTell();
  assert.deepEqual(last(), { type: 'doca.attention', kinds: ['password'] });
  assert.ok(!JSON.stringify(sent).includes('secret-value'), 'never a value');
  ctx.attentionTell();
  assert.equal(sent.length, 2, 'unchanged: not sent again');
  els['approval-overlay'] = {}; ctx.attentionTell();
  assert.deepEqual(last().kinds, ['password', 'approval']);
});
