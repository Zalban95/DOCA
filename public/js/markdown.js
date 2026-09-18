/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — MARKDOWN

   The agent writes markdown. It is what the models were trained to write and
   it is how they say anything with structure in it, so the transcript renders
   it rather than showing the asterisks.

   No dependency, and no HTML strings. Every node is built with
   document.createElement and every run of characters with textContent, which
   is the strict form of the rule the rest of this panel already follows: the
   text here was written by a language model, in a page that holds the user's
   session. Nothing in this file assembles markup out of model output, so there
   is no escaping step to get wrong — text goes in as text and comes out as
   text, and the only tags on screen are ones this file created by name.

   Two consequences worth knowing, both deliberate:

   - `![alt](url)` is never an image. A markdown image makes the browser fetch
     an address the model wrote, which is how a prompt injection sends a
     conversation to somebody else's server — the reason show_image exists and
     this file does not. It renders as the literal text the model typed.
   - links are allowed, but only http, https and mailto. `javascript:` and
     `data:` come out as literal text, not as something clickable.
   ═══════════════════════════════════════════════════════ */

/** The only schemes a link may carry. Anything else stays text. */
const MD_SAFE_URL = /^(https?:|mailto:)/i;

/* ── Splitting ────────────────────────────────────────── */

/**
 * Cut the text so far into the blocks that are finished and the one still
 * being written.
 *
 * This is what makes streaming renderable: finished blocks are appended once
 * and never touched again, so nothing on screen is ever rewritten and there is
 * no flicker — only the trailing incomplete block is redrawn, and the cost of
 * a chunk is one block rather than the whole message.
 *
 * Fence-aware on purpose. A blank line inside an open ``` block does not end
 * it, so a fenced block stays the tail until its closing fence arrives and is
 * never briefly rendered as prose.
 *
 * @param {string} src
 * @returns {{ done: string[], tail: string }}
 */
function mdSplitBlocks(src) {
  const raw = String(src == null ? '' : src).split('\n');
  // A trailing newline is the line that just finished, not the blank line
  // after it. Reading it as a blank line is the bug that makes a streamed list
  // commit its first item the moment that item's newline arrives, and then
  // commit it a second time when the next one does.
  const lines = raw[raw.length - 1] === '' ? raw.slice(0, -1) : raw;
  const done  = [];
  let cur     = [];
  let fence   = null;      // the marker that opened the open fence, or null

  const flush = () => { if (cur.length) { done.push(cur.join('\n')); cur = []; } };

  for (const line of lines) {
    const f = /^\s{0,3}(```|~~~)/.exec(line);

    if (fence) {
      cur.push(line);
      if (f && f[1] === fence) { fence = null; flush(); }
      continue;
    }
    if (f) {
      // A fence always starts its own block, even with no blank line before it.
      flush();
      fence = f[1];
      cur.push(line);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    cur.push(line);
  }

  return { done, tail: cur.join('\n') };
}

/* ── Block parsing ────────────────────────────────────── */

const mdCells = line => {
  // A backslash escapes the pipe, so it must not count as a separator.
  const s = String(line).trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, '\u0000');
  return s.split('|').map(c => c.replace(/\u0000/g, '|').trim());
};

const mdIsRow   = line => typeof line === 'string' && line.includes('|') && !!line.trim();
const mdIsDelim = line => mdIsRow(line) &&
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

const MD_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const MD_FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;

/**
 * Every block of a finished message, top to bottom.
 *
 * The one-shot path splits exactly as the streaming one does, so a message
 * rendered live and the same message rendered from history come out identical
 * — which is the property that makes reloading a session safe.
 */
function mdAllBlocks(text) {
  const split = mdSplitBlocks(text);
  return split.tail ? [...split.done, split.tail] : split.done;
}

/**
 * One block of text into its parts.
 *
 * A block is usually one thing, but a paragraph immediately followed by a list
 * or a heading is one block and two things, which is why this returns a list
 * of parts rather than a single descriptor.
 *
 * @param {string} text
 * @returns {{ parts: Array<object> }}
 */
function mdBlock(text) {
  const lines = String(text == null ? '' : text).replace(/\s+$/, '').split('\n');

  // A fenced block is the whole block, and its contents are literal.
  const open = MD_FENCE.exec(lines[0] || '');
  if (open) {
    const close = new RegExp('^\\s{0,3}' + open[1] + '\\s*$');
    let end = lines.length;
    for (let i = 1; i < lines.length; i++) if (close.test(lines[i])) { end = i; break; }
    return { parts: [{ type: 'code', lang: open[2] || '', text: lines.slice(1, end).join('\n') }] };
  }

  const parts = [];
  let i = 0;
  let para = [];
  const flushPara = () => { if (para.length) { parts.push({ type: 'p', lines: para }); para = []; } };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); i++; continue; }

    let m;

    if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) {
      flushPara();
      parts.push({ type: 'h', level: m[1].length, text: m[2].trim() });
      i++; continue;
    }

    // ---, ***, ___ on their own line.
    if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      flushPara(); parts.push({ type: 'hr' }); i++; continue;
    }

    // A fence with no blank line before it: the paragraph above it ends here.
    if ((m = MD_FENCE.exec(line))) {
      flushPara();
      const close = new RegExp('^\\s{0,3}' + m[1] + '\\s*$');
      const body  = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) { body.push(lines[i]); i++; }
      i++;                                   // the closing fence, or the end
      parts.push({ type: 'code', lang: m[2] || '', text: body.join('\n') });
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      flushPara();
      const q = [];
      while (i < lines.length && (m = /^\s{0,3}>\s?(.*)$/.exec(lines[i]))) { q.push(m[1]); i++; }
      parts.push({ type: 'quote', lines: q });
      continue;
    }

    if ((m = MD_LIST.exec(line))) {
      flushPara();
      const ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length && (m = MD_LIST.exec(lines[i]))) {
        // `ordered` per item, not per block: a bullet list nested under a
        // numbered one is still a bullet list, and the block's own marker
        // cannot say that.
        items.push({ indent: Math.floor(m[1].replace(/\t/g, '  ').length / 2), text: m[3],
          ordered: /\d/.test(m[2]) });
        i++;
      }
      parts.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }

    if (mdIsRow(line) && mdIsDelim(lines[i + 1])) {
      flushPara();
      const head   = mdCells(line);
      const aligns = mdCells(lines[i + 1]).map(c =>
        /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : '');
      i += 2;
      const rows = [];
      while (i < lines.length && mdIsRow(lines[i])) { rows.push(mdCells(lines[i])); i++; }
      parts.push({ type: 'table', head, aligns, rows });
      continue;
    }

    para.push(line);
    i++;
  }

  flushPara();
  return { parts };
}

/* ── Inline parsing ───────────────────────────────────── */

const MD_ESCAPABLE = /[\\`*_[\]()~#>|+\-.!]/;

/**
 * One line of text into styled runs.
 *
 * Emphasis only matches when its closing delimiter is present. That is the
 * choice that makes this streamable: a half-written `**bold` shows as the
 * characters the model has actually sent so far and turns bold once, when the
 * `**` arrives — one transition, rather than a guess that has to be taken back.
 *
 * @param {string} text
 * @returns {Array<{t: string, v?: string, href?: string}>}
 */
function mdInline(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  let buf = '';
  let i = 0;

  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  // A `_` inside a word is a word, not emphasis — file_names_are_like_this.
  const wordBefore = () => i > 0 && /[\w]/.test(s[i - 1]);

  while (i < s.length) {
    const rest = s.slice(i);
    let m;

    if (rest[0] === '`' && (m = /^(`+)([\s\S]*?)\1/.exec(rest))) {
      flush(); out.push({ t: 'code', v: m[2].trim() }); i += m[0].length; continue;
    }

    if (rest[0] === '\\' && MD_ESCAPABLE.test(rest[1] || '')) {
      buf += rest[1]; i += 2; continue;
    }

    // An image is never drawn: the whole construct stays the text it is.
    if ((m = /^!\[[^\]]*\]\([^)\s]*(?:\s+"[^"]*")?\)/.exec(rest))) {
      buf += m[0]; i += m[0].length; continue;
    }

    if ((m = /^\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest))) {
      if (MD_SAFE_URL.test(m[2])) { flush(); out.push({ t: 'link', v: m[1], href: m[2] }); }
      else buf += m[0];
      i += m[0].length; continue;
    }

    if ((m = /^<(https?:\/\/[^\s>]+|mailto:[^\s>]+)>/.exec(rest))) {
      flush(); out.push({ t: 'link', v: m[1], href: m[1] }); i += m[0].length; continue;
    }

    if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest)) && !(m[1] === '__' && wordBefore())) {
      flush(); out.push({ t: 'strong', v: m[2] }); i += m[0].length; continue;
    }

    if ((m = /^(\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest)) && !(m[1] === '_' && wordBefore())) {
      flush(); out.push({ t: 'em', v: m[2] }); i += m[0].length; continue;
    }

    if (rest[0] === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }

    buf += rest[0]; i++;
  }

  flush();
  return out;
}

/* ── Building ─────────────────────────────────────────── */

/** Write styled runs into an element. Recurses for bold and italic. */
function mdInlineInto(el, tokens) {
  for (const tk of tokens) {
    if (tk.t === 'text') el.appendChild(document.createTextNode(tk.v));
    else if (tk.t === 'br') el.appendChild(document.createElement('br'));
    else if (tk.t === 'code') {
      const c = document.createElement('code');
      c.textContent = tk.v;
      el.appendChild(c);
    } else if (tk.t === 'strong' || tk.t === 'em') {
      const n = document.createElement(tk.t === 'strong' ? 'strong' : 'em');
      mdInlineInto(n, mdInline(tk.v));
      el.appendChild(n);
    } else if (tk.t === 'link') {
      const a = document.createElement('a');
      a.href = tk.href;
      a.textContent = tk.v || tk.href;
      a.title = tk.href;               // the destination, before it is clicked
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      el.appendChild(a);
    }
  }
}

/** A list, nested by indentation. */
function mdListEl(type, items) {
  const root = document.createElement(type);
  if (!items.length) return root;

  const stack = [{ indent: items[0].indent, el: root }];
  for (const it of items) {
    while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];
    if (it.indent > top.indent && top.el.lastElementChild) {
      // The nested list takes the marker of the item that opens it. Reusing the
      // outer list's type numbered every bullet nested under a numbered item.
      const sub = document.createElement(it.ordered ? 'ol' : 'ul');
      top.el.lastElementChild.appendChild(sub);
      stack.push({ indent: it.indent, el: sub });
    }
    const li = document.createElement('li');
    mdInlineInto(li, mdInline(it.text));
    stack[stack.length - 1].el.appendChild(li);
  }
  return root;
}

/** Parts into nodes. The only place any tag is created. */
function mdNodes(parts) {
  const out = [];

  for (const p of parts) {
    if (p.type === 'hr') { out.push(document.createElement('hr')); continue; }

    if (p.type === 'h') {
      const h = document.createElement(`h${Math.min(6, Math.max(1, p.level))}`);
      mdInlineInto(h, mdInline(p.text));
      out.push(h); continue;
    }

    if (p.type === 'code') {
      const pre  = document.createElement('pre');
      const code = document.createElement('code');
      if (p.lang) code.className = `md-lang-${p.lang.replace(/[^\w+#.-]/g, '')}`;
      code.textContent = p.text;        // literal: a fence is not re-parsed
      pre.appendChild(code);
      out.push(pre); continue;
    }

    if (p.type === 'quote') {
      const bq = document.createElement('blockquote');
      mdInlineInto(bq, p.lines.flatMap((l, n) => (n ? [{ t: 'br' }] : []).concat(mdInline(l))));
      out.push(bq); continue;
    }

    if (p.type === 'ul' || p.type === 'ol') {
      out.push(mdListEl(p.type, p.items)); continue;
    }

    if (p.type === 'table') {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const hrow  = document.createElement('tr');
      p.head.forEach((cell, n) => {
        const th = document.createElement('th');
        if (p.aligns[n]) th.style.textAlign = p.aligns[n];
        mdInlineInto(th, mdInline(cell));
        hrow.appendChild(th);
      });
      thead.appendChild(hrow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const row of p.rows) {
        const tr = document.createElement('tr');
        // A short row is padded and a long one trimmed: a table cell must line
        // up with its column, and a model that miscounts pipes should not
        // silently shift every value one column to the left.
        for (let n = 0; n < p.head.length; n++) {
          const td = document.createElement('td');
          if (p.aligns[n]) td.style.textAlign = p.aligns[n];
          mdInlineInto(td, mdInline(row[n] == null ? '' : row[n]));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      // A table is the one thing here that can be wider than the transcript,
      // and a wide table inside a 380px chat must scroll rather than push the
      // bubble out of the panel.
      const wrap = document.createElement('div');
      wrap.className = 'md-table';
      wrap.appendChild(table);
      out.push(wrap); continue;
    }

    // A paragraph. A single newline is a line break, not a new paragraph —
    // chat-shaped markdown, and it keeps the model's own line breaks readable.
    const para = document.createElement('p');
    mdInlineInto(para, p.lines.flatMap((l, n) => (n ? [{ t: 'br' }] : []).concat(mdInline(l))));
    out.push(para);
  }

  return out;
}

/* ── Entry points ─────────────────────────────────────── */

/** Render `text` over whatever is in `el`. For a finished message. */
function mdInto(el, text) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('md');
  for (const block of mdAllBlocks(text)) {
    for (const node of mdNodes(mdBlock(block).parts)) el.appendChild(node);
  }
}

/**
 * A live renderer for one message.
 *
 * @param {HTMLElement} el
 * @returns {{ feed: (chunk: string) => void, end: () => void }}
 */
function mdStream(el) {
  el.classList.add('md');

  // The tail is one block inside one node, rewritten as it grows. Everything
  // before it was appended once.
  const live = document.createElement('div');
  live.className = 'md-live';
  el.appendChild(live);

  let buf   = '';
  let tail  = '';
  let done  = 0;

  function paint() {
    const split = mdSplitBlocks(buf);
    for (let i = done; i < split.done.length; i++) {
      for (const node of mdNodes(mdBlock(split.done[i]).parts)) el.insertBefore(node, live);
    }
    done = split.done.length;
    tail = split.tail;

    live.textContent = '';
    if (tail) for (const node of mdNodes(mdBlock(tail).parts)) live.appendChild(node);
  }

  return {
    feed(chunk) {
      if (!chunk) return;
      buf += chunk;
      paint();
    },
    end() {
      if (tail) for (const node of mdNodes(mdBlock(tail).parts)) el.insertBefore(node, live);
      live.remove();
      buf = ''; tail = ''; done = 0;
    },
  };
}
