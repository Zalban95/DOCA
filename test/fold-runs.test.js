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

const frontend = require('./frontend');
// The shared scripts the transcript is built from, in the order the page loads them.
const SRC = frontend.source(...frontend.scripts().filter(f => /^(lib|agent-ui)\//.test(f)));

function el(tag, className = '') {
  const node = {
    tagName: tag, className, children: [], dataset: {}, style: {}, attrs: {}, title: '',
    _handlers: {}, parent: null, _text: '',
    classList: {
      contains: c => node.className.split(/\s+/).includes(c),
      add(c) { if (!this.contains(c)) node.className = `${node.className} ${c}`.trim(); },
      remove(c) { node.className = node.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
      toggle(c, on) { const value = on === undefined ? !this.contains(c) : on; value ? this.add(c) : this.remove(c); return value; },
    },
    get textContent() { return node._text + node.children.map(c => c.textContent).join(''); },
    set textContent(v) { node._text = String(v); node.children.length = 0; },
    get lastElementChild() { return node.children.at(-1) || null; },
    get parentElement() { return node.parent; },
    closest(sel) {
      for (let n = node; n; n = n.parent) if (n.classList.contains(sel.slice(1))) return n;
      return null;
    },
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
    const made = new Function(`${SRC}; return { agentFold, agentFoldMount, createThinkStream, agentWorkingOpen, agentWorkingMount, agentWorkingClose, agentWorkingGiveBack, collapseFoldRuns, _workingSummary };`)();
    global.document = doc;                           // the functions build nodes when called, too
    return made;
  } finally { /* left in place deliberately; each test sets its own */ }
}

const transcript = () => el('div', 'hc-messages');
const fold = kind => el('div', `agent-fold agent-fold-${kind}`);
const bubble = (who, text) => { const b = el('div', `hc-msg hc-${who}`); b.textContent = text; return b; };
const kinds = box => box.children.map(c => c.className.split(' ').slice(0, 2).join(' '));

test('provider thinking fills the same one-click preview while it is still running', () => {
  const { agentWorkingOpen, agentWorkingClose, agentFoldMount, createThinkStream } = api();
  const box = transcript();
  agentWorkingOpen(box);
  const stream = createThinkStream({ mount: node => agentFoldMount(box, node) });
  stream.startWaiting();
  stream.feedThinking('First line.\n');
  const fold = box.querySelector('.agent-fold-thinking');
  assert.equal(fold.classList.contains('open'), false, 'one line until clicked');
  fold.querySelector('.agent-fold-head').click();
  stream.feedThinking('Next line.');
  assert.equal(fold.classList.contains('open'), true);
  assert.equal(fold.querySelector('.agent-fold-body').textContent, 'First line.\nNext line.');
  assert.equal(box.querySelectorAll('.agent-fold-thinking').length, 1);
  stream.finish();
  agentWorkingClose(box);
  assert.match(box.querySelector('.agent-working-head').textContent, /Thought/);
});

test('consecutive live commands stay flat and count individually', () => {
  const { agentWorkingOpen, agentWorkingClose, agentFoldMount, agentFold } = api();
  const box = transcript();
  agentWorkingOpen(box);
  for (let i = 0; i < 2; i++) agentFoldMount(box, agentFold({ kind: 'tool-call', label: 'Command', active: true }).el);
  assert.equal(box.querySelectorAll('.agent-fold-group').length, 0);
  agentWorkingClose(box);
  assert.match(box.querySelector('.agent-working-head').textContent, /2 commands/);
});

test('one saved thinking preview becomes a finished summary while a plain reply stays plain', () => {
  const { collapseFoldRuns } = api();
  const box = transcript();
  box.append(fold('thinking'), bubble('assistant', 'Answer.'), bubble('user', 'Again?'), bubble('assistant', 'Yes.'));
  collapseFoldRuns(box);
  assert.equal(box.querySelectorAll('.agent-working').length, 1);
  assert.match(box.querySelector('.agent-working-head').textContent, /Thought/);
  assert.equal(box.lastElementChild.textContent, 'Yes.');
});

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

test('a picture shown mid-turn does not split the turn into two summaries', () => {
  // A picture arrives between a tool call and its result, and it was treated as
  // the end of a turn — so one turn of call → picture → result → answer came out
  // as two "1 command / 1 step" lines, live and on every reload alike.
  //
  // The figure carries an `img` on purpose: the empty-node sweep above spares a
  // node with media in it, so a bare class would be removed and this test would
  // pass while the browser did something else. That is how the audit's first
  // probe of this went wrong.
  const { collapseFoldRuns } = api();
  const box = transcript();
  const picture = el('div', 'agent-image');
  picture.appendChild(el('img'));

  box.appendChild(bubble('user', 'draw it'));
  box.appendChild(fold('tool-call'));
  box.appendChild(picture);
  box.appendChild(fold('tool-result'));
  box.appendChild(bubble('assistant', 'Here it is.'));

  collapseFoldRuns(box);

  assert.equal(box.querySelectorAll('.agent-working').length, 1, 'one turn, one summary line');
  assert.deepEqual(kinds(box), [
    'hc-msg hc-user', 'agent-working done', 'agent-image', 'hc-msg hc-assistant',
  ], 'the picture keeps its own visible row, after the record of the turn that produced it');
  assert.equal(box.lastElementChild.textContent, 'Here it is.', 'and the answer is still last');
  assert.equal(box.children[1].querySelector('.agent-working-items').children.length, 2,
    'both of the turn\'s rows are inside the one block');
});

test('a picture is shown under the sentence that introduced it, not at the end of the turn', () => {
  // Two things in a turn are not the account of it: the answer, and the
  // sentence a picture was shown under. Fold the sentence away and the picture
  // has nothing left to sit beside, so it falls to the end of the turn and
  // stacks against every other picture there — the one shown first reads as
  // though it came last.
  //
  // The sentence is the *last* bubble in the run rather than the trailing one:
  // the call that showed the picture is drawn after the sentence and before the
  // picture, so a run that stopped at the trailing bubbles would find the call.
  const { collapseFoldRuns } = api();
  const box = transcript();
  const picture = el('div', 'agent-image');
  picture.appendChild(el('img'));

  box.appendChild(bubble('user', 'render the data'));
  box.appendChild(fold('thinking'));
  box.appendChild(bubble('assistant', 'Here is the data you asked for:'));
  box.appendChild(fold('tool-call'));
  box.appendChild(picture);
  box.appendChild(fold('tool-result'));
  box.appendChild(bubble('assistant', 'And here is the picture explained.'));

  collapseFoldRuns(box);

  assert.deepEqual(kinds(box), [
    'hc-msg hc-user', 'agent-working done', 'hc-msg hc-assistant', 'agent-image', 'hc-msg hc-assistant',
  ], 'the sentence stands above the picture, and the picture above the answer');
  assert.equal(box.children[2].textContent, 'Here is the data you asked for:');
  assert.equal(box.lastElementChild.textContent, 'And here is the picture explained.');
  assert.equal(box.querySelectorAll('.agent-working').length, 1, 'still one summary line for the turn');
  assert.equal(box.querySelector('.agent-working-items').children.length, 3,
    'only the sentence was given back: the folds still collapse');
});

test('the live chat gives a picture its sentence by the same rule', () => {
  const { agentWorkingOpen, agentWorkingMount, agentWorkingClose, agentWorkingGiveBack } = api();
  const box = transcript();
  const picture = el('div', 'agent-image');
  picture.appendChild(el('img'));

  box.appendChild(bubble('user', 'render the data'));
  agentWorkingOpen(box);
  agentWorkingMount(box, fold('thinking'));
  agentWorkingMount(box, bubble('assistant', 'Here is the data you asked for:'));
  agentWorkingMount(box, fold('tool-call'));
  agentWorkingGiveBack(box);                       // what _chatAppendImage does
  box.appendChild(picture);
  agentWorkingMount(box, fold('tool-result'));
  agentWorkingMount(box, bubble('assistant', 'And here is the picture explained.'));
  agentWorkingClose(box);

  assert.deepEqual(kinds(box), [
    'hc-msg hc-user', 'agent-working done', 'hc-msg hc-assistant', 'agent-image', 'hc-msg hc-assistant',
  ], 'live and reloaded draw the same turn the same way');
  assert.equal(box.children[2].textContent, 'Here is the data you asked for:');
});

test('both transcripts give the sentence back before they draw the picture', () => {
  // The helper working is not the picture using it. The live paths are the two
  // files that call it, and neither is loaded here otherwise — so the one thing
  // worth pinning is the order: the sentence comes out of the block *before* the
  // picture is appended, or the picture lands above its own sentence.
  const container = el('div', 'hc-messages');
  const calls = [];
  const prevDoc = global.document;
  global.document = { getElementById: () => container, createElement: tag => el(tag) };
  try {
    for (const [file, name] of [['chat.js', '_chatAppendImage'], ['harness-console/transcript.js', '_hcAppendImage']]) {
      const body = frontend.fn(name);
      const fn = new Function('agentImageEl', 'agentWorkingGiveBack', '_chatScroll',
        `${body}; return ${name};`)(
        () => { calls.push('draw'); return el('div', 'agent-image'); },
        c => calls.push(c === container ? 'give back, into the transcript' : 'give back, into nowhere'),
        () => {});
      calls.length = 0;
      fn({ name: 'x.png' });
      assert.deepEqual(calls, ['give back, into the transcript', 'draw'],
        `${file}: the sentence is given back before the picture is drawn`);
    }
  } finally { global.document = prevDoc; }
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
