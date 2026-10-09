/* Field → Models → Library (modules/library; docs/experiments/library.md): the files on this machine searched by
   meaning. The common few — the model (and installing EmbeddingGemma 2 through Ollama's pull, asked with its size),
   the folders, the kinds, when it runs, captions — then the run with its bar, what each kind needs here, a try box,
   and the rest under Advanced. Drawn only with developer mode on; until the experiment is on, one line says so. */

const LIB_MODEL = { name: 'embeddinggemma-2:740m-mxfp8', size: '1.39 GB' };
let _libTimer = null;

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
  const s = v.settings, o = v.ollama;
  const ollama = !o ? '' : !o.reachable ? _libTick(false, `Ollama not answering at ${escHtml(o.url)}`)
    : `${_libTick(o.newEnough, `Ollama ${escHtml(o.version)}${o.newEnough ? '' : ' — EmbeddingGemma 2 needs 0.36 or newer'}`)} ${s.model ? _libTick(o.pulled, o.pulled ? `${escHtml(s.model)} pulled` : `${escHtml(s.model)} not pulled`) : ''}`;
  return `<div class="ww-row"><label>Model <input class="input" id="lib-model" value="${escHtml(s.model)}" placeholder="${LIB_MODEL.name}" style="width:260px"
      list="lib-models" onchange="librarySave({model:this.value})"></label><datalist id="lib-models">${(o?.models || []).map(m => `<option value="${escHtml(m)}">`).join('')}</datalist>
    ${o?.reachable && !o.pulled ? `<button class="btn btn-sm" onclick="libraryInstall()">Install EmbeddingGemma 2 (${LIB_MODEL.size})</button>` : ''}
    ${ollama} <span class="ww-dim">${escHtml(s.provider)}${v.local ? ' · on this machine' : ' · a hosted endpoint: file content is sent there'}</span></div>
    <div id="lib-install-out" class="ww-dim"></div>`;
}

function _libFolders(v) {
  const s = v.settings, open = new Set(s.open);
  const rows = s.folders.map((f, i) => `<div class="ww-row lib-folder"><code>${escHtml(f)}</code>
    <label class="ww-dim"><input type="checkbox" ${open.has(f) ? 'checked' : ''} onchange="libraryOpenFolder(${i}, this.checked)"> everyone who chats may search it</label>
    <button class="btn btn-xs" onclick="libraryRemoveFolder(${i})" title="Stop indexing it (its rows go at the next run)">✕</button></div>`).join('');
  return `<div class="input-label">Folders</div>${rows || '<div class="ww-dim">None yet — add a folder inside the Files roots.</div>'}
    ${v.folderNotes.map(n => `<div class="ww-dim">⚠ ${escHtml(n.folder)}: ${escHtml(n.why)}</div>`).join('')}
    <div class="ww-row"><input class="input" id="lib-add-folder" placeholder="/home/you/Pictures" style="flex:1;min-width:200px">
      <button class="btn btn-sm" onclick="libraryAddFolder()">Add</button></div>`;
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
      <div class="ww-dim">${running ? `${escHtml(r.phase)} ${r.done} of ${r.total}${r.waiting ? ' — waiting: the machine is busy' : ''}${r.current ? ` · ${escHtml(r.current)}` : ''}`
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
  try { v = await apiFetch('/api/library'); } catch (e) { card.innerHTML = `<div class="card-title">Library</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  if (!v.developer) { card.remove(); return; }
  const s = v.settings;
  const kinds = ['documents', 'images', 'audio', 'video'].map(k => `<label><input type="checkbox" ${s.kinds.includes(k) ? 'checked' : ''} onchange="libraryKinds()" data-kind="${k}"> ${k}</label>`).join(' ');
  card.innerHTML = `<div class="card-title">Library — your files, searched by meaning</div>
    <p class="ww-note">Folders of this machine indexed with a multimodal embedding model: find a recording by what is said in it, a picture or a video by what it shows,
      a document by its meaning — in Files ("Search by meaning") and by the agent. Tags come from the model alone, with no writing model; captions only when you switch them on.
      ${v.experiment ? '' : '<b>Off</b> until the experiment library is on (Settings → Developer); nothing runs or downloads until then.'}</p>
    ${_libModelRow(v)}
    ${_libFolders(v)}
    <div class="ww-row"><span class="input-label">Kinds</span> ${kinds}</div>
    <div class="ww-row"><label>When <select class="input" style="width:auto" onchange="librarySave({when:this.value})">
      ${[['demand', 'when I press Index'], ['schedule', `every ${s.everyHours} h`], ['watch', 'while the panel is open, when a folder changes']].map(([k, l]) => `<option value="${k}" ${s.when === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${v.watching ? '<span class="ww-dim">watching the folders now</span>' : ''}
      <label><input type="checkbox" ${s.captions ? 'checked' : ''} onchange="librarySave({captions:this.checked})"> write captions</label>
      <span class="ww-dim">${s.captions && v.captions ? escHtml(v.captions) : 'a model call per picture or video, with the vision model'}</span></div>
    <div class="ww-row"><label>Your own tags <input class="input" id="lib-own-tags" value="${escHtml(s.tags.join(', '))}" placeholder="boat, invoice, grandma's recipes" style="width:280px"
      onchange="librarySave({tags:this.value})"></label><span class="ww-dim">added to ${v.vocabulary - s.tags.length} shipped tags</span></div>
    ${_libRun(v)}
    ${_libNeeds(v)}
    <div class="ww-row"><input class="input" id="lib-try" placeholder="Try: a voice note about the boiler" style="flex:1;min-width:200px" onkeydown="if(event.key==='Enter')libraryTry()">
      <input class="input" id="lib-try-tags" placeholder="tags" style="width:120px"><button class="btn btn-sm" ${v.on ? '' : 'disabled'} onclick="libraryTry()">Search</button></div>
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

/** EmbeddingGemma 2 through Ollama's own pull (the Models tab's), asked first with its size. */
function libraryInstall() {
  appConfirm(`Pull ${LIB_MODEL.name} into Ollama on this machine? It is a ${LIB_MODEL.size} download and needs Ollama 0.36 or newer.`, () => {
    const out = document.getElementById('lib-install-out');
    let failed = false;
    sseStream('/api/models/ollama/pull', { name: LIB_MODEL.name }, {
      onEvent: d => {
        if (d.done) { failed = !!d.error; return; }
        if (out) out.textContent = d.total ? `${d.status} ${Math.round(((d.completed || 0) / d.total) * 100)}%` : (d.status || '');
      },
      onError: e => { failed = true; if (out) out.textContent = e.message || String(e); },
    }).then(() => { if (!failed) librarySave({ model: LIB_MODEL.name }); });
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
