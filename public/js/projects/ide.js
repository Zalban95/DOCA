/* ═══════════════════════════════════════════════════════
   The Projects tab: a folder worked on like an IDE.

   Left, the views (Files, Search, Git, Run) in an activity bar like VS Code's;
   centre, editor tabs (Monaco — the editor VS Code is built on — with its own
   find/replace, multi-cursor, go to line, command palette on F1, and its diff
   view for every comparison); right, the project's conversation. Every view
   calls the same operations the agent's tools do (modules/projects), so what
   you see and what the agent does cannot drift apart.

   Files under public/js/projects/: ide.js (this: the frame, the project, the views),
   editor.js, preview.js, md-doc.js, search.js, git.js, run.js, env.js, lsp.js,
   checkpoints.js, chat.js, teams.js (Teams here), params.js (Parameters), sharing.js
   (who has it) (the file tree is in ide.js itself). A person without host sees their own
   projects and those shared with them: the Parameters and the chat, never the files.
   ═══════════════════════════════════════════════════════ */

const PJ = {
  project: null,      // /api/projects/:id — { project, kinds, commands, toolchains, git }
  view: 'files',
  inited: false,
};

const PJ_VIEWS = [
  { id: 'files',  icon: '🗀', label: 'Files' },
  { id: 'search', icon: '⌕', label: 'Search' },
  { id: 'git',    icon: '⎇', label: 'Source control' },
  { id: 'run',    icon: '▶', label: 'Build & test' },
  { id: 'checkpoints', icon: '↶', label: 'Checkpoints' },
  { id: 'params', icon: '⚙', label: 'Parameters', person: true },
];
/** The machine's views (files, git, commands) are a host's; anyone else gets the ones marked `person`. */
const _pjHost = () => (PJ.project ? PJ.project.yours === 'host' : !(typeof _settingsNoHost !== 'undefined' && _settingsNoHost));
const _pjViews = () => PJ_VIEWS.filter(v => v.person || _pjHost());

function _pjFrame() {
  const page = document.getElementById('tab-projects');
  if (!page || page.dataset.built) return page;
  page.dataset.built = '1';
  page.innerHTML = `
    <div class="pj-top info-row${_pjHost() ? '' : ' pj-person'}">
      <select class="input pj-picker" id="pj-picker" onchange="pjOpen(this.value)" title="Project" aria-label="Project"></select>${infoBtn('The project on screen. A project is a folder on this machine; choosing another opens it here with its own files, history and conversations.')}
      <button class="btn btn-sm pj-host-only" onclick="pjNew()" title="Open a folder as a project">+ Open folder</button>
      <button class="btn btn-sm pj-person-only" onclick="pjNewOwn()" title="A new project in a folder of your own">+ New project</button>
      <button class="btn btn-sm pj-host-only" onclick="PJ.project && archiveSet('project', PJ.project.project.id, true)" title="Put this project away (its folder is untouched); back from Agents → Archive">🗄</button>
      <button class="btn btn-sm" onclick="pjShareOpen()" title="Who has this project: its owner, who may see it or work on it, and who set what">👥</button>
      <span class="pj-meta" id="pj-meta"></span>
      <span class="pj-spacer"></span>
      <button class="btn btn-sm" id="pj-chat-toggle" onclick="pjChatToggle()" title="The project's conversation">⬡ Chat</button>
    </div>
    <div class="pj-body" id="pj-body">
      <nav class="pj-activity" id="pj-activity">${PJ_VIEWS.map(v =>
        `<button class="pj-act" data-view="${v.id}" title="${v.label}" onclick="pjView('${v.id}', true)">${v.icon}</button>`).join('')}</nav>
      <aside class="pj-side" id="pj-side">
        <div class="pj-side-title" id="pj-side-title"></div>
        <div class="pj-side-body" id="pj-side-body"></div>
        <div class="pj-teams" id="pj-teams"></div><div class="pj-teams" id="pj-team-branches"></div>
      </aside>
      <section class="pj-main">
        <div class="pj-tabs" id="pj-tabs"></div>
        <div class="pj-editor" id="pj-editor"><div class="placeholder pj-empty">Open a file from the tree, or search.</div></div>
        <div class="pj-status" id="pj-status"></div>
      </section>
      <aside class="pj-chat" id="pj-chat"></aside>
    </div>
    <div class="pj-none" id="pj-none" style="display:none">${emptyStateHtml({ title: 'No projects yet',
      text: `A project is a folder: ${BRAND?.product || 'the hub'} reads what it is, how it builds and tests, and its git history.`, action: _pjHost() ? { label: 'Open a folder', onclick: 'pjNew()' } : { label: 'New project', onclick: 'pjNewOwn()' } })}</div>`;
  return page;
}

/** Nav → Projects. */
async function projectsInit() {
  _pjFrame();
  let list = [];
  try { list = (await apiFetch('/api/projects')).projects || []; } catch (e) { setStatus(document.getElementById('pj-status'), `✗ ${e.message}`, 'err'); }
  const picker = document.getElementById('pj-picker');
  picker.innerHTML = list.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}${p.yours === 'see' ? ' (shared to see)' : p.yours === 'work' ? ' (shared)' : ''}</option>`).join('');
  document.getElementById('pj-body').style.display = list.length ? '' : 'none';
  document.getElementById('pj-none').style.display = list.length ? 'none' : '';
  document.querySelector('#tab-projects .pj-top')?.classList.toggle('pj-top-none', !list.length);   // no picker until a project exists (des 10)
  _pjActivity();
  if (!list.length) return;
  const want = PJ.project?.project.id && list.some(p => p.id === PJ.project.project.id) ? PJ.project.project.id : list[0].id;
  picker.value = want;
  if (!PJ.project || PJ.project.project.id !== want) await pjOpen(want);
}

async function pjOpen(id) {
  if (PJ.project && PJ.project.project.id !== id && PJE.tabs.some(_pjDirty)) {
    document.getElementById('pj-picker').value = PJ.project.project.id;
    return appAlert('Save or close the files with unsaved changes before opening another project.');
  }
  try { PJ.project = await apiFetch(`/api/projects/${encodeURIComponent(id)}`); }
  catch (e) { return appAlert(`Could not open the project: ${e.message}`); }
  // The old project's chat turn and followed job stop here: they streamed into the new one's panes, and
  // a busy flag left set made the new Send do nothing (audit 2026-10-04).
  pjChatReset();
  clearTimeout(PJR.timer);
  pjEditorReset();
  _pjMeta();
  _pjActivity();
  pjView(_pjViews().some(v => v.id === PJ.view) ? PJ.view : _pjViews()[0].id);
  if (_pjHost()) { pjTeamsLoad(); pjTeamBranchesLoad(); }   // Teams here and their branches (projects/teams.js, team-branches.js)
  if (document.getElementById('pj-chat').classList.contains('open')) pjChatLoad();
}

/** Refresh what the header says (branch, kinds) without reopening. */
async function pjRefresh() {
  if (!PJ.project) return;
  try { PJ.project = await apiFetch(`/api/projects/${encodeURIComponent(PJ.project.project.id)}`); } catch { return; }
  _pjMeta();
}

function _pjMeta() {
  const d = PJ.project;
  const g = d.git;
  document.getElementById('pj-meta').textContent = [
    d.project.root,
    d.kinds.map(k => k.label).join(' · ') || 'no build system recognised',
    g ? `⎇ ${g.branch}${g.files.length ? ` · ${g.files.length} changed` : ''}${g.ahead ? ` · ↑${g.ahead}` : ''}${g.behind ? ` · ↓${g.behind}` : ''}` : 'not a git repository',
  ].join('   ·   ');
}

/** Show a side view. `tapped`: from its icon — on a phone that opens the drawer, and a second tap closes it. */
function pjView(id, tapped = false) {
  const body = document.getElementById('pj-body');
  if (tapped && window.innerWidth <= 768) body.classList.toggle('side-open', !(body.classList.contains('side-open') && PJ.view === id));
  PJ.view = id;
  document.querySelectorAll('#pj-activity .pj-act').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  document.getElementById('pj-side-title').textContent = PJ_VIEWS.find(v => v.id === id)?.label || '';
  const side = document.getElementById('pj-side-body');
  side.innerHTML = '';
  if (!PJ.project) return;
  ({ files: pjTreeRender, search: pjSearchRender, git: pjGitRender, run: pjRunRender, checkpoints: pjCheckpointsRender, params: pjParamsRender })[id]?.(side);
}

/** Which views this person has here, and the header's buttons: a host's or a person's. */
function _pjActivity() {
  const host = _pjHost();
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };   // a .btn's display wins over [hidden]
  document.querySelectorAll('#pj-activity .pj-act').forEach(b => show(b, _pjViews().some(v => v.id === b.dataset.view)));
  document.querySelectorAll('#tab-projects .pj-host-only, #pj-teams, #pj-team-branches').forEach(b => show(b, host));
  document.querySelectorAll('#tab-projects .pj-person-only').forEach(b => show(b, !host));
}

/** + New project (a person without host): named, made in a folder of their own (projects/store.js ownFolder). */
function pjNewOwn() {
  appPrompt('Name the new project', async name => {
    if (!name?.trim()) return;
    try {
      const { project } = await apiFetch('/api/projects', { method: 'POST', body: { name: name.trim() } });
      PJ.project = null;
      await projectsInit();
      document.getElementById('pj-picker').value = project.id;
      await pjOpen(project.id);
    } catch (e) { appAlert(e.message); }
  });
}

/** + Open folder: chosen from a tree (fp.js), the path still typeable below it; a project put away comes back. */
async function pjNew() {
  const root = await fpPick({ mode: 'dir', title: 'Open a folder as a project', start: PJ.project?.project.root.replace(/[^/\\]+$/, '') || '' });
  if (!root) return;
  try {
    const { project } = await apiFetch('/api/projects', { method: 'POST', body: { root } });
    PJ.project = null;
    await projectsInit();
    document.getElementById('pj-picker').value = project.id;
    await pjOpen(project.id);
    if (project.restored) undoToast(`“${project.name}” was in the Archive — it is back, as it was.`);
  } catch (e) { appAlert(e.message); }
}

/** A path relative to the project root, for display. */
function pjRel(abs) {
  const root = PJ.project?.project.root || '';
  return abs.startsWith(root) ? abs.slice(root.length).replace(/^[/\\]/, '') : abs;
}
function pjAbs(rel) {
  const root = PJ.project.project.root;
  return rel.startsWith('/') || /^[A-Za-z]:\\/.test(rel) ? rel : `${root}/${rel}`;
}

/* ── Files: the shared tree (lib/filetree.js), rooted at the project ── */
const PJT = { compareFrom: null };

function pjTreeRender(body) {
  fileTree(body, { root: PJ.project.project.root, onOpen: pjOpenFile, extraMenu: (abs, isDir) => (isDir ? [] : _pjFileMenu(abs)) });
}

/** What a project file offers besides the tree's own: comparisons and its history. */
function _pjFileMenu(abs) {
  const rel = pjRel(abs);
  return [
    PJ.project.git ? { label: '⇄ Compare with last commit', fn: () => pjCompareHead(abs) } : null,
    PJ.project.git ? { label: '🕘 History', fn: () => pjFileHistory(abs) } : null,
    PJT.compareFrom && PJT.compareFrom !== abs
      ? { label: `⇄ Compare with ${pjRel(PJT.compareFrom)}`, fn: () => pjCompare({ title: `${pjRel(PJT.compareFrom)} ↔ ${rel}`, originalPath: PJT.compareFrom, modifiedPath: abs }) } : null,
    { label: '◎ Select for compare', fn: () => { PJT.compareFrom = abs; setStatus(document.getElementById('pj-status'), `Selected ${rel} — right-click another file to compare`, 'info'); } },
  ].filter(Boolean);
}
