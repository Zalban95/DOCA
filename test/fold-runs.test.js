'use strict';

/**
 * The working of one turn: one line while it happens, one line when it is done.
 *
 * A turn used to write every step into the transcript as it arrived, so the
 * answer was pushed off the screen by the account of how it was reached. The
 * rows now live in one block: while the turn runs it shows its last row and
 * nothing else, and when the turn ends the whole block becomes one summary line
 * that opens to the lot.
 *
 * There is no browser here, so this runs against a stub document that
 * implements only what the code touches. Two of its methods are the ones that
 * matter and were missing the first time this was written: `appendChild` must
 * detach a node from its previous parent, and `replaceWith` must clear it —
 * without both, rows moved into a block stay in two places and a transcript
 * grows where it should shrink.
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
    get lastElementChild() { return node.children.at(-1) || null; },
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
    replaceWith(other) {
      const i = node.parent.children.indexOf(node);
      node.parent.children[i] = other;
      other.parent = node.parent;
      node.parent = null;                            // replaced means detached
    },
    contains(other) {
      for (let n = other; n; n = n.parent) if (n === node) return true;
      return false;
    },
    /** Tag names and single class selectors, which is all the code asks for. */
    querySelector(sel) {
      const want = sel.split(',').map(s => s.trim().toLowerCase());
      const hit = n => want.some(w => (w.startsWith('.') ? n.classList.contains(w.slice(1))
        : String(n.tagName).toLowerCase() === w));
      const walk = n => {
        for (const c of n.children) {
          if (hit(c)) return c;
          const deeper = walk(c);
          if (deeper) return deeper;
        }
        return null;
      };
      return walk(node);
    },
    querySelectorAll(sel) {
      const out = [];
      const want = sel.split(',').map(s => s.trim().toLowerCase());
      const hit = n => want.some(w => (w.startsWith('.') ? n.classList.contains(w.slice(1))
        : String(n.tagName).toLowerCase() === w));
      const walk = n => { for (const c of n.children) { if (hit(c)) out.push(c); walk(c); } };
      walk(node);
      return out;
    },
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener(ev, fn) { node._handlers[ev] = fn; },
    click() { node._handlers.click?.(); },
  };
  return node;
}

/** The working-block functions, with a stub `document` in place. */
function api() {
  const doc = { createElement: tag => el(tag) };
  const prev = global.document;
  global.document = doc;
  try {
    const made = new Function(`${SRC}; return { agentWorkingOpen, agentWorkingMount, agentWorkingClose, collapseFoldRuns, _workingSummary };`)();
    global.document = doc;                           // the functions build nodes when called, too
    return made;
  } finally { /* left in place deliberately; each test sets its own */ }
}

const transcript = () => el('div', 'hc-messages');
const fold = kind => el('div', `agent-fold agent-fold-${kind}`);
const bubble = (who, text) => { const b = el('div', `hc-msg hc-${who}`); b.textContent = text; return b; };
const kinds = box => box.children.map(c => c.className.split(' ').slice(0, 2).join(' '));

test('while a turn runs its rows are in one block, and the block is the only thing added', () => {
  const { agentWorkingOpen, agentWorkingMount } = api();
  const box = transcript();
  box.appendChild(bubble('user', 'do the thing'));

  agentWorkingOpen(box);
  for (const kind of ['thinking', 'tool-call', 'tool-result', 'thinking', 'tool-call']) {
    agentWorkingMount(box, fold(kind));
  }

  assert.deepEqual(kinds(box), ['hc-msg hc-user', 'agent-working live'],
    'the transcript gains one element however many steps the turn takes');
  assert.equal(box.children[1].querySelector('.agent-working-items').children.length, 5);
});

test('when the turn ends the block is one line, and the answer is not inside it', () => {
  const { agentWorkingOpen, agentWorkingMount, agentWorkingClose } = api();
  const box = transcript();
  box.appendChild(bubble('user', 'do the thing'));

  agentWorkingOpen(box);
  agentWorkingMount(box, fold('thinking'));
  agentWorkingMount(box, fold('tool-call'));
  agentWorkingMount(box, fold('tool-result'));
  agentWorkingMount(box, bubble('assistant', 'Checking the next one.'));
  agentWorkingMount(box, fold('tool-call'));
  agentWorkingMount(box, fold('tool-result'));
  agentWorkingMount(box, bubble('assistant', 'Here is the answer.'));

  agentWorkingClose(box);

  assert.deepEqual(kinds(box), ['hc-msg hc-user', 'agent-working done', 'hc-msg hc-assistant']);
  assert.equal(box.children.at(-1).textContent, 'Here is the answer.',
    'the thing that was being waited for is never behind the summary');

  const block = box.children[1];
  assert.match(block.querySelector('.agent-fold-label').textContent, /Thought for \d+s · 2 commands/);
  // Six: the five steps plus the commentary between them. Only the trailing
  // bubble is given back, because only the last thing said is the answer.
  assert.equal(block.querySelector('.agent-working-items').children.length, 6,
    'the working is kept: the steps and the commentary between them');
  assert.equal(box._working, null, 'and the block is closed, so the next turn opens its own');
});

test('the summary says what happened, and says nothing it cannot know', () => {
  const { _workingSummary } = api();
  const rows = n => Array.from({ length: n }, () => fold('tool-call'));

  assert.equal(_workingSummary([...rows(2), fold('thinking')], 12), 'Thought for 12s · 2 commands');
  assert.equal(_workingSummary([...rows(1), fold('thinking')], 0), 'Thought · 1 command',
    'no duration rather than a made-up one');
  assert.equal(_workingSummary(rows(3), 0), '3 commands', 'a turn that never thought does not say it did');
  assert.equal(_workingSummary([fold('thinking')], 90), 'Thought for 2m');
  assert.equal(_workingSummary([el('div', 'hc-msg hc-assistant')], 0), '1 step',
    'something happened, even when it was neither');
});

test('a turn with nothing to report leaves no block behind', () => {
  const { agentWorkingOpen, agentWorkingClose } = api();
  const box = transcript();
  box.appendChild(bubble('user', 'hello'));

  agentWorkingOpen(box);
  agentWorkingClose(box);

  assert.deepEqual(kinds(box), ['hc-msg hc-user'],
    'an answer with no thinking and no commands is just the answer');
});

test('an answer that arrived with no steps is given back, not summarised', () => {
  const { agentWorkingOpen, agentWorkingMount, agentWorkingClose } = api();
  const box = transcript();
  agentWorkingOpen(box);
  agentWorkingMount(box, bubble('assistant', 'Yes.'));
  agentWorkingClose(box);

  assert.deepEqual(kinds(box), ['hc-msg hc-assistant']);
  assert.equal(box.children[0].textContent, 'Yes.');
});

test('a reloaded transcript collapses each turn the same way, timed from its own rows', () => {
  const { collapseFoldRuns } = api();
  const box = transcript();
  const at = s => new Date(Date.parse('2026-09-20T10:00:00Z') + s * 1000).toISOString();

  box.appendChild(bubble('user', 'first question'));
  const rows = [fold('thinking'), fold('tool-call'), fold('tool-result'), bubble('assistant', 'narrating'), fold('tool-call'), fold('tool-result')];
  rows.forEach((r, i) => { r.dataset.at = at(i * 4); box.appendChild(r); });
  const answer = bubble('assistant', 'the answer');
  answer.dataset.at = at(24);
  box.appendChild(answer);
  box.appendChild(bubble('user', 'second question'));

  collapseFoldRuns(box);

  assert.deepEqual(kinds(box), [
    'hc-msg hc-user', 'agent-working done', 'hc-msg hc-assistant', 'hc-msg hc-user',
  ]);
  assert.match(box.children[1].querySelector('.agent-fold-label').textContent, /Thought for 20s · 2 commands/,
    'the span comes from the rows, so a reopened turn reads like the one that was watched');
});

test('an empty bubble the streamer left behind is not a row', () => {
  const { collapseFoldRuns } = api();
  const box = transcript();
  box.appendChild(bubble('user', 'ask'));
  box.appendChild(el('div', 'hc-msg hc-assistant'));      // opened, never filled
  box.appendChild(fold('tool-call'));
  box.appendChild(el('div', 'hc-msg hc-assistant'));
  box.appendChild(fold('tool-result'));
  box.appendChild(bubble('assistant', 'done'));

  collapseFoldRuns(box);

  assert.deepEqual(kinds(box), ['hc-msg hc-user', 'agent-working done', 'hc-msg hc-assistant']);
  assert.equal(box.children[1].querySelector('.agent-working-items').children.length, 2);
});
