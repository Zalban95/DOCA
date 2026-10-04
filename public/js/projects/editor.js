/* ═══════════════════════════════════════════════════════
   Projects → the editor: tabs of Monaco models, save, and compare.

   Monaco (MIT, the editor inside VS Code) is loaded from the CDN the panel
   already uses for xterm, the first time a file is opened — nobody who never
   opens the Projects tab downloads it. Everything Notepad++ users reach for is
   Monaco's own: Ctrl+F / Ctrl+H find and replace (regex, case, whole word, in
   selection), Ctrl+D and Alt+click multi-cursor, Ctrl+G go to line, F1 the
   command palette, folding, bracket matching, a minimap. Comparing is its diff
   editor: a file against its last commit, against any commit in its history,
   or against another file.
   ═══════════════════════════════════════════════════════ */

const MONACO_VER = '0.52.2';
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VER}/min`;

const PJE = {
  tabs: [],        // { key, path, title, model, saved (version id), diff?: { original, modified } }
  active: null,
  editor: null,
  diffEditor: null,
};

let _monacoLoading = null;
function pjMonaco() {
  if (window.monaco) return Promise.resolve(window.monaco);
  if (_monacoLoading) return _monacoLoading;
  _monacoLoading = new Promise((resolve, reject) => {
    // Workers from another origin cannot be started directly; a data: URL that
    // imports them can.
    window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
      `self.MonacoEnvironment={baseUrl:'${MONACO_BASE}/'};importScripts('${MONACO_BASE}/vs/base/worker/workerMain.js');`)}` };
    const s = document.createElement('script');
    s.src = `${MONACO_BASE}/vs/loader.js`;
    s.onload = () => {
      window.require.config({ paths: { vs: `${MONACO_BASE}/vs` } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    };
    s.onerror = () => reject(new Error('The editor could not be loaded (no connection to cdn.jsdelivr.net?).'));
    document.head.appendChild(s);
  });
  return _monacoLoading;
}

/** The panel's theme, as Monaco's: light for a light palette, dark otherwise. */
function _pjTheme() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(bg);
  const light = m && parseInt(m[1].slice(0, 2), 16) + parseInt(m[1].slice(2, 4), 16) + parseInt(m[1].slice(4, 6), 16) > 380;
  return light ? 'vs' : 'vs-dark';
}

async function _pjEditors() {
  const monaco = await pjMonaco();
  const host = document.getElementById('pj-editor');
  if (!PJE.editor) {
    host.innerHTML = '<div id="pj-ed-code" class="pj-ed"></div><div id="pj-ed-diff" class="pj-ed" style="display:none"></div>'
      + '<div id="pj-ed-view" class="pj-ed" style="display:none"></div>';   // pictures, players, renderings (projects/preview.js)
    const common = { automaticLayout: true, theme: _pjTheme(), fontSize: 13, minimap: { enabled: window.innerWidth > 900 } };
    PJE.editor = monaco.editor.create(document.getElementById('pj-ed-code'), { ...common, model: null });
    PJE.diffEditor = monaco.editor.createDiffEditor(document.getElementById('pj-ed-diff'), { ...common, renderSideBySide: window.innerWidth > 900, originalEditable: false });
    PJE.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => pjSave());
    PJE.diffEditor.getModifiedEditor().addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => pjSave());
    PJE.editor.onDidChangeModelContent(() => _pjTabsRender());
    PJE.editor.onDidChangeCursorPosition(e => _pjCursor(e.position));
  }
  return monaco;
}

function _pjLang(monaco, path) {
  const ext = `.${String(path).split('.').pop().toLowerCase()}`;
  const byName = { Dockerfile: 'dockerfile', Makefile: 'makefile' }[String(path).split('/').pop()];
  if (byName) return byName;
  return monaco.languages.getLanguages().find(l => (l.extensions || []).includes(ext))?.id || 'plaintext';
}

/** Open a file (absolute path) in a tab, optionally at a line and column. */
async function pjOpenFile(path, line, col) {
  const monaco = await _pjEditors();
  let tab = PJE.tabs.find(t => t.key === path);
  const kind = pjViewKind(path);   // shown as itself, not as text (projects/preview.js)
  if (!tab && kind) {
    tab = { key: path, path, title: path.split('/').pop(), view: { kind, path } };
    PJE.tabs.push(tab);
  } else if (!tab) {
    let r;
    try { r = await apiFetch(`/api/files/read?path=${encodeURIComponent(path)}&sniff=1`); }
    catch (e) { return setStatus(document.getElementById('pj-status'), `✗ ${e.message}`, 'err'); }
    if (r.binary) {
      tab = { key: path, path, title: path.split('/').pop(), view: { kind: 'binary', path, size: r.size } };
      PJE.tabs.push(tab);
      pjActivate(tab.key);
      return;
    }
    const model = monaco.editor.createModel(r.content, _pjLang(monaco, path), monaco.Uri.file(path));
    tab = { key: path, path, title: path.split('/').pop(), model, saved: model.getAlternativeVersionId() };
    PJE.tabs.push(tab);
    pjLspAttach(model);   // problems, hover, completion, definition — when its language server is here (projects/lsp.js)
  }
  pjActivate(tab.key);
  if (window.innerWidth <= 768) document.getElementById('pj-body')?.classList.remove('side-open');
  if (line && tab.model) {
    PJE.editor.revealLineInCenter(line);
    PJE.editor.setPosition({ lineNumber: line, column: col || 1 });
    PJE.editor.focus();
  }
}

/** Compare: `original` text (or a file) on the left, a file (editable) or text on the right. */
async function pjCompare({ title, originalText, originalPath, modifiedPath, modifiedText, lang }) {
  const monaco = await _pjEditors();
  const read = async p => (await apiFetch(`/api/files/read?path=${encodeURIComponent(p)}`)).content;
  const l = lang || _pjLang(monaco, modifiedPath || originalPath || '');
  const original = monaco.editor.createModel(originalText ?? (originalPath ? await read(originalPath) : ''), l);
  // The right side of a file comparison is the file's own model, so editing and saving it there is editing the file.
  let modified;
  if (modifiedPath) {
    await pjOpenFile(modifiedPath);
    modified = PJE.tabs.find(t => t.key === modifiedPath).model;
  } else modified = monaco.editor.createModel(modifiedText ?? '', l);
  const key = `diff:${title}`;
  PJE.tabs = PJE.tabs.filter(t => t.key !== key);
  PJE.tabs.push({ key, title: `⇆ ${title}`, path: modifiedPath || null, model: modified, diff: { original, modified }, saved: modified.getAlternativeVersionId() });
  pjActivate(key);
}

function pjActivate(key) {
  const tab = PJE.tabs.find(t => t.key === key);
  if (!tab) return;
  PJE.active = key;
  const code = document.getElementById('pj-ed-code'), diff = document.getElementById('pj-ed-diff'), view = document.getElementById('pj-ed-view');
  const show = el => { for (const x of [code, diff, view]) x.style.display = x === el ? '' : 'none'; };
  if (tab.view) {
    show(view); pjDrawView(view, tab.view);
  } else if (tab.diff) {
    show(diff); PJE.diffEditor.setModel(tab.diff);
  } else if (tab.preview) {
    show(view); pjDrawRendered(view, pjRenderedKind(tab.path), tab.model.getValue(), tab.path);
  } else {
    show(code); PJE.editor.setModel(tab.model);
  }
  _pjTabsRender();
  _pjCursor(PJE.editor.getPosition());
}

function _pjDirty(t) { return !!(t.path && t.model && t.model.getAlternativeVersionId() !== t.saved); }

/** 👁 on a text file with a rendered form: source ⇄ rendering, from the current (unsaved) text. */
function pjTogglePreview() {
  const t = PJE.tabs.find(x => x.key === PJE.active);
  if (!t?.model || t.diff || !pjRenderedKind(t.path)) return;
  t.preview = !t.preview;
  pjActivate(t.key);
}

function _pjTabsRender() {
  const bar = document.getElementById('pj-tabs');
  if (!bar) return;
  bar.innerHTML = '';
  for (const t of PJE.tabs) {
    const el = document.createElement('div');
    el.className = `pj-tab${t.key === PJE.active ? ' active' : ''}`;
    el.title = t.path || t.title;
    el.onclick = () => pjActivate(t.key);
    const name = document.createElement('span');
    name.textContent = `${_pjDirty(t) ? '● ' : ''}${t.title}`;
    const x = document.createElement('button');
    x.className = 'pj-tab-x'; x.textContent = '×'; x.title = 'Close';
    x.onclick = e => { e.stopPropagation(); pjClose(t.key); };
    el.append(name, x);
    bar.appendChild(el);
  }
  const active = PJE.tabs.find(t => t.key === PJE.active);
  if (active?.model && !active.diff && pjRenderedKind(active.path)) {
    const eye = document.createElement('button');
    eye.className = `btn btn-xs pj-tab-preview${active.preview ? ' btn-blue' : ''}`;
    eye.textContent = active.preview ? '✎ Source' : '👁 Preview';
    eye.title = active.preview ? 'Back to the source' : 'Show it rendered (from the text as it stands, saved or not)';
    eye.style.cssText = 'margin:3px 6px 3px auto;flex-shrink:0';
    eye.onclick = pjTogglePreview;
    bar.appendChild(eye);
  }
}

function pjClose(key) {
  const t = PJE.tabs.find(x => x.key === key);
  if (!t) return;
  const go = () => {
    PJE.tabs = PJE.tabs.filter(x => x.key !== key);
    // A file's model is shared with its comparisons; dispose it only when no tab still shows it.
    if (t.model && !PJE.tabs.some(x => x.model === t.model)) t.model.dispose();
    if (t.view) document.getElementById('pj-ed-view')?.querySelectorAll('video,audio').forEach(m => { try { m.pause(); } catch {} });
    if (t.diff) t.diff.original.dispose();
    if (PJE.active === key) {
      const next = PJE.tabs.at(-1);
      if (next) pjActivate(next.key);
      else { PJE.active = null; PJE.editor?.setModel(null); document.getElementById('pj-ed-diff').style.display = 'none'; document.getElementById('pj-ed-view').style.display = 'none'; document.getElementById('pj-ed-code').style.display = ''; }
    }
    _pjTabsRender();
  };
  if (_pjDirty(t) && !PJE.tabs.some(x => x !== t && x.model === t.model)) appConfirm(`${t.title} has unsaved changes. Close it anyway?`, go);
  else go();
}

async function pjSave() {
  const t = PJE.tabs.find(x => x.key === PJE.active);
  if (!t?.path || !t.model) return;
  const st = document.getElementById('pj-status');
  try {
    await apiFetch('/api/files/write', { method: 'POST', body: { path: t.path, content: t.model.getValue() } });
    const v = t.model.getAlternativeVersionId();
    for (const x of PJE.tabs) if (x.model === t.model) x.saved = v;
    _pjTabsRender();
    setStatus(st, `✓ Saved ${pjRel(t.path)}`, 'ok');
    if (PJ.view === 'git') pjGitRender(document.getElementById('pj-side-body'));
    pjRefresh();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

function _pjCursor(pos) {
  const st = document.getElementById('pj-status');
  const t = PJE.tabs.find(x => x.key === PJE.active);
  if (!st || !t || st.classList.contains('ok') || st.classList.contains('err')) return;
  st.textContent = t.model
    ? `${t.path ? pjRel(t.path) : t.title}${pos && !t.preview ? `   Ln ${pos.lineNumber}, Col ${pos.column}` : ''}   ${t.preview ? 'preview' : t.model.getLanguageId()}`
    : `${pjRel(t.path)}   ${t.view.kind}`;
}

/** Another project: close everything, asking once if anything is unsaved. */
function pjEditorReset() {
  for (const t of PJE.tabs) { if (t.diff) t.diff.original.dispose(); }
  for (const m of new Set(PJE.tabs.map(t => t.model).filter(Boolean))) m.dispose();
  PJE.tabs = []; PJE.active = null;
  PJE.editor?.setModel(null);
  _pjTabsRender();
}
