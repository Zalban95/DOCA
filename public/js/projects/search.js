/* ═══════════════════════════════════════════════════════
   Projects → Search: search in files, and replace in files — Notepad++'s
   "Find in Files" and VS Code's search view. Match case, whole word, regular
   expression, files to include and exclude. Replace previews every change
   (per file, per line) and writes only after "Replace all" is confirmed; a
   file's checkbox leaves it out. Same calls as the agent's search_files /
   replace_in_files.
   ═══════════════════════════════════════════════════════ */

const PJS = { opts: { caseSensitive: false, wholeWord: false, regex: false }, last: null, preview: null };

function pjSearchRender(body) {
  body.innerHTML = `
    <div class="pj-search">
      <div class="pj-search-row">
        <input class="input" id="pjs-q" placeholder="Search" onkeydown="if(event.key==='Enter')pjSearchRun()">
        <button class="btn btn-xs pj-opt${PJS.opts.caseSensitive ? ' on' : ''}" data-opt="caseSensitive" title="Match case" onclick="pjSearchOpt(this)">Aa</button>
        <button class="btn btn-xs pj-opt${PJS.opts.wholeWord ? ' on' : ''}" data-opt="wholeWord" title="Whole word" onclick="pjSearchOpt(this)">ab</button>
        <button class="btn btn-xs pj-opt${PJS.opts.regex ? ' on' : ''}" data-opt="regex" title="Regular expression" onclick="pjSearchOpt(this)">.*</button>
      </div>
      <div class="pj-search-row">
        <input class="input" id="pjs-r" placeholder="Replace" onkeydown="if(event.key==='Enter')pjReplacePreview()">
        <button class="btn btn-xs" onclick="pjReplacePreview()" title="Show every change first">Preview</button>
      </div>
      <input class="input" id="pjs-inc" placeholder="Files to include (e.g. *.kt, src/**)">
      <input class="input" id="pjs-exc" placeholder="Files to exclude">
      <div class="pj-search-summary" id="pjs-sum"></div>
      <div class="pj-results" id="pjs-results"></div>
    </div>`;
  if (PJS.last) {
    document.getElementById('pjs-q').value = PJS.last.query;
    document.getElementById('pjs-inc').value = PJS.last.include || '';
    document.getElementById('pjs-exc').value = PJS.last.exclude || '';
  }
  document.getElementById('pjs-q').focus();
}

function pjSearchOpt(btn) {
  PJS.opts[btn.dataset.opt] = !PJS.opts[btn.dataset.opt];
  btn.classList.toggle('on', PJS.opts[btn.dataset.opt]);
  if (document.getElementById('pjs-q').value) pjSearchRun();
}

function _pjsBody() {
  return { query: document.getElementById('pjs-q').value, include: document.getElementById('pjs-inc').value,
    exclude: document.getElementById('pjs-exc').value, ...PJS.opts };
}

async function pjSearchRun() {
  const body = _pjsBody();
  if (!body.query) return;
  PJS.last = body; PJS.preview = null;
  const sum = document.getElementById('pjs-sum'), out = document.getElementById('pjs-results');
  sum.textContent = 'Searching…'; out.innerHTML = '';
  let r;
  try { r = await apiFetch(`/api/projects/${encodeURIComponent(PJ.project.project.id)}/search`, { method: 'POST', body }); }
  catch (e) { sum.textContent = `✗ ${e.message}`; return; }
  sum.textContent = `${r.matches.length}${r.truncated ? '+' : ''} results in ${r.files} files${r.truncated ? ' — narrow the search to see the rest' : ''}`;
  const byFile = new Map();
  for (const m of r.matches) { if (!byFile.has(m.file)) byFile.set(m.file, []); byFile.get(m.file).push(m); }
  for (const [file, ms] of byFile) {
    const head = document.createElement('div');
    head.className = 'pj-res-file';
    head.textContent = `${file}  (${ms.length})`;
    out.appendChild(head);
    for (const m of ms) {
      const row = document.createElement('div');
      row.className = 'pj-res-line';
      const text = m.text.replace(/^\s+/, ''), cut = m.text.length - text.length;
      const at = Math.max(0, m.col - 1 - cut);
      row.append(Object.assign(document.createElement('span'), { className: 'pj-res-n', textContent: `${m.line}` }),
        document.createTextNode(text.slice(0, at)),
        Object.assign(document.createElement('mark'), { textContent: text.slice(at, at + m.length) }),
        document.createTextNode(text.slice(at + m.length, at + m.length + 160)));
      row.onclick = () => pjOpenFile(pjAbs(file), m.line, m.col);
      out.appendChild(row);
    }
  }
}

async function pjReplacePreview() {
  const body = { ..._pjsBody(), replacement: document.getElementById('pjs-r').value };
  if (!body.query) return;
  const sum = document.getElementById('pjs-sum'), out = document.getElementById('pjs-results');
  let r;
  try { r = await apiFetch(`/api/projects/${encodeURIComponent(PJ.project.project.id)}/replace`, { method: 'POST', body }); }
  catch (e) { sum.textContent = `✗ ${e.message}`; return; }
  PJS.preview = { body, files: new Set(r.changes.map(c => c.file)) };
  sum.innerHTML = '';
  sum.append(`${r.replacements} replacements in ${r.files} files — nothing written yet. `);
  const go = Object.assign(document.createElement('button'), { className: 'btn btn-xs btn-amber', textContent: 'Replace all' });
  go.onclick = pjReplaceApply;
  if (r.replacements) sum.appendChild(go);
  out.innerHTML = '';
  for (const c of r.changes) {
    const head = document.createElement('label');
    head.className = 'pj-res-file';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
    box.onchange = () => (box.checked ? PJS.preview.files.add(c.file) : PJS.preview.files.delete(c.file));
    head.append(box, ` ${c.file}  (${c.replacements})`);
    out.appendChild(head);
    for (const l of c.lines) {
      const row = document.createElement('div');
      row.className = 'pj-res-line pj-res-change';
      row.append(Object.assign(document.createElement('span'), { className: 'pj-res-n', textContent: `${l.line}` }),
        Object.assign(document.createElement('del'), { textContent: l.before.trim() }),
        Object.assign(document.createElement('ins'), { textContent: l.after.trim() }));
      row.onclick = () => pjOpenFile(pjAbs(c.file), l.line);
      out.appendChild(row);
    }
  }
}

function pjReplaceApply() {
  const pv = PJS.preview;
  if (!pv?.files.size) return;
  appConfirm(`Replace in ${pv.files.size} file(s)? Open editors of those files are reloaded.`, async () => {
    try {
      const r = await apiFetch(`/api/projects/${encodeURIComponent(PJ.project.project.id)}/replace`,
        { method: 'POST', body: { ...pv.body, only: [...pv.files], apply: true } });
      setStatus(document.getElementById('pj-status'), `✓ ${r.replacements} replacements in ${r.files} files`, 'ok');
      // Reload the files that changed, unless there are edits in them that were not saved.
      for (const t of PJE.tabs) {
        if (!t.path || !pv.files.has(pjRel(t.path)) || t.model.getAlternativeVersionId() !== t.saved) continue;
        const { content } = await apiFetch(`/api/files/read?path=${encodeURIComponent(t.path)}`);
        t.model.setValue(content); t.saved = t.model.getAlternativeVersionId();
      }
      PJS.preview = null;
      pjSearchRun();
      pjRefresh();
    } catch (e) { appAlert(e.message); }
  });
}
