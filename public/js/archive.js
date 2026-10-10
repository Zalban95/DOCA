/* Agents → Archive (modules/archive.js): conversations, missions, projects, the agents' computers and signed-in browsers
   nobody opened for a week (screens/archive.js) that were put away rather than deleted — newest first, each restored
   with one click. A computer comes back stopped, with its desktop, logins and files as they were; a browser signs in again.
   Its page is made here: index.html is at its line ceiling. */
const ARCHIVE_KINDS = { conversation: '💬 Conversation', mission: '⬡ Mission', team: '⬢ Team', project: '⟨⟩ Project', computer: '🖵 Computer', device: '▭ Browser' };

/** What the Undo toast says once each kind is put away. */
const ARCHIVE_PUT = {
  project: p => `Project ${p?.name ? `“${p.name}” ` : ''}put away — its folder${p?.root ? ` ${p.root}` : ''} is untouched.`,
  conversation: () => 'Conversation put away — its transcript is kept.',
  mission: () => 'Mission put away — its log is kept.',
  computer: () => 'Computer put away — stopped, its desktop and files kept.',
  device: () => 'Browser put away — it signs in again once restored.',
};

async function archiveInit() {
  const page = document.getElementById('tab-archive');
  if (!page) return;
  page.innerHTML = '<div class="card"><div class="placeholder pulse">Loading…</div></div>';
  let items;
  try { items = (await apiFetch('/api/archive')).items; } catch (e) { page.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const filter = page.dataset.filter || '';
  const shown = items.filter(i => !filter || i.kind === filter);
  // One page header (des 9), then the list in a card; nothing put away is the one empty state (des 10).
  page.innerHTML = pageHeadHtml({ title: 'Archive', sub: 'What was put away rather than deleted — restore brings it back as it was.',
    actions: `<select class="input" style="width:auto" aria-label="Show" onchange="document.getElementById('tab-archive').dataset.filter=this.value;archiveInit()">
        <option value="">everything (${items.length})</option>${Object.entries(ARCHIVE_KINDS).map(([k, l]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${l}s (${items.filter(i => i.kind === k).length})</option>`).join('')}</select>` })
    + (shown.length ? '<div class="card">' : '')
    + `${shown.map(i => `<div class="disk-row row3"><span class="disk-label" style="min-width:130px">${ARCHIVE_KINDS[i.kind]}</span>
      <span class="disk-path"><b>${escHtml(i.title)}</b>${i.detail ? ` · ${escHtml(i.detail)}` : ''} · put away ${escHtml(new Date(i.archivedAt).toLocaleString())}</span>
      <span class="disk-free"><button class="btn btn-xs btn-blue" onclick="archiveSet(${jsArg(i.kind)}, ${jsArg(i.id)}, false)">Restore</button></span></div>`).join('')
      || emptyStateHtml({ title: 'Nothing archived', text: 'Conversations, missions, projects, computers and browsers put away land here, ready to come back.' })}${shown.length ? '</div>' : ''}`;
}

/** Put one away, or bring it back; the page it lives on redraws (it is live: lib/live.js). */
async function archiveSet(kind, id, on, asked) {
  // Putting a computer away stops it: asked like any stop, naming what uses it (lib/machine-ask.js).
  if (kind === 'computer' && on && !asked) return machineAsk('computer', id, 'stop', '', () => archiveSet(kind, id, on, true), 'It is put away: stopped, its desktop and files kept, back from Agents → Archive.');
  let r;
  try { r = await apiFetch(`/api/archive/${kind}/${encodeURIComponent(id)}`, { method: 'POST', body: { on } }); }
  catch (e) { return appAlert(e.message); }
  // Put away at once, with ten seconds to change one's mind and the Archive as the way back after (lib/undo.js).
  if (on) undoToast(ARCHIVE_PUT[kind]?.(r?.item) || 'Put away.', () => archiveSet(kind, id, false),
    { link: { label: 'Archive', onclick: () => nav('archive') } });
  if (pageShown('archive')) archiveInit();
  if (kind === 'computer' && typeof computersLoad === 'function') computersLoad();
  if (kind === 'device' && typeof devicesLoad === 'function') devicesLoad();
  if (kind === 'project' && typeof projectsInit === 'function') { if (typeof PJ !== 'undefined') PJ.inited = false; projectsInit(); }
  if (kind === 'conversation' && typeof _hcLoadSessions === 'function') _hcLoadSessions().catch(() => {});
  if (kind === 'mission' && typeof _hcLoadMissions === 'function') _hcLoadMissions();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-archive' });
  page.style.overflow = 'auto';
  document.getElementById('tab-settings')?.before(page);
});
