/* Files → "Search by meaning" (modules/library, experiment library): a box above the folder that searches the Library
   instead of the names in this folder — results with their kind, a thumbnail or waveform, the moment that matched,
   the tags as chips, Open and Like this (library-results.js). Shown only while the experiment is on; ✕ goes back to
   the folder. Search within the folder in view when "only here" is ticked. */

async function libraryFilesMount() {
  const main = document.querySelector('#tab-files .fm-main'), crumb = document.getElementById('fm-breadcrumb');
  if (!main || !crumb) return;
  if (typeof licenceReady === 'function') await licenceReady();
  if (!(typeof licenceFeatureOn !== 'function' || licenceFeatureOn('library'))) return;   // not licensed here (lib/licence.js)
  let v = null;
  try { v = await apiFetch('/api/library?brief=1'); } catch { /* not this person's, or the hub is older */ }
  let bar = document.getElementById('lib-files-bar');
  if (!v?.experiment) { bar?.remove(); document.getElementById('lib-files-results')?.remove(); return; }
  if (bar) return;
  bar = Object.assign(document.createElement('div'), { id: 'lib-files-bar', className: 'lib-files-bar' });
  bar.innerHTML = `<input class="input" id="lib-files-q" placeholder="Search by meaning — an audio that says…, a photo of…" onkeydown="if(event.key==='Enter')libraryFilesSearch()">
    <select class="input" id="lib-files-kind" style="width:auto"><option value="">every kind</option>
      ${['documents', 'images', 'audio', 'video'].map(k => `<option value="${k}">${k}</option>`).join('')}</select>
    <input class="input" id="lib-files-tags" placeholder="tags" style="width:110px">
    <label class="ww-dim"><input type="checkbox" id="lib-files-here"> only here</label>
    <button class="btn btn-sm btn-blue" onclick="libraryFilesSearch()">Search</button>
    <button class="btn btn-sm" id="lib-files-close" style="display:none" onclick="libraryFilesClose()" title="Back to the folder">✕</button>`;
  crumb.before(bar);
  const out = Object.assign(document.createElement('div'), { id: 'lib-files-results', className: 'lib-results lib-files-results' });
  out.style.display = 'none';
  bar.after(out);
}

async function libraryFilesSearch() {
  const q = document.getElementById('lib-files-q')?.value.trim(), out = document.getElementById('lib-files-results');
  if (!q || !out) return;
  const kind = document.getElementById('lib-files-kind').value, tags = document.getElementById('lib-files-tags').value.trim();
  const here = document.getElementById('lib-files-here').checked && typeof fm !== 'undefined' ? fm.cwd : '';
  out.style.display = '';
  document.getElementById('lib-files-close').style.display = '';
  document.getElementById('fm-layout')?.classList.add('lib-searching');
  out.innerHTML = '<div class="placeholder pulse">Searching the Library…</div>';
  try {
    const r = await apiFetch(`/api/library/search?q=${encodeURIComponent(q)}&limit=20${kind ? `&kinds=${kind}` : ''}${tags ? `&tags=${encodeURIComponent(tags)}` : ''}${here ? `&folder=${encodeURIComponent(here)}` : ''}`);
    out.innerHTML = libraryResultsHtml(r.results, 'files', r.note);
  } catch (e) { out.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; }
}

function libraryFilesClose() {
  const out = document.getElementById('lib-files-results');
  if (out) { out.style.display = 'none'; out.innerHTML = ''; }
  document.getElementById('lib-files-close').style.display = 'none';
  document.getElementById('fm-layout')?.classList.remove('lib-searching');
}
