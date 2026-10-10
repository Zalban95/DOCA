/* Agents → Workstream → the folders watched (asked 2026-10-10: the work that evening was in the repositories beside the
   install, edited by agents outside DOCA, and the Workstream watched only DOCA's projects and the workspace). A tap on
   "watching N folders" lists each with where it comes from — a project, a conversation's worktree, the workspace, a
   folder an agent wrote in, or the setting `workstream.roots` (by default "..", the folder DOCA is installed in) — and
   adds or removes the setting's own. Saved through POST /api/prefs, then held again so the sentinel watches them. */
const WS_FROM = { project: 'a project', worktree: 'a conversation\'s worktree', workspace: 'the agents\' workspace', setting: 'you added it', agent: 'an agent wrote here' };

function workstreamFolders(open) {
  const box = document.getElementById('ws-folders');
  if (!box) return;
  box.hidden = open === undefined ? !box.hidden : !open;
  if (!box.hidden) _wsfLoad();
}

async function _wsfLoad() {
  try { const p = await apiFetch('/api/prefs'); WS.rootsSetting = Array.isArray(p?.workstream?.roots) ? p.workstream.roots : null; } catch { WS.rootsSetting = null; }
  workstreamFoldersDraw();
}

function workstreamFoldersDraw() {
  const box = document.getElementById('ws-folders');
  if (!box || box.hidden) return;
  const where = WS.sentinel?.where || [];
  const setting = WS.rootsSetting || ['..'];
  box.innerHTML = `<div class="ws-f-head"><b>Watched folders</b><span class="desc">Edits here show as they happen, whoever makes them. Build output, dependencies and .git are skipped.</span>
      <button class="btn btn-xs" onclick="workstreamFolders(false)" aria-label="Close">✕</button></div>
    ${where.map(r => `<div class="ws-f-row"><span class="ws-f-path" title="${escHtml(r.path)}">${escHtml(r.name ? `${r.name} — ${r.path}` : r.path)}</span><span class="ws-f-from">${escHtml(r.wide ? 'where it is installed' : WS_FROM[r.from] || r.from)}</span></div>`).join('') || '<div class="placeholder">Nothing watched yet.</div>'}
    <div class="ws-f-sub">Your folders <span class="desc">(a relative one is read against the install: ".." is the folder it is installed in)</span></div>
    ${setting.map((e, i) => `<div class="ws-f-row"><span class="ws-f-path">${escHtml(e)}</span><button class="btn btn-xs" onclick="_wsfRemove(${i})" title="Stop watching it">Remove</button></div>`).join('') || '<div class="placeholder">None.</div>'}
    <div class="ws-f-add"><input class="input flex1" id="ws-f-new" data-path-pick="dir" placeholder="/path/to/folder" onkeydown="if(event.key==='Enter')_wsfAdd()"><button class="btn btn-xs btn-primary" onclick="_wsfAdd()">Watch</button></div>`;
}

async function _wsfSave(list) {
  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { workstream: { roots: list } } });
    WS.rootsSetting = list;
    await _wsHold(true);
  } catch (e) { appAlert(`Could not save: ${e.message}`); }
}

function _wsfAdd() {
  const v = document.getElementById('ws-f-new')?.value.trim();
  if (!v) return;
  const list = [...(WS.rootsSetting || ['..'])];
  if (!list.includes(v)) list.push(v);
  _wsfSave(list);
}

function _wsfRemove(i) {
  const list = [...(WS.rootsSetting || ['..'])];
  list.splice(i, 1);
  _wsfSave(list);
}
