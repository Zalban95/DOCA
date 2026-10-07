/* Agents → Archive (modules/archive.js): conversations, missions, projects and the agents' computers that were put away
   rather than deleted — newest first, each restored with one click. A computer comes back stopped, with its desktop,
   logins and files as they were. Its page is made here: index.html is at its line ceiling. */
const ARCHIVE_KINDS = { conversation: '💬 Conversation', mission: '⬡ Mission', project: '⟨⟩ Project', computer: '🖵 Computer' };

async function archiveInit() {
  const page = document.getElementById('tab-archive');
  if (!page) return;
  page.innerHTML = '<div class="card"><div class="placeholder pulse">Loading…</div></div>';
  let items;
  try { items = (await apiFetch('/api/archive')).items; } catch (e) { page.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const filter = page.dataset.filter || '';
  const shown = items.filter(i => !filter || i.kind === filter);
  page.innerHTML = `<div class="card"><div class="card-title" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">Archive
      <span style="font-size:11px;color:var(--muted);text-transform:none;letter-spacing:0">What was put away rather than deleted — restore brings it back as it was.</span>
      <select class="input" style="width:auto;margin-left:auto" onchange="document.getElementById('tab-archive').dataset.filter=this.value;archiveInit()">
        <option value="">everything (${items.length})</option>${Object.entries(ARCHIVE_KINDS).map(([k, l]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${l}s (${items.filter(i => i.kind === k).length})</option>`).join('')}</select></div>
    ${shown.map(i => `<div class="disk-row"><span class="disk-label" style="min-width:130px">${ARCHIVE_KINDS[i.kind]}</span>
      <span class="disk-path"><b>${escHtml(i.title)}</b>${i.detail ? ` · ${escHtml(i.detail)}` : ''} · put away ${escHtml(new Date(i.archivedAt).toLocaleString())}</span>
      <span class="disk-free"><button class="btn btn-xs btn-blue" onclick="archiveSet(${jsArg(i.kind)}, ${jsArg(i.id)}, false)">Restore</button></span></div>`).join('')
      || '<div class="placeholder">Nothing archived.</div>'}</div>`;
}

/** Put one away, or bring it back; the page it lives on redraws (it is live: lib/live.js). */
async function archiveSet(kind, id, on) {
  try { await apiFetch(`/api/archive/${kind}/${encodeURIComponent(id)}`, { method: 'POST', body: { on } }); }
  catch (e) { return appAlert(e.message); }
  if (pageShown('archive')) archiveInit();
  if (kind === 'computer' && typeof computersLoad === 'function') computersLoad();
  if (kind === 'project' && on && typeof projectsInit === 'function') { if (typeof PJ !== 'undefined') PJ.inited = false; projectsInit(); }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-archive' });
  page.style.overflow = 'auto';
  document.getElementById('tab-settings')?.before(page);
});
