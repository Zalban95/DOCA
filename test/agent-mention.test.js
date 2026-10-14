'use strict';

/**
 * The chip a transcript draws for what a turn made (public/js/agent-ui/mention.js): drawn from the `mention` event and
 * from a reloaded tool row alike, it opens what it names, and its point follows the live feed.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

require('./helpers');

/** Just the DOM the chip uses: elements with children, classes, data and text. */
function el(tag) {
  const e = { tagName: tag.toUpperCase(), children: [], dataset: {}, className: '', textContent: '', title: '',
    append(...xs) { this.children.push(...xs); }, appendChild(x) { this.children.push(x); return x; },
    querySelector(sel) { return all(this).find(x => match(x, sel)) || null; } };
  return e;
}
const all = root => root.children.flatMap(c => [c, ...all(c)]);
const match = (x, sel) => sel === '.pt' ? /\bpt\b/.test(x.className) : sel.startsWith(':scope') ? false : false;
const text = x => x.textContent + x.children.map(text).join(' ');

function load(extra = {}) {
  const box = el('div'), heard = {};
  const ctx = vm.createContext({ ...extra, CSS: { escape: s => s },
    liveOn: (topic, fn) => { heard[topic] = fn; return () => {}; },
    document: { createElement: el, getElementById: () => null,
      querySelectorAll: sel => all(box).filter(x => x.className === 'agent-mention' && sel.includes(`"${x.dataset.kind}"`)) } });
  for (const f of ['agent-ui/mention.js', 'agent-ui/event-sink.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'), ctx);
  return { ctx, box, heard };
}

test('a mention event draws a chip naming what was made, and its point follows the live feed', () => {
  const { ctx, box, heard } = load();
  ctx.box = box;
  const sink = vm.runInContext(`agentEventSink({ stream: { feed() {}, finish() {} }, fold: () => null, note: () => null,
    image() {}, approval() {}, error() {}, mention: m => agentMentionAppend(box, m) })`, ctx);
  sink.onEvent({ type: 'mention', mention: { kind: 'mission', id: 'msn_1', sessionId: 's_9', title: 'Builder: make it', state: 'running' } });
  const chip = box.children[0];
  assert.equal(chip.className, 'agent-mention');
  assert.equal(chip.dataset.kind, 'mission');
  assert.match(text(chip), /Specialist/);
  assert.match(text(chip), /Builder: make it/);
  assert.match(chip.querySelector('.pt').className, /pt-run/);
  heard.missions({ topic: 'missions', id: 'msn_1', what: 'done' });
  assert.match(chip.querySelector('.pt').className, /pt-done/);
  heard.missions({ topic: 'missions', id: 'msn_2', what: 'failed' });
  assert.match(chip.querySelector('.pt').className, /pt-done/, 'another mission leaves it alone');
});

test('a chip opens what it names: a team its board, a work chat its conversation', () => {
  const opened = [];
  const { ctx, box } = load({ teamsPageOpen: id => opened.push(['team', id]), teamMemberOpen: id => opened.push(['chat', id]) });
  vm.runInContext('agentMentionAppend', ctx)(box, { kind: 'team', id: 'tm_1', title: 'Docs', state: 'running' });
  vm.runInContext('agentMentionAppend', ctx)(box, { kind: 'work', id: 's_2', sessionId: 's_2', title: 'Helper', state: 'idle' });
  box.children[0].onclick();
  box.children[1].onclick();
  assert.deepEqual(opened, [['team', 'tm_1'], ['chat', 's_2']]);
});

test('a mention with no id draws nothing', () => {
  const { ctx, box } = load();
  assert.equal(vm.runInContext('agentMentionAppend', ctx)(box, { kind: 'work' }), null);
  assert.equal(box.children.length, 0);
});
