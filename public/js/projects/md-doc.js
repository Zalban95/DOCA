/* ═══════════════════════════════════════════════════════
   Projects → a markdown file rendered as a document (asked 2026-10-04: "MD
   files correct visualisation in projects").

   markdown.js renders what a *model* wrote, so it never draws an image and only
   links http(s): a URL in model output is an injection channel. A README in a
   project folder is the person's own file, and a document that cannot show its
   own diagram or follow its own link to CONTRIBUTING.md is not rendered
   correctly. So this file renders with markdown.js and then finishes the job
   for documents only:

   - front matter becomes a small key/value box instead of two rules;
   - a relative image that resolves *inside the project* is drawn from
     /api/files/raw; anything else (remote, outside the root) stays a link and
     is never fetched;
   - a relative link opens that file in a Projects tab; #heading scrolls;
   - ~~strike~~ and task boxes ([ ] / [x]) render; code blocks are coloured
     by Monaco, which is already loaded for the editor;
   - prose in a proportional font, code in mono (projects.css .pj-md).
   ═══════════════════════════════════════════════════════ */

/** `rel` against the folder of `from`, or null when it leaves `root`. Either separator. */
function _pjMdResolve(from, rel, root) {
  const sep = from.includes('\\') && !from.includes('/') ? '\\' : '/';
  const parts = from.split(/[\\/]/).slice(0, -1);
  for (const seg of decodeURIComponent(rel).split(/[\\/]/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  const abs = parts.join(sep);
  const norm = s => s.replace(/[\\/]+$/, '').toLowerCase().replace(/\\/g, '/');
  return root && (norm(abs) + '/').startsWith(norm(root) + '/') ? abs : null;
}

const _pjMdExternal = href => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href);

const _pjSlug = t => String(t).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

/** Render `text` (a markdown file at `path`) as a document into `host`. */
function pjMarkdownDoc(host, text, path) {
  const root = PJ.project?.project.root || '';
  const doc = document.createElement('div');
  doc.className = 'pj-md';

  let body = String(text);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(body);
  if (fm) {
    body = body.slice(fm[0].length);
    const meta = document.createElement('table');
    meta.className = 'pj-md-meta';
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^([\w.-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const tr = document.createElement('tr');
      tr.append(Object.assign(document.createElement('th'), { textContent: m[1] }), Object.assign(document.createElement('td'), { textContent: m[2] }));
      meta.appendChild(tr);
    }
    if (meta.rows.length) doc.appendChild(meta);
  }

  const content = document.createElement('div');
  mdInto(content, body);
  doc.appendChild(content);

  for (const h of content.querySelectorAll('h1,h2,h3,h4,h5,h6')) h.id ||= _pjSlug(h.textContent);
  _pjMdHtml(content);
  _pjMdInline(content, path, root);
  for (const li of content.querySelectorAll('li')) _pjMdTask(li);
  for (const a of content.querySelectorAll('a[href^="http"]')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  _pjMdColour(content);

  host.appendChild(doc);
}

/** Literal ![alt](src), [text](href) and ~~x~~ left in text nodes by markdown.js, finished here. */
function _pjMdInline(container, path, root) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement.closest('code,pre,a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const RE = /!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)|~~([^~]+)~~/g;
  for (const node of nodes) {
    const s = node.nodeValue;
    if (!/[!\[~]/.test(s)) continue;
    RE.lastIndex = 0;
    let m, at = 0, changed = false;
    const frag = document.createDocumentFragment();
    while ((m = RE.exec(s))) {
      frag.appendChild(document.createTextNode(s.slice(at, m.index)));
      frag.appendChild(m[2] !== undefined ? _pjMdImage(m[1], m[2], path, root)
        : m[4] !== undefined ? _pjMdLink(m[3], m[4], path, root)
        : Object.assign(document.createElement('del'), { textContent: m[5] }));
      at = RE.lastIndex; changed = true;
    }
    if (!changed) continue;
    frag.appendChild(document.createTextNode(s.slice(at)));
    node.replaceWith(frag);
  }
}

function _pjMdImage(alt, src, path, root) {
  const abs = !_pjMdExternal(src) ? _pjMdResolve(path, src.split('#')[0], root) : null;
  if (abs) {
    const img = Object.assign(document.createElement('img'), { src: `/api/files/raw?path=${encodeURIComponent(abs)}`, alt, title: alt || src });
    img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'pj-md-missing', textContent: `🖼 ${alt || src} — not found` }));
    return img;
  }
  // Not ours to fetch: a remote picture stays a link, never loaded by the preview.
  const a = Object.assign(document.createElement('a'), { textContent: `🖼 ${alt || 'image'}`, title: `${src} — a remote image, not loaded here` });
  if (/^https?:/i.test(src)) Object.assign(a, { href: src, target: '_blank', rel: 'noopener noreferrer' });
  return a;
}

function _pjMdLink(text, href, path, root) {
  const a = Object.assign(document.createElement('a'), { textContent: text, href: '#' });
  if (href.startsWith('#')) {
    a.onclick = e => { e.preventDefault(); document.getElementById(_pjSlug(decodeURIComponent(href.slice(1))))?.scrollIntoView({ behavior: 'smooth' }); };
    return a;
  }
  if (_pjMdExternal(href)) { a.removeAttribute('href'); a.title = `${href} — not opened from a preview`; return a; }
  const abs = _pjMdResolve(path, href.split('#')[0], root);
  if (!abs) { a.removeAttribute('href'); a.title = `${href} is outside the project`; return a; }
  a.title = `Open ${href}`;
  a.onclick = e => { e.preventDefault(); pjOpenFile(abs); };
  return a;
}

/**
 * The bit of HTML GitHub renders in a README — <details>/<summary>, <kbd>,
 * <sub>/<sup>, <br>, a few inline styles of text — rebuilt as fresh elements
 * with no attributes at all, so nothing in a file can bring a script, a
 * handler or a URL with it. Any other tag stays the text it is.
 */
const _PJ_MD_TAGS = new Set(['DETAILS', 'SUMMARY', 'KBD', 'SUB', 'SUP', 'BR', 'B', 'I', 'EM', 'STRONG', 'CODE', 'P', 'UL', 'OL', 'LI', 'MARK', 'S', 'DEL', 'INS', 'SMALL']);
function _pjMdHtml(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement.closest('code,pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) if (/<\/?(details|summary|kbd|sub|sup|br|mark|small|ins)\b/i.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parsed = new DOMParser().parseFromString(`<body>${node.nodeValue}</body>`, 'text/html').body;
    const copy = src => {
      const out = document.createDocumentFragment();
      for (const n of src.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) out.appendChild(document.createTextNode(n.nodeValue));
        else if (n.nodeType === Node.ELEMENT_NODE && _PJ_MD_TAGS.has(n.tagName)) { const el = document.createElement(n.tagName); el.appendChild(copy(n)); out.appendChild(el); }
        else if (n.nodeType === Node.ELEMENT_NODE) out.appendChild(copy(n));   // an unknown tag: its text, never the tag
      }
      return out;
    };
    node.replaceWith(copy(parsed));
  }
}

/** "[ ] x" / "[x] x" at the start of a list item: a checkbox, read-only. */
function _pjMdTask(li) {
  const first = li.firstChild?.nodeType === Node.TEXT_NODE ? li.firstChild : li.firstElementChild?.tagName === 'P' ? li.firstElementChild.firstChild : null;
  const m = first?.nodeType === Node.TEXT_NODE && /^\s*\[([ xX])\]\s+/.exec(first.nodeValue);
  if (!m) return;
  first.nodeValue = first.nodeValue.slice(m[0].length);
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: m[1] !== ' ', disabled: true });
  first.parentNode.insertBefore(box, first);
  li.classList.add('pj-md-task');
}

/** Code blocks coloured by Monaco's own tokenizer, when the editor has loaded it. */
function _pjMdColour(container) {
  if (!window.monaco?.editor?.colorize) return;
  const alias = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', yml: 'yaml', md: 'markdown', kt: 'kotlin', cs: 'csharp', 'c++': 'cpp', rs: 'rust' };
  const known = new Set(monaco.languages.getLanguages().map(l => l.id));
  for (const code of container.querySelectorAll('pre > code[class^="md-lang-"]')) {
    const raw = code.className.slice(8).toLowerCase();
    const lang = alias[raw] || raw;
    if (!known.has(lang)) continue;
    // colorize escapes the text it tokenizes; what comes back is its own spans.
    monaco.editor.colorize(code.textContent, lang, {}).then(html => { code.innerHTML = html; code.classList.add('pj-md-coloured'); }).catch(() => {});
  }
}
