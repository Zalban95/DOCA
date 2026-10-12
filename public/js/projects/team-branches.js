/* ═══════════════════════════════════════════════════════
   Projects → Team branches (harness-teams/branches.js; asked 2026-10-12): every team/… branch of the project open now —
   an outside harness's worker (Claude Code, Codex, dsh … working in its own computer) or a specialist's worktree on a
   team — with who made it, what it adds over the current branch (commits, files, +/−), its diff in an editor tab, and
   Merge: an ordinary git merge into the current branch, the person's click (refused with uncommitted changes; a
   conflict is undone and its files named). Read from git, redrawn on the live feed's `projects` and `missions` changes.
   ═══════════════════════════════════════════════════════ */

const PJTB = { rows: [], current: '', project: null, stopLive: null };

async function pjTeamBranchesLoad() {
  const id = PJ.project?.project.id;
  const box = document.getElementById('pj-team-branches');
  if (!id || !box) return;
  if (PJTB.project !== id) { PJTB.project = id; PJTB.rows = []; }
  try { const r = await apiFetch(`/api/projects/${encodeURIComponent(id)}/team-branches`); PJTB.rows = r.branches || []; PJTB.current = r.current || ''; }
  catch { PJTB.rows = []; }
  if (PJTB.project !== id) return;
  pjTeamBranchesRender();
  if (!PJTB.stopLive && typeof liveOn === 'function') {
    const again = liveDebounce(() => { if (typeof pageShown === 'function' && pageShown('projects')) pjTeamBranchesLoad(); }, 800);
    PJTB.stopLive = [liveOn('projects', again), liveOn('missions', again)];
  }
}

function _pjTbRow(b) {
  const who = b.by ? `${escHtml(b.by.label)}${b.by.task ? ` · task ${escHtml(b.by.task)}` : ''}${b.by.state && !['done', 'failed', 'cancelled'].includes(b.by.state) ? ' · working' : ''}` : 'a team';
  const pt = b.by && ['starting', 'running'].includes(b.by.state) ? 'pt pt-up pt-run' : b.merged ? 'pt pt-done' : 'pt pt-ask';
  return `<div class="pj-tb-row">
      <div class="pj-tb-head"><span class="${pt}"></span><code title="${escHtml(b.branch)}">${escHtml(b.branch.replace(/^team\//, ''))}</code></div>
      <div class="pj-tb-meta">${who} — ${b.merged ? `merged into ${escHtml(PJTB.current)}` : `${b.ahead} commit${b.ahead === 1 ? '' : 's'} ahead${b.stat ? ` · ${escHtml(b.stat.replace(/ changed|\(.\)/g, ''))}` : ''}`}</div>
      <div class="pj-tb-subj" title="${escHtml(b.subject || '')}">${escHtml(b.subject || '')}</div>
      <div class="pj-tb-acts">
        <button class="btn btn-xs" onclick="pjTeamBranchDiff(${jsArg(b.branch)})" ${b.ahead ? '' : 'disabled'}>Diff</button>
        <button class="btn btn-xs btn-primary" onclick="pjTeamBranchMerge(${jsArg(b.branch)})" ${b.ahead && !(b.by && ['starting', 'running'].includes(b.by.state)) ? '' : 'disabled'}
          title="git merge --no-ff into ${escHtml(PJTB.current)}">Merge</button>
      </div>
    </div>`;
}

function pjTeamBranchesRender() {
  const box = document.getElementById('pj-team-branches');
  if (!box) return;
  const rows = PJTB.rows, open = rows.filter(b => !b.merged).length;
  let shown = rows.length > 0;
  if (shown) try { shown = localStorage.getItem('doca.fold.pj-team-branches') !== '0'; } catch { /* storage off */ }
  box.innerHTML = `<details class="pj-teams-fold"${shown ? ' open' : ''}>
      <summary title="Branches a team's members made: an outside harness in its own computer, or a specialist's worktree">Team branches <span class="pj-teams-count">${rows.length ? `${open} to merge${rows.length > open ? ` · ${rows.length - open} merged` : ''}` : 'none'}</span></summary>
      <div class="pj-teams-body">${rows.map(_pjTbRow).join('') || '<p class="desc">No team has made a branch here yet. Ask for one in the chat — "have five Claude Code on Opus work on this" — and their branches show here.</p>'}</div>
    </details>`;
  box.querySelector('details').addEventListener('toggle', e => {
    if (!rows.length) return;
    try { localStorage.setItem('doca.fold.pj-team-branches', e.target.open ? '1' : '0'); } catch { /* storage off */ }
  });
}

/** The branch's changes over the current branch, read-only in an editor tab. */
async function pjTeamBranchDiff(branch) {
  const id = PJ.project?.project.id;
  try {
    const r = await apiFetch(`/api/projects/${encodeURIComponent(id)}/team-branches/diff?branch=${encodeURIComponent(branch)}`);
    const monaco = await _pjEditors();
    const key = `branch:${branch}`;
    const head = `${branch} over ${PJTB.current}\n${r.files.map(f => `  ${f.path}  +${f.added ?? '?'} −${f.removed ?? '?'}`).join('\n')}\n\n`;
    const old = PJE.tabs.find(t => t.key === key);
    if (old) old.model.setValue(head + r.diff);
    else PJE.tabs.push({ key, title: `⑂ ${branch.replace(/^team\//, '')}`.slice(0, 40), path: null, model: monaco.editor.createModel(head + r.diff, 'diff'), saved: 0 });
    pjActivate(key);
  } catch (e) { appAlert(`Could not read ${branch}: ${e.message}`); }
}

function pjTeamBranchMerge(branch) {
  const id = PJ.project?.project.id;
  appConfirm(`Merge ${branch} into ${PJTB.current}? An ordinary git merge in the project's folder — if it conflicts, nothing is merged and the files are named.`, async () => {
    try {
      const r = await apiFetch(`/api/projects/${encodeURIComponent(id)}/team-branches/merge`, { method: 'POST', body: { branch } });
      appAlert(`Merged ${branch} into ${r.into}: ${r.head}`);
    } catch (e) { appAlert(e.message); }
    pjTeamBranchesLoad();
    if (typeof pjRefresh === 'function') pjRefresh();
  });
}
