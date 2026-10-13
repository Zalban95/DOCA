/* Field → Models → Library (modules/library; docs/experiments/library.md): the files on this machine searched by
   meaning. The common few — the model (and installing EmbeddingGemma 2 through Ollama's pull, asked with its size),
   the folders, the kinds, when it runs, captions — then the run with its bar, what each kind needs here, a try box,
   and the rest under Advanced. Drawn only with developer mode on; until the experiment is on, one line says so. */

const LIB_MODEL = { name: 'embeddinggemma-2:740m-mxfp8', size: '1.39 GB' };
let _libTimer = null;
let _libLast = null;   // the section's last answer (what the machine has, for the install's messages)

async function libraryTab() {
  let card = document.getElementById('lib-card');
  if (!card) {
    card = Object.assign(document.createElement('div'), { className: 'card', id: 'lib-card' });
    document.getElementById('tab-models')?.append(card);
  }
  return libraryLoad();
}

const _libTick = (ok, label) => `<span class="ww-tick ${ok ? 'ok' : ''}">${ok ? '✓' : '·'} ${label}</span>`;

function _libModelRow(v) {
  const s = v.settings, o = v.ollama, sug = v.suggest || { model: LIB_MODEL.name, size: LIB_MODEL.size, needs: [] }, need = sug.needs?.[0];
  const ollama = !o ? '' : !o.reachable ? _libTick(false, `Ollama not answering at ${escHtml(o.url)}`)
    : `${_libTick(o.newEnough, `Ollama ${escHtml(o.version)}${o.newEnough ? '' : ' — EmbeddingGemma 2 needs 0.36 or newer'}`)} ${s.model ? _libTick(o.pulled, o.pulled ? `${escHtml(s.model)} pulled` : `${escHtml(s.model)} not pulled`) : ''}`;
  return `<div class="ww-row"><label>Model <input class="input" id="lib-model" value="${escHtml(s.model)}" placeholder="${LIB_MODEL.name}" style="width:260px"
      list="lib-models" onchange="librarySave({model:this.value})"></label>${infoBtn('The model that reads your files and turns them into something searchable by meaning (an embedding model). The suggested one is EmbeddingGemma 2, run by Ollama on this machine; Install fetches it. Saved when changed; files are read again with a new model.')}<datalist id="lib-models">${(o?.models || []).map(m => `<option value="${escHtml(m)}">`).join('')}</datalist>
    ${o?.reachable && !o.newEnough ? `<button class="btn btn-sm" onclick="libraryUpdateOllama()">Update Ollama first</button>`
      : o?.reachable && need ? `<button class="btn btn-sm" onclick="libraryInstallTool('${escHtml(need.id)}')">Install ${escHtml(need.label)} first</button>`
      : o?.reachable && !o.pulled ? `<button class="btn btn-sm" onclick="libraryInstall('${escHtml(sug.model)}', '${escHtml(sug.size)}')">Install ${escHtml(sug.model)} (${escHtml(sug.size)})</button>` : ''}
    ${ollama} <span class="ww-dim">${escHtml(s.provider)}${v.local ? ' · on this machine' : ' · a hosted endpoint: file content is sent there'}</span></div>
    ${v.suggest ? `<div class="ww-dim">Suggested here: <code>${escHtml(sug.model)}</code> — ${escHtml(sug.why)}</div>` : ''}
    <div class="ww-row"><label><input type="checkbox" ${s.makeRoom ? 'checked' : ''} onchange="librarySave({makeRoom:this.checked})"> make room on the GPU while it works</label>${infoBtn('When the graphics card is full, the Library frees what nothing uses now — another Ollama model, a service DOCA starts again when needed, an idle model of a llama.cpp router — and gives the room back when a turn or a request needs it and when the run ends. Each freed model comes back by itself when asked; nothing started outside DOCA is touched. Every stop is in the activity log.')}
      ${v.room ? `<span class="ww-dim">room made: ${escHtml(v.room.freed.join('; '))}</span>` : ''}</div>
    <div id="lib-install-out" class="ww-dim"></div>`;
}

function _libFolders(v) {
  const s = v.settings, open = new Set(s.open);
  const rows = s.folders.map((f, i) => `<div class="ww-row lib-folder"><code>${escHtml(f)}</code>
    <label class="ww-dim"><input type="checkbox" ${open.has(f) ? 'checked' : ''} onchange="libraryOpenFolder(${i}, this.checked)"> everyone who chats may search it</label>${infoBtn("Off (the default): only admins' searches find files from this folder. On: every person who chats here may find them too.")}
    <button class="btn btn-xs" onclick="libraryRemoveFolder(${i})" title="Stop indexing it (its rows go at the next run)">✕</button></div>`).join('');
  return `<div class="input-label">Folders</div>${rows || '<div class="ww-dim">None yet — add a folder inside the Files roots.</div>'}
    ${v.folderNotes.map(n => `<div class="ww-dim">⚠ ${escHtml(n.folder)}: ${escHtml(n.why)}</div>`).join('')}
    <div class="ww-row"><input class="input" id="lib-add-folder" data-path-pick="dir" placeholder="/home/you/Pictures" style="flex:1;min-width:200px">
      <button class="btn btn-sm" onclick="libraryAddFolder()">Add</button>${infoBtn('A folder of this machine to index, inside the folders the Files page may open. Its files are read at the next indexing run.')}</div>`;
}

function _libRun(v) {
  const r = v.run, running = r?.running;
  const pct = r?.total ? Math.round((r.done / r.total) * 100) : 0;
  const stats = (v.index.byKind || []).reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + x.n; return m; }, {});
  return `<div class="ww-row">
      <button class="btn btn-sm btn-blue" ${running || !v.on ? 'disabled' : ''} onclick="libraryDo('run')">Index now</button>
      ${running ? '<button class="btn btn-sm btn-red" onclick="libraryDo(\'stop\')">■ Stop</button>' : ''}
      <button class="btn btn-sm" ${running ? 'disabled' : ''} onclick="libraryEmpty()">Empty the index</button>
      <span class="ww-dim">${Object.entries(stats).map(([k, n]) => `${n} ${escHtml(k)}`).join(' · ') || 'nothing indexed'} · ${v.index.pieces} pieces</span></div>
    ${r ? `<div class="models-pull-progress" style="display:block"><div class="models-pull-progress-bar" style="width:${running ? pct : 100}%"></div></div>
      <div class="ww-dim">${running ? `${escHtml(r.phase)} ${r.done} of ${r.total}${r.waiting === 'models' ? ' — waiting: a turn or another model is using the GPU' : r.waiting ? ' — waiting: the machine is busy' : ''}${r.current ? ` · ${escHtml(r.current)}` : ''}`
        : `Last run (${escHtml(r.why)}): ${r.read} read, ${r.removed} removed, ${r.failed} failed, ${r.skipped} skipped${r.captions ? `, ${r.captions} captions` : ''}${r.over ? ` · ${r.over} past the file limit` : ''}${r.error ? ` — ${escHtml(r.error)}` : ''}`}</div>` : ''}`;
}

function _libNeeds(v) {
  const h = v.have;
  return `<div class="ww-row">${_libTick(h.ffmpeg, 'ffmpeg (sound, frames, pictures)')}${_libTick(h.stt, 'speech-to-text (words in audio and video)')}${_libTick(h.pdftotext, 'pdftotext (PDF)')}
    ${_libTick(h.soffice, 'LibreOffice (office files)')}${_libTick(h.exiftool, 'exiftool (photo dates)')}${_libTick(h.vision, 'a vision model (captions)')}</div>`;
}

async function libraryLoad() {
  const card = document.getElementById('lib-card');
  if (!card) return;
  if (typeof licenceReady === 'function') await licenceReady();
  if (!(typeof licenceFeatureOn !== 'function' || licenceFeatureOn('library'))) { card.style.display = 'none'; return; }   // not licensed here (lib/licence.js)
  let v;
  try { v = _libLast = await apiFetch('/api/library'); } catch (e) { card.innerHTML = `<div class="card-title">Library</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  if (!v.developer) { card.remove(); return; }
  const s = v.settings;
  const kinds = ['documents', 'images', 'audio', 'video'].map(k => `<label><input type="checkbox" ${s.kinds.includes(k) ? 'checked' : ''} onchange="libraryKinds()" data-kind="${k}"> ${k}</label>`).join(' ');
  card.innerHTML = `<div class="card-title">Library — your files, searched by meaning</div>
    <p class="ww-note">Find your files by what they contain — a recording by what is said in it, a picture by what it shows.
      ${v.experiment ? '' : '<b>Off</b> until the experiment library is on (Settings → Developer); nothing runs or downloads until then.'}</p>
    <details class="desc page-about" style="margin:0 0 8px;font-size:11px"><summary>What this is</summary>Folders of this machine indexed with a multimodal embedding model: find a recording by what is said in it, a picture or a video by what it shows,
      a document by its meaning — in Files ("Search by meaning") and by the agent. Tags come from the model alone, with no writing model; captions only when you switch them on.</details>
    ${_libModelRow(v)}
    ${_libFolders(v)}
    <div class="ww-row"><span class="input-label">Kinds ${infoBtn('Which kinds of file are read: documents, pictures, sound and video. Untick a kind to leave those files out of the index.')}</span> ${kinds}</div>
    <div class="ww-row"><label>When ${infoBtn('When the folders are read: only when you press Index now, every few hours, or while the panel is open, whenever a folder changes.')} <select class="input" style="width:auto" onchange="librarySave({when:this.value})">
      ${[['demand', 'when I press Index'], ['schedule', `every ${s.everyHours} h`], ['watch', 'while the panel is open, when a folder changes']].map(([k, l]) => `<option value="${k}" ${s.when === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${v.watching ? '<span class="ww-dim">watching the folders now</span>' : ''}
      <label><input type="checkbox" ${s.captions ? 'checked' : ''} onchange="librarySave({captions:this.checked})"> write captions</label>${infoBtn('Also has the vision model write a short description of each picture and video, so they are found by more words. Off by default: it costs a model call per file.')}
      <span class="ww-dim">${s.captions && v.captions ? escHtml(v.captions) : 'a model call per picture or video, with the vision model'}</span></div>
    <div class="ww-row"><label>Your own tags <input class="input" id="lib-own-tags" value="${escHtml(s.tags.join(', '))}" placeholder="boat, invoice, grandma's recipes" style="width:280px"
      onchange="librarySave({tags:this.value})"></label>${infoBtn('Words of your own, separated by commas, that files may be tagged with besides the shipped ones (boat, invoice). Saved when changed.')}<span class="ww-dim">added to ${v.vocabulary - s.tags.length} shipped tags</span></div>
    ${_libRun(v)}
    ${_libNeeds(v)}
    <div class="ww-row"><input class="input" id="lib-try" placeholder="Try: a voice note about the boiler" style="flex:1;min-width:200px" onkeydown="if(event.key==='Enter')libraryTry()">
      <input class="input" id="lib-try-tags" aria-label="Only with these tags" placeholder="tags" style="width:120px"><button class="btn btn-sm" ${v.on ? '' : 'disabled'} onclick="libraryTry()">Search</button>${infoBtn('Try a search as the agent would: describe what you are looking for in words; optionally only files with these tags (comma-separated). Nothing is saved.')}</div>
    <div id="lib-try-out" class="lib-results"></div>
    <div id="lib-advanced"></div>`;
  leafFieldsDraw(document.getElementById('lib-advanced'), ['library.provider', 'library.dialect', 'library.everyHours', 'library.transcribe', 'library.frameEverySec',
    'library.maxFiles', 'library.maxPieces', 'library.maxFileMB', 'library.idleLoad', 'library.tagMargin', 'library.captionsPerRun'], { label: 'Advanced — endpoint, limits, pace', id: 'library-advanced' });
  clearTimeout(_libTimer);
  if (v.run?.running) _libTimer = setTimeout(() => { if (document.getElementById('lib-card') && currentTab === 'models') libraryLoad(); }, 3000);
}

async function librarySave(body) {
  try { await apiFetch('/api/library', { method: 'POST', body }); } catch (e) { appAlert(e.message); }
  libraryLoad();
}
async function _libFoldersNow() { return (await apiFetch('/api/library')).settings; }
async function libraryAddFolder() {
  const f = document.getElementById('lib-add-folder').value.trim();
  if (!f) return;
  const s = await _libFoldersNow();
  librarySave({ folders: [...s.folders, f] });
}
async function libraryRemoveFolder(i) { const s = await _libFoldersNow(); librarySave({ folders: s.folders.filter((_, k) => k !== i), open: s.open }); }
async function libraryOpenFolder(i, on) {
  const s = await _libFoldersNow(), f = s.folders[i];
  librarySave({ open: on ? [...new Set([...s.open, f])] : s.open.filter(x => x !== f) });
}
function libraryKinds() { librarySave({ kinds: [...document.querySelectorAll('#lib-card [data-kind]')].filter(x => x.checked).map(x => x.dataset.kind) }); }

async function libraryDo(what) {
  try { await apiFetch(`/api/library/${what}`, { method: 'POST' }); } catch (e) { appAlert(e.message); }
  libraryLoad();
}
function libraryEmpty() {
  appConfirm('Empty the Library\'s index? Its rows and vectors are deleted; the files are not touched. The next run reads everything again.', async () => {
    try { await apiFetch('/api/library/index', { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    libraryLoad();
  });
}

/** An Ollama too old for the model: its row in System tools, updated by that row's own installer (asked, with the
    machine's password where it needs one) — the Library never installs a model that would not load. */
async function libraryUpdateOllama() {
  settingsSubNav('system');
  await sysdepsLoad();
  document.getElementById('sysdeps-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  sysdepsUpdate('ollama');
}

/** What the suggested model still needs on this machine (Ollama's MLX runtime): its System tools row, installed by
    that row's own command, asked with the machine's password. */
async function libraryInstallTool(id) {
  settingsSubNav('system');
  await sysdepsLoad();
  document.getElementById('sysdeps-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  sysdepsInstall(id);
}

/** Ollama saying it has no MLX while the runtime's files are here: it started before they were unpacked. */
function _libMlxHint(err) {
  return /MLX runtime is not available/i.test(String(err || '')) && _libLast?.suggest?.mlx
    ? ' — Ollama\'s MLX runtime is installed, but Ollama started before it was: restart Ollama (sudo systemctl restart ollama), then Install again.' : '';
}

/** The suggested model through Ollama's own pull (the Models tab's), asked first with its size. */
function libraryInstall(name = LIB_MODEL.name, size = LIB_MODEL.size) {
  appConfirm(`Pull ${name} into Ollama on this machine? It is a ${size} download.`, () => {
    const out = document.getElementById('lib-install-out');
    let failed = false;
    sseStream('/api/models/ollama/pull', { name }, {
      onEvent: d => {
        if (d.error && out) out.textContent = `Not installed: ${typeof d.error === 'string' ? d.error : d.status}${_libMlxHint(d.error)}`;
        if (d.done) { failed = !!d.error; return; }
        if (d.error) { failed = true; return; }
        if (out) out.textContent = d.total ? `${d.status} ${Math.round(((d.completed || 0) / d.total) * 100)}%` : (d.status || '');
      },
      onError: e => { failed = true; if (out) out.textContent = e.message || String(e); },
    }).then(() => { if (!failed) librarySave({ model: name }); });
  });
}

async function libraryTry() {
  const out = document.getElementById('lib-try-out'), q = document.getElementById('lib-try').value.trim(), tags = document.getElementById('lib-try-tags').value.trim();
  if (!q) { out.innerHTML = '<div class="ww-dim">Write what to look for first.</div>'; return; }
  out.innerHTML = '<div class="placeholder pulse">Searching…</div>';
  try {
    const r = await apiFetch(`/api/library/search?q=${encodeURIComponent(q)}&limit=8${tags ? `&tags=${encodeURIComponent(tags)}` : ''}`);
    out.innerHTML = libraryResultsHtml(r.results, 'try', r.note);
  } catch (e) { out.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; }
}
