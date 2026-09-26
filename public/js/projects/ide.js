/* ═══════════════════════════════════════════════════════
   The Projects tab: a folder worked on like an IDE.

   Left, the views (Files, Search, Git, Run) in an activity bar like VS Code's;
   centre, editor tabs (Monaco — the editor VS Code is built on — with its own
   find/replace, multi-cursor, go to line, command palette on F1, and its diff
   view for every comparison); right, the project's conversation. Every view
   calls the same operations the agent's tools do (modules/projects), so what
   you see and what the agent does cannot drift apart.

   Files: ide.js (this: the frame, the project, the views), editor.js, tree.js,
   search.js, git.js, run.js, chat.js — under public/js/projects/.
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
];

function _pjFrame() {
  const page = document.getElementById('tab-projects');
  if (!page || page.dataset.built) return page;
  page.dataset.built = '1';
  page.innerHTML = `
    <div class="pj-top">
      <select class="input pj-picker" id="pj-picker" onchange="pjOpen(this.value)" title="Project"></select>
      <button class="btn btn-sm" onclick="pjNew()" title="Open a folder as a project">+ Open folder</button>
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
      </aside>
      <section class="pj-main">
        <div class="pj-tabs" id="pj-tabs"></div>
        <div class="pj-editor" id="pj-editor"><div class="placeholder pj-empty">Open a file from the tree, or search.</div></div>
        <div class="pj-status" id="pj-status"></div>
      </section>
      <aside class="pj-chat" id="pj-chat"></aside>
    </div>
    <div class="pj-none" id="pj-none" style="display:none">
      <p>No projects yet. A project is a folder: DOCA reads what it is, how it builds and tests, and its git history.</p>
      <button class="btn btn-teal" onclick="pjNew()">+ Open a folder</button>
    </div>`;
  return page;
}

/** Nav → Projects. */
async function projectsInit() {
  _pjFrame();
  let list = [];
  try { list = (await apiFetch('/api/projects')).projects || []; } catch (e) { setStatus(document.getElementById('pj-status'), `✗ ${e.message}`, 'err'); }
  const picker = document.getElementById('pj-picker');
  picker.innerHTML = list.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
  document.getElementById('pj-body').style.display = list.length ? '' : 'none';
  document.getElementById('pj-none').style.display = list.length ? 'none' : '';
  if (!list.length) return;
  const want = PJ.project?.project.id && list.some(p => p.id === PJ.project.project.id) ? PJ.project.project.id : list[0].id;
  picker.value = want;
  if (!PJ.project || PJ.project.project.id !== want) await pjOpen(want);
}

async function pjOpen(id) {
  if (PJ.project && PJ.project.project.id !== id && PJE.tabs.some(t => t.path && t.model.getAlternativeVersionId() !== t.saved)) {
    document.getElementById('pj-picker').value = PJ.project.project.id;
    return appAlert('Save or close the files with unsaved changes before opening another project.');
  }
  try { PJ.project = await apiFetch(`/api/projects/${encodeURIComponent(id)}`); }
  catch (e) { return appAlert(`Could not open the project: ${e.message}`); }
  pjEditorReset();
  _pjMeta();
  pjView(PJ.view);
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
  ({ files: pjTreeRender, search: pjSearchRender, git: pjGitRender, run: pjRunRender })[id]?.(side);
}

function pjNew() {
  appPrompt('Folder to open as a project (absolute path):', async root => {
    try {
      const { project } = await apiFetch('/api/projects', { method: 'POST', body: { root } });
      PJ.project = null;
      await projectsInit();
      document.getElementById('pj-picker').value = project.id;
      await pjOpen(project.id);
    } catch (e) { appAlert(e.message); }
  }, PJ.project?.project.root.replace(/[^/\\]+$/, '') || '');
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
