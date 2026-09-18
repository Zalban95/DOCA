'use strict';

/**
 * The markdown renderer is the one place in this panel where text written by a
 * language model becomes elements in a page that holds the user's session. So
 * these tests are less about pretty output than about the two things that can
 * go wrong quietly: a half-written block flashing the wrong thing while it
 * streams, and something in the model's text arriving as a tag.
 *
 * The parsing half of public/js/markdown.js holds no DOM references at all, so
 * it is lifted out of the file and run directly — the same extraction the
 * harness-aware tests use. The building half is run against a recording stub
 * of a document, which also gives the allowlist assertion below its teeth: the
 * set of tags the renderer can create is the set of calls it makes.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'markdown.js'), 'utf8');

/** Everything above the building section: block splitting, parsing, inline. */
function pureApi() {
  const cut = SRC.indexOf('/* ── Building');
  assert.ok(cut > 0, 'the pure half is separated from the DOM half by a section header');
  // If anything above the cut ever touches `document`, this throws — which is
  // itself the assertion that the parsing can be tested without a browser.
  return new Function(`${SRC.slice(0, cut)}; return { mdSplitBlocks, mdAllBlocks, mdBlock, mdInline };`)();
}

/* ── A recording stub of a document ───────────────────── */

function stubDom() {
  const tags = new Set();
  const mk = tag => {
    tags.add(tag);
    const el = {
      tagName: tag, className: '', children: [], style: {}, attrs: {},
      parent: null, _text: '',
      get textContent() { return el._text + el.children.map(c => c.textContent).join(''); },
      set textContent(v) { el._text = String(v); el.children.length = 0; },
      appendChild(c) { el.children.push(c); c.parent = el; return c; },
      insertBefore(c, ref) {
        const i = el.children.indexOf(ref);
        el.children.splice(i < 0 ? el.children.length : i, 0, c);
        c.parent = el; return c;
      },
      remove() { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); },
      setAttribute(k, v) { el.attrs[k] = v; },
      classList: {
        _c: new Set(),
        add(c) { this._c.add(c); },
        remove(c) { this._c.delete(c); },
        contains(c) { return this._c.has(c); },
      },
    };
    return el;
  };
  const doc = {
    createElement: mk,
    createTextNode: t => { const n = { tagName: '#text', textContent: String(t), children: [] }; return n; },
  };
  return { doc, tags };
}

/** Run `fn` with `document` bound to a stub, and report the tags it created. */
function withDom(fn) {
  const { doc, tags } = stubDom();
  const prev = global.document;
  global.document = doc;
  try { return { value: fn(), tags }; } finally { global.document = prev; }
}

/** The whole file, with the stub document in place. */
function fullApi() {
  return withDom(() => new Function(`${SRC}; return { mdInto, mdStream, mdNodes, mdBlock };`)()).value;
}

/* ── Splitting ────────────────────────────────────────── */

test('a fenced block is not ended by a blank line inside it', () => {
  const { mdAllBlocks } = pureApi();
  const blocks = mdAllBlocks('```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.');

  assert.equal(blocks.length, 2, 'the fence is one block and the prose after it is another');
  assert.match(blocks[0], /const b = 2;/, 'the blank line inside the fence did not end it');
  assert.equal(blocks[1], 'After.');
});

test('the newline at the end of a line does not end its block', () => {
  const { mdSplitBlocks } = pureApi();
  // The bug this pins: while a list is streaming, the newline after "- one"
  // arrives on its own. Read as a blank line it commits the list, and the
  // second item then commits a second list — the item appears twice.
  assert.deepEqual(mdSplitBlocks('- one\n').done, [], 'one item and a newline is not a finished list');
  assert.deepEqual(mdSplitBlocks('- one\n- two\n').done, []);
  assert.deepEqual(mdSplitBlocks('- one\n- two\n\n').done, ['- one\n- two']);
});

test('an unterminated fence stays in the tail, never rendered as prose', () => {
  const { mdSplitBlocks } = pureApi();
  const { done, tail } = mdSplitBlocks('Intro.\n\n```\nhalf a command');

  assert.deepEqual(done, ['Intro.']);
  assert.match(tail, /^```/, 'the open fence is the block still being written');
});

test('a chunk of a message only ever adds blocks, never rewrites one', () => {
  const { mdSplitBlocks } = pureApi();
  // The property the streaming renderer depends on: blocks already reported as
  // done are never reported again, so nothing on screen is redrawn.
  let seen = 0;
  let last = [];
  for (const n of [1, 5, 12, 30, 41]) {
    const { done } = mdSplitBlocks('one\n\ntwo\n\nthree\n\nfour'.slice(0, n));
    assert.ok(done.length >= last.length, 'blocks only accumulate');
    assert.deepEqual(done.slice(0, last.length), last, 'a finished block stays finished');
    last = done;
    seen++;
  }
  assert.equal(seen, 5);
});

/* ── Blocks ───────────────────────────────────────────── */

test('the block shapes the agent actually writes are recognised', () => {
  const { mdBlock } = pureApi();
  const first = text => mdBlock(text).parts[0];

  assert.deepEqual(first('# Heading'), { type: 'h', level: 1, text: 'Heading' });
  assert.deepEqual(first('### Three'), { type: 'h', level: 3, text: 'Three' });
  assert.equal(first('---').type, 'hr');
  assert.equal(first('> quoted').type, 'quote');

  const fenced = first('```bash\nls -la\n```');
  assert.equal(fenced.type, 'code');
  assert.equal(fenced.lang, 'bash');
  assert.equal(fenced.text, 'ls -la', 'the fence markers are not part of the code');

  const ul = first('- one\n- two\n  - nested');
  assert.equal(ul.type, 'ul');
  assert.deepEqual(ul.items.map(i => i.text), ['one', 'two', 'nested']);
  assert.equal(ul.items[2].indent, 1, 'indentation is carried for nesting');

  const ol = first('1. one\n2. two');
  assert.equal(ol.type, 'ol');

  const table = first('| a | b |\n|---|--:|\n| 1 | 2 |\n| 3 | 4 |');
  assert.equal(table.type, 'table');
  assert.deepEqual(table.head, ['a', 'b']);
  assert.deepEqual(table.rows, [['1', '2'], ['3', '4']]);
  assert.deepEqual(table.aligns, ['', 'right']);
});

test('a paragraph, a list and a fence in one block all survive', () => {
  const { mdBlock } = pureApi();
  const { parts } = mdBlock('Here:\n- one\n- two\n\nDone.');
  assert.deepEqual(parts.map(p => p.type), ['p', 'ul', 'p']);
});

test('a code fence in the middle of a block is still a code fence', () => {
  const { mdBlock } = pureApi();
  // No blank line before it, so the block splitter hands this over whole.
  const { parts } = mdBlock('Try this:\n```sh\nrm -rf /tmp/x\n```');
  assert.deepEqual(parts.map(p => p.type), ['p', 'code']);
  assert.equal(parts[1].text, 'rm -rf /tmp/x');
});

/* ── Inline ───────────────────────────────────────────── */

test('emphasis only counts once its closing delimiter has arrived', () => {
  const { mdInline } = pureApi();
  // Half a message is a normal thing to render: `**bold` must show as the
  // characters sent so far, and turn bold once — not flicker between guesses.
  assert.deepEqual(mdInline('**bold'), [{ t: 'text', v: '**bold' }]);
  assert.deepEqual(mdInline('**bold**'), [{ t: 'strong', v: 'bold' }]);
  assert.deepEqual(mdInline('a *half'), [{ t: 'text', v: 'a *half' }]);
  assert.deepEqual(mdInline('a *half*'), [{ t: 'text', v: 'a ' }, { t: 'em', v: 'half' }]);
  // A code span may be delimited by a run of backticks, so a backtick inside
  // it survives — which is what makes `a`b` expressible at all.
  assert.deepEqual(mdInline('``a`b``'), [{ t: 'code', v: 'a`b' }]);
});

test('an underscore inside a word is a word', () => {
  const { mdInline } = pureApi();
  assert.deepEqual(mdInline('file_names_here'), [{ t: 'text', v: 'file_names_here' }]);
  assert.deepEqual(mdInline('a _b_ c'), [
    { t: 'text', v: 'a ' }, { t: 'em', v: 'b' }, { t: 'text', v: ' c' },
  ]);
});

test('a single newline is a line break, and code spans stay literal', () => {
  const { mdInline } = pureApi();
  assert.deepEqual(mdInline('one\ntwo'), [
    { t: 'text', v: 'one' }, { t: 'br' }, { t: 'text', v: 'two' },
  ]);
  assert.deepEqual(mdInline('`**not bold**`'), [{ t: 'code', v: '**not bold**' }]);
});

/* ── What must never become markup ────────────────────── */

test('a markdown image is left as the text it is', () => {
  const { mdInline } = pureApi();
  // A drawn image fetches an address the model wrote. This is the same reason
  // show_image exists and markdown images do not.
  const tokens = mdInline('![pixel](https://example.invalid/beacon.png)');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].t, 'text');
  assert.match(tokens[0].v, /!\[pixel\]/, 'the whole construct is shown, not fetched');
});

test('only http, https and mailto can be a link', () => {
  const { mdInline } = pureApi();
  const link = href => mdInline(`[click](${href})`);

  assert.equal(link('https://example.com/a').find(t => t.t === 'link').href, 'https://example.com/a');
  assert.equal(link('mailto:a@b.c').find(t => t.t === 'link').href, 'mailto:a@b.c');
  assert.equal(link('javascript:alert(1)').some(t => t.t === 'link'), false,
    'a javascript: address is not clickable');
  assert.equal(link('data:text/html,<b>x').some(t => t.t === 'link'), false);
  assert.equal(link('file:///etc/passwd').some(t => t.t === 'link'), false);
  // And the rejected ones are shown, not swallowed.
  assert.match(link('javascript:alert(1)')[0].v, /javascript:/);
});

test('the renderer can only build the tags it names', () => {
  const { mdNodes } = fullApi();
  const hostile = [
    '# <script>alert(1)</script>',
    'A paragraph with <img src=x onerror=alert(1)> in it.',
    '- <iframe src="https://example.invalid"></iframe>',
    '> <style>body{display:none}</style>',
    '| <svg onload=alert(1)> | b |',
    '|---|--:|',
    '| 1 | 2 |',
    '`<b>not bold</b>`',
    '```html\n<script>alert(1)</script>\n```',
    '[x](javascript:alert(1))',
  ].join('\n\n');

  const { value: nodes, tags } = withDom(() => {
    const { mdBlock, mdNodes } = new Function(`${SRC}; return { mdBlock, mdNodes };`)();
    return mdNodes(mdBlock(hostile).parts);
  });

  for (const bad of ['script', 'iframe', 'style', 'img', 'svg', 'object', 'embed', 'form'])
    assert.equal(tags.has(bad), false, `the renderer never creates a <${bad}>`);

  // Everything the model wrote is still on screen — as characters.
  const flat = (function walk(ns) { return ns.map(n => n.tagName === '#text' ? n.textContent : walk(n.children)).join(''); })(nodes);
  assert.match(flat, /alert\(1\)/, 'the text of a rejected tag is still shown');
  assert.match(flat, /javascript:/);
  assert.match(flat, /onerror=alert\(1\)/);
});

test('the renderer never assembles markup from a string', () => {
  // The allowlist above holds because every node is built by name. An
  // innerHTML anywhere in this file would make the model's text markup again,
  // which is the whole risk this file exists to not take.
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(SRC), false,
    'markdown.js builds elements, never HTML strings');
});

/* ── Streaming ────────────────────────────────────────── */

test('a streamed message renders the same as the finished one', () => {
  const { mdInto, mdStream } = fullApi();
  const text = [
    'Done. Where things stand:', '',
    '**Three specialists, three independent answers** — all read:', '',
    '- archivist `msn_c470516a36fb` — 2 steps',
    '- scribe `msn_f889eb6c55dc` — 5 steps', '',
    '| agent | steps |', '|---|---|', '| archivist | 2 |', '| scribe | 5 |', '',
    '```sh\ndf -h /var\n```',
  ].join('\n');

  const oneShot = withDom(() => { const el = global.document.createElement('div'); mdInto(el, text); return el; }).value;
  const streamed = withDom(() => {
    const el = global.document.createElement('div');
    const s = mdStream(el);
    for (const ch of text) s.feed(ch);          // one character at a time
    s.end();
    return el;
  }).value;

  assert.equal(streamed.textContent, oneShot.textContent,
    'a message read live and the same message read back from history agree');
});

test('finished blocks are appended once, not re-rendered per chunk', () => {
  const { mdStream } = fullApi();
  const text = 'one\n\ntwo\n\nthree\n\nfour\n\nfive';
  let inserts = 0;
  let el;

  withDom(() => {
    el = global.document.createElement('div');
    const insert = el.insertBefore.bind(el);
    el.insertBefore = (c, ref) => { inserts++; return insert(c, ref); };
    const s = mdStream(el);
    for (let i = 0; i < text.length; i++) s.feed(text[i]);
    s.end();
  });

  // Five blocks, five insertions — not one per character. This is what keeps a
  // long answer from flickering: a block already on screen is never redrawn.
  assert.equal(inserts, 5, `each block is placed once (saw ${inserts} insertions)`);
  assert.equal(el.children.filter(c => c.className === 'md-live').length, 0,
    'the live node is removed when the stream ends');
});

test('a stream that ends mid-fence still shows the code', () => {
  const { mdStream } = fullApi();
  let el;
  withDom(() => {
    el = global.document.createElement('div');
    const s = mdStream(el);
    s.feed('Run this:\n\n```sh\ndf -h');
    s.end();                                    // the turn died before the closing fence
  });
  assert.match(el.textContent, /df -h/);
  const pre = el.children.find(c => c.tagName === 'pre');
  assert.ok(pre, 'an unterminated fence is still a code block');
});
