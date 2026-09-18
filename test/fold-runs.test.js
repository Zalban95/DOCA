'use strict';

/**
 * The tail of a finished run stays; the rest goes behind one "…".
 *
 * A turn that ran fifteen tools left fifteen one-line rows above its own
 * answer, which is the thing the reader was waiting for. `agentFoldMount`'s
 * grouping does not help: it folds a run of the *same* kind, and a turn
 * alternates Command with Result, so the longest runs are exactly the ones
 * that never grouped.
 *
 * There is no browser here, so `collapseFoldRuns` runs against a stub document
 * that implements only what it touches — children, classList, replaceWith and
 * a click handler. That is enough, because the decisions worth pinning are
 * arithmetic on a list of siblings: where a run starts and ends, how many rows
 * survive, and that running it again after the next turn changes nothing.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'utils.js'), 'utf8');

function el(tag, className = '') {
  const node = {
    tagName: tag, className, children: [], dataset: {}, style: {}, attrs: {}, title: '',
    _handlers: {}, parent: null, _text: '',
    classList: {
      contains: c => node.className.split(/\s+/).includes(c),
      add(c) { if (!this.contains(c)) node.className = `${node.className} ${c}`.trim(); },
      remove(c) { node.className = node.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
      toggle(c, on) { (on === undefined ? !this.contains(c) : on) ? this.add(c) : this.remove(c); },
    },
    get textContent() { return node._text + node.children.map(c => c.textContent).join(''); },
    set textContent(v) { node._text = String(v); node.children.length = 0; },
    // Detaching from the previous parent is what the real appendChild does, and
    // it is the whole mechanism here: the rows are *moved* into the "…" row.
    // A stub that only pushes leaves them in both places and the transcript
    // grows instead of shrinking.
    appendChild(c) {
      const i = c.parent ? c.parent.children.indexOf(c) : -1;
      if (i >= 0) c.parent.children.splice(i, 1);   // never splice(-1): that drops the last child
      node.children.push(c); c.parent = node; return c;
    },
    append(...cs) { for (const c of cs) node.appendChild(c); },
    remove() {
      const i = node.parent ? node.parent.children.indexOf(node) : -1;
      if (i >= 0) node.parent.children.splice(i, 1);
      node.parent = null;
    },
    // Only what collapseFoldRuns asks for: "does this bubble contain media?",
    // as a comma-separated tag list. A stub that cannot answer it makes the
    // empty-bubble rule untestable, which is how the rule was missing at all.
    querySelector(sel) {
      const tags = sel.split(',').map(s => s.trim().toLowerCase());
      const walk = n => {
        for (const c of n.children) {
          if (tags.includes(String(c.tagName).toLowerCase())) return c;
          const deeper = walk(c);
          if (deeper) return deeper;
        }
        return null;
      };
      return walk(node);
    },
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener(ev, fn) { node._handlers[ev] = fn; },
    click() { node._handlers.click?.(); },
    replaceWith(other) {
      const i = node.parent.children.indexOf(node);
      node.parent.children[i] = other;
      other.parent = node.parent;
      node.parent = null;                           // replaced means detached
    },
  };
  return node;
}

/** `collapseFoldRuns`, with a stub `document` in place while it runs. */
function api() {
  const doc = { createElement: tag => el(tag) };
  const prev = global.document;
  global.document = doc;
  try {
    return new Function(`${SRC}; return { collapseFoldRuns, FOLD_RUN_KEEP };`)();
  } finally { global.document = prev; }
}

/** A transcript: 'c'/'r' are Command/Result rows, 'g' a group, 't' a text bubble. */
function transcript(shape) {
  const box = el('div', 'hc-messages');
  for (const ch of shape) {
    if (ch === 'c') box.appendChild(el('div', 'agent-fold agent-fold-tool-call'));
    if (ch === 'r') box.appendChild(el('div', 'agent-fold agent-fold-tool-result'));
    if (ch === 'g') box.appendChild(el('div', 'agent-fold-group agent-fold-group-thinking'));
    // A bubble with words in it: what actually separates one turn from the next.
    if (ch === 't') { const m = el('div', 'hc-msg hc-assistant'); m.textContent = 'an answer'; box.appendChild(m); }
    // A bubble the streamer opened and never filled, which a live turn is full of.
    if (ch === 'e') box.appendChild(el('div', 'hc-msg hc-assistant'));
  }
  return box;
}

const kinds = box => box.children.map(c => c.className.split(' ')[0]);

test('a long run keeps its last three rows and hides the rest behind one "…"', () => {
  const { collapseFoldRuns } = api();
  const box = transcript('crcrcrcrcr');          // ten rows, one run
  const before = box.children.slice();

  global.document = { createElement: tag => el(tag) };
  collapseFoldRuns(box);

  assert.deepEqual(kinds(box), ['agent-fold-more', 'agent-fold', 'agent-fold', 'agent-fold']);
  const more = box.children[0];
  assert.equal(more.children[1].children.length, 7, 'everything above the last three moved inside');
  assert.deepEqual(more.children[1].children, before.slice(0, 7), 'in order, and the same rows');
  assert.deepEqual(box.children.slice(1), before.slice(7), 'the visible tail is untouched');
  assert.match(more.textContent, /…/);
  assert.match(more.textContent, /7 earlier steps/, 'it says how many it is holding');
});

test('a run short enough to read is left alone', () => {
  const { collapseFoldRuns, FOLD_RUN_KEEP } = api();
  assert.equal(FOLD_RUN_KEEP, 3);
  global.document = { createElement: tag => el(tag) };

  for (const shape of ['c', 'cr', 'crc', 'crcr']) {
    const box = transcript(shape);
    collapseFoldRuns(box);
    assert.deepEqual(kinds(box), shape.split('').map(() => 'agent-fold'),
      `${shape.length} rows: hiding one row behind a row saves nothing`);
  }
});

test('a message bubble ends a run, so each turn collapses on its own', () => {
  const { collapseFoldRuns } = api();
  global.document = { createElement: tag => el(tag) };
  const box = transcript('crcrcrcr' + 't' + 'crcrcrcr');

  collapseFoldRuns(box);

  assert.deepEqual(kinds(box), [
    'agent-fold-more', 'agent-fold', 'agent-fold', 'agent-fold',
    'hc-msg',
    'agent-fold-more', 'agent-fold', 'agent-fold', 'agent-fold',
  ]);
});

test('a group counts as one row of the run', () => {
  const { collapseFoldRuns } = api();
  global.document = { createElement: tag => el(tag) };
  const box = transcript('gcgcgc');                 // group, fold, group, fold, group, fold
  collapseFoldRuns(box);
  // The first three (group, fold, group) go behind the "…"; the tail is what
  // it was — a group is one row of the run, not a run of its own.
  assert.deepEqual(kinds(box), ['agent-fold-more', 'agent-fold', 'agent-fold-group', 'agent-fold']);
  assert.deepEqual(box.children[0].children[1].children.map(c => c.className.split(' ')[0]),
    ['agent-fold-group', 'agent-fold', 'agent-fold-group']);
});

test('the next turn does not re-collapse what is already collapsed', () => {
  const { collapseFoldRuns } = api();
  global.document = { createElement: tag => el(tag) };
  const box = transcript('crcrcrcrcr');

  collapseFoldRuns(box);
  const more = box.children[0];
  more.children[0].click();                       // the user opened it
  assert.ok(more.classList.contains('open'));

  collapseFoldRuns(box);                          // the turn after that one ends

  assert.equal(box.children[0], more, 'the same "…" row, not a second one around it');
  assert.ok(more.classList.contains('open'), 'and still open, because a click outranks the tidy-up');
  assert.deepEqual(kinds(box), ['agent-fold-more', 'agent-fold', 'agent-fold', 'agent-fold']);
});

test('the "…" opens everything it hides, and closes again', () => {
  const { collapseFoldRuns } = api();
  global.document = { createElement: tag => el(tag) };
  const box = transcript('crcrcrcrcr');
  collapseFoldRuns(box);

  const more = box.children[0];
  const head = more.children[0];
  assert.equal(head.attrs['aria-expanded'], 'false');
  assert.match(head.title, /Show the 7 earlier steps/);

  head.click();
  assert.ok(more.classList.contains('open'));
  assert.equal(head.attrs['aria-expanded'], 'true');

  head.click();
  assert.equal(more.classList.contains('open'), false);
  assert.equal(head.attrs['aria-expanded'], 'false');
});

test('a live turn collapses too: the empty bubbles between its rows are not separators', () => {
  // The regression this exists to stop. `createThinkStream` opens a text bubble
  // per text segment, so a turn as it happens is row, empty bubble, row, empty
  // bubble … — every run one row long, nothing ever collapsing. It looked right
  // in testing because a *reloaded* transcript has no empty bubbles, which is
  // the only shape that had been tried.
  const { collapseFoldRuns } = api();
  global.document = { createElement: tag => el(tag) };
  const box = transcript('ecereceregecer');       // ten rows, four empty bubbles among them

  collapseFoldRuns(box);

  assert.deepEqual(kinds(box), ['agent-fold-more', 'agent-fold-group', 'agent-fold', 'agent-fold'],
    'the empty bubbles are gone and what is left is one run');
  assert.equal(box.children[0].children[1].children.length, 4, 'seven rows, three kept, four behind the "…"');
});
