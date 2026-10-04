/* ═══════════════════════════════════════════════════════
   Projects → opening a file that is not (only) text.

   A tab holds a Monaco model when the file is text and a *view* when it is not:
   pictures, sound, video, PDF, fonts and 3D models are shown as themselves, and
   a binary nothing can show gets a card with its size and a download instead of
   being decoded into an editor full of replacement characters. Text that has a
   rendered form — HTML, SVG, CSV/TSV, JSON — opens as source with a 👁 toggle to
   the rendering (markdown opens rendered, md-doc.js), which is drawn from the editor's current text, so
   an unsaved edit previews as it stands.

   Everything is fetched from /api/files/raw by path, never from a URL the file
   names. HTML renders in a sandboxed frame with scripts off: a preview, not a
   browser, and nothing in it can reach the panel's session.
   ═══════════════════════════════════════════════════════ */

const PJ_VIEW_EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'opus', 'flac', 'aac', 'weba'],
  pdf:   ['pdf'],
  font:  ['ttf', 'otf', 'woff', 'woff2'],
  model: ['glb', 'gltf'],
};
const PJ_RENDERED_EXT = { md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', svg: 'svg', csv: 'csv', tsv: 'tsv', json: 'json' };

const _pjExt = path => String(path).split('/').pop().split('.').pop().toLowerCase();

/** 'image' | 'video' | 'audio' | 'pdf' | 'font' | 'model' for a file shown as itself, else null (text, or sniff). */
function pjViewKind(path) {
  const ext = _pjExt(path);
  return Object.keys(PJ_VIEW_EXT).find(k => PJ_VIEW_EXT[k].includes(ext)) || null;
}

/** The rendered form a text file has, or null. */
function pjRenderedKind(path) { return PJ_RENDERED_EXT[_pjExt(path)] || null; }

const _pjRaw = path => `/api/files/raw?path=${encodeURIComponent(path)}`;

function _pjEl(tag, props = {}, style = '') {
  const el = Object.assign(document.createElement(tag), props);
  if (style) el.style.cssText = style;
  return el;
}

/** Draw a view tab ({ kind, path, size? }) into the view pane. */
function pjDrawView(host, view) {
  host.textContent = '';
  const box = _pjEl('div', { className: 'pj-view' });
  const url = _pjRaw(view.path);
  const name = view.path.split('/').pop();
  if (view.kind === 'image') box.appendChild(_pjEl('img', { src: url, alt: name }, 'max-width:100%;max-height:100%;object-fit:contain;background:repeating-conic-gradient(#8882 0 25%,transparent 0 50%) 0 0/16px 16px'));
  else if (view.kind === 'video') box.appendChild(_pjEl('video', { src: url, controls: true, preload: 'metadata' }, 'max-width:100%;max-height:100%'));
  else if (view.kind === 'audio') box.appendChild(_pjEl('audio', { src: url, controls: true, preload: 'metadata' }, 'width:min(560px,100%)'));
  else if (view.kind === 'pdf') { box.style.alignItems = 'stretch'; box.appendChild(_pjEl('iframe', { src: url, title: name }, 'width:100%;height:100%;border:0;background:#fff')); }
  else if (view.kind === 'font') _pjFontSpecimen(box, url, name);
  else if (view.kind === 'model') _pjModelViewer(box, url, name);
  else {
    const card = _pjEl('div', { className: 'card' }, 'max-width:420px');
    card.append(_pjEl('div', { className: 'card-title', textContent: name }),
      _pjEl('p', { textContent: `A binary file${view.size != null ? ` of ${fmtBytes(view.size)}` : ''}, with no preview here. Opening it as text would show bytes, not content.` }),
      _pjEl('a', { className: 'btn btn-xs', href: `/api/files/download?path=${encodeURIComponent(view.path)}`, textContent: '⬇ Download' }));
    box.appendChild(card);
  }
  host.appendChild(box);
}

let _pjFontN = 0;
async function _pjFontSpecimen(box, url, name) {
  const family = `pj-font-${++_pjFontN}`;
  box.style.cssText += ';flex-direction:column;align-items:flex-start;justify-content:flex-start;padding:16px;overflow:auto';
  try {
    const face = new FontFace(family, `url(${url})`);
    await face.load();
    document.fonts.add(face);
  } catch (e) { box.appendChild(_pjEl('p', { textContent: `${name} could not be loaded as a font: ${e.message}` })); return; }
  box.appendChild(_pjEl('div', { className: 'card-title', textContent: name }));
  for (const px of [12, 18, 28, 44, 64]) {
    box.appendChild(_pjEl('div', { textContent: px >= 44 ? 'Aa Bb Cc 0123' : 'The quick brown fox jumps over the lazy dog — 0123456789 àéîõü', contentEditable: 'true' },
      `font-family:${family};font-size:${px}px;line-height:1.3;margin:4px 0;outline:none`));
  }
}

let _pjModelViewerLoading = null;
function _pjModelViewer(box, url, name) {
  // Google's <model-viewer> (Apache-2.0), loaded the first time a 3D file is opened.
  _pjModelViewerLoading ||= new Promise((resolve, reject) => {
    const s = _pjEl('script', { type: 'module', src: 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js' });
    s.onload = resolve; s.onerror = () => reject(new Error('the 3D viewer could not be loaded (no connection to cdn.jsdelivr.net?)'));
    document.head.appendChild(s);
  });
  box.textContent = 'Loading the 3D viewer…';
  _pjModelViewerLoading.then(() => {
    box.textContent = '';
    const mv = document.createElement('model-viewer');
    Object.assign(mv, { src: url, alt: name });
    mv.setAttribute('camera-controls', ''); mv.setAttribute('auto-rotate', ''); mv.setAttribute('shadow-intensity', '1');
    mv.style.cssText = 'width:100%;height:100%';
    box.appendChild(mv);
  }, e => { box.textContent = `${name}: ${e.message}`; });
}

/** Draw the rendered form of text (the editor's current value) into the view pane. */
function pjDrawRendered(host, kind, text, path) {
  host.textContent = '';
  const box = _pjEl('div', { className: 'pj-view pj-view-doc' });
  try {
    if (kind === 'markdown') pjMarkdownDoc(box, text, path);   // as a document: its images, links, tasks (projects/md-doc.js)
    else if (kind === 'html') box.appendChild(Object.assign(_pjEl('iframe', { title: path, srcdoc: text }, 'width:100%;height:100%;border:0;background:#fff'), { sandbox: '' }));
    else if (kind === 'svg') box.appendChild(_pjEl('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, alt: path }, 'max-width:100%;max-height:100%'));
    else if (kind === 'csv' || kind === 'tsv') box.appendChild(_pjTable(text, kind === 'tsv' ? '\t' : ','));
    else if (kind === 'json') box.appendChild(_pjEl('pre', { textContent: JSON.stringify(JSON.parse(text), null, 2) }, 'white-space:pre-wrap;width:100%;margin:0'));
  } catch (e) { box.appendChild(_pjEl('p', { textContent: `No preview: ${e.message}` })); }
  host.appendChild(box);
}

/** A delimited file as a table: quoted fields and doubled quotes, the first 2000 rows. */
function _pjTable(text, sep) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length && rows.length < 2000; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const table = _pjEl('table', { className: 'models-table' });
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    for (const v of r) tr.appendChild(_pjEl(i ? 'td' : 'th', { textContent: v }));
    table.appendChild(tr);
  });
  const wrap = _pjEl('div', {}, 'width:100%;overflow:auto');
  wrap.appendChild(table);
  return wrap;
}
