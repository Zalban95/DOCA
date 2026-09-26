/* ═══════════════════════════════════════════════════════
   Projects → Source control, in the VS Code manner: the branch, the changed
   files (click one to see its changes against the last commit, side by side),
   stage and unstage, a commit message and Commit; below, the history — click a
   commit to see what it changed, and a file's history (right-click in the
   tree) lets you compare the file with any earlier version of it.
   Nothing here pushes, resets or discards — those stay in a terminal.
   ═══════════════════════════════════════════════════════ */

const _pjg = p => `/api/projects/${encodeURIComponent(PJ.project.project.id)}/git${p}`;
const PJG_STATE = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', '?': 'new' };

async function pjGitRender(body) {
  if (!PJ.project.git) {
    body.innerHTML = '<div class="placeholder">Not a git repository. Run <code>git init</code> in the terminal to start one.</div>';
    return;
  }
  body.innerHTML = '<div class="placeholder pulse">Reading…</div>';
  let st, log, br;
  try { [st, { commits: log }, { branches: br }] = await Promise.all([apiFetch(_pjg('/status')), apiFetch(_pjg('/log?limit=60')), apiFetch(_pjg('/branches'))]); }
  catch (e) { body.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  body.innerHTML = '';

  const branch = document.createElement('div');
  branch.className = 'pj-git-branch';
  const sel = document.createElement('select');
  sel.className = 'input';
  sel.title = 'Switch branch';
  for (const b of br.filter(x => !x.name.startsWith('remotes/') && !x.name.includes('/HEAD'))) sel.appendChild(new Option(b.name, b.name, b.current, b.current));
  sel.onchange = () => pjGitSwitch(sel.value);
  branch.append('⎇ ', sel, Object.assign(document.createElement('span'), {
    className: 'pj-meta', textContent: `${st.upstream ? ` ${st.upstream}` : ''}${st.ahead ? ` ↑${st.ahead}` : ''}${st.behind ? ` ↓${st.behind}` : ''}` }));
  body.appendChild(branch);

  const msg = Object.assign(document.createElement('textarea'), { className: 'input', rows: 2, id: 'pjg-msg', placeholder: 'Commit message' });
  const commit = Object.assign(document.createElement('button'), { className: 'btn btn-sm btn-teal', textContent: '✓ Commit' });
  commit.onclick = pjGitCommit;
  body.append(msg, commit);

  const staged = st.files.filter(f => f.staged), changed = st.files.filter(f => f.unstaged);
  const group = (title, files, isStaged) => {
    const h = Object.assign(document.createElement('div'), { className: 'pj-res-file', textContent: `${title} (${files.length})` });
    body.appendChild(h);
    for (const f of files) {
      const code = isStaged ? f.staged : f.unstaged;
      const row = document.createElement('div');
      row.className = 'pj-git-file';
      row.title = `${PJG_STATE[code] || code} — click to see the changes`;
      row.append(Object.assign(document.createElement('span'), { className: `pj-git-code c-${code === '?' ? 'n' : code}`, textContent: code }),
        Object.assign(document.createElement('span'), { className: 'pj-git-path', textContent: f.path }));
      const b = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: isStaged ? '−' : '+', title: isStaged ? 'Unstage' : 'Stage' });
      b.onclick = e => { e.stopPropagation(); pjGitStage([f.path], !isStaged); };
      row.appendChild(b);
      row.onclick = () => pjCompareHead(pjAbs(f.path), code === 'D');
      body.appendChild(row);
    }
    if (files.length > 1) {
      const all = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: isStaged ? 'Unstage all' : 'Stage all' });
      all.onclick = () => pjGitStage(files.map(f => f.path), !isStaged);
      body.appendChild(all);
    }
  };
  if (staged.length) group('Staged', staged, true);
  group('Changes', changed, false);

  body.appendChild(Object.assign(document.createElement('div'), { className: 'pj-res-file', textContent: 'History' }));
  for (const c of log) {
    const row = document.createElement('div');
    row.className = 'pj-git-commit';
    row.title = `${c.hash}\n${c.author} · ${c.date}`;
    row.append(Object.assign(document.createElement('span'), { className: 'pj-git-hash', textContent: c.short }),
      Object.assign(document.createElement('span'), { className: 'pj-git-subj', textContent: c.subject }),
      Object.assign(document.createElement('span'), { className: 'pj-meta', textContent: ` ${c.date.slice(0, 10)}${c.refs.length ? ` · ${c.refs.join(', ')}` : ''}` }));
    row.onclick = () => pjShowCommit(c);
    body.appendChild(row);
  }
}

/** A file against its last commit (or against an earlier version: `rev`). */
async function pjCompareHead(abs, deleted = false, rev = 'HEAD') {
  const rel = pjRel(abs);
  const r = await apiFetch(`${_pjg('/show')}?file=${encodeURIComponent(rel)}&rev=${encodeURIComponent(rev)}`);
  const title = `${rel} (${rev === 'HEAD' ? 'last commit' : rev.slice(0, 7)} ↔ ${deleted ? 'deleted' : 'now'})`;
  // A deleted file has nothing on disk to open: compare with empty. A new one has no earlier version: r.text is ''.
  pjCompare(deleted ? { title, originalText: r.text, modifiedText: '', lang: undefined } : { title, originalText: r.text, modifiedPath: abs });
}

/** A commit's changes, as the unified diff it is, read-only. */
async function pjShowCommit(c) {
  const { diff } = await apiFetch(`${_pjg('/diff')}?commit=${encodeURIComponent(c.hash)}`);
  const monaco = await _pjEditors();
  const key = `commit:${c.hash}`;
  if (!PJE.tabs.some(t => t.key === key)) {
    PJE.tabs.push({ key, title: `${c.short} ${c.subject.slice(0, 30)}`, path: null,
      model: monaco.editor.createModel(`${c.hash}\n${c.author} · ${c.date}\n${c.subject}\n\n${diff}`, 'diff'), saved: 0 });
  }
  pjActivate(key);
}

/** A file's history; choosing a version compares it with the file as it is now. */
async function pjFileHistory(abs) {
  const rel = pjRel(abs);
  const { commits } = await apiFetch(`${_pjg('/log')}?file=${encodeURIComponent(rel)}&limit=40`);
  if (!commits.length) return appAlert(`${rel} has no committed history yet.`);
  appChoose(`History of ${rel} — compare the file as it is now with:`,
    [{ label: 'Cancel', value: null }, ...commits.slice(0, 8).map(c => ({ label: `${c.short} ${c.date.slice(0, 10)} ${c.subject.slice(0, 40)}`, value: c.hash }))],
    hash => hash && pjCompareHead(abs, false, hash));
}

async function pjGitStage(files, stage) {
  try { await apiFetch(_pjg(stage ? '/stage' : '/unstage'), { method: 'POST', body: { files } }); }
  catch (e) { return appAlert(e.message); }
  pjView('git'); pjRefresh();
}

async function pjGitCommit() {
  const message = document.getElementById('pjg-msg')?.value.trim();
  if (!message) return setStatus(document.getElementById('pj-status'), 'Write a commit message first.', 'warn');
  try {
    const st = await apiFetch(_pjg('/status'));
    if (!st.files.length) return setStatus(document.getElementById('pj-status'), 'Nothing to commit.', 'info');
    const files = st.files.some(f => f.staged) ? undefined : st.files.map(f => f.path);   // nothing staged: commit every change
    const { commit } = await apiFetch(_pjg('/commit'), { method: 'POST', body: { message, files } });
    setStatus(document.getElementById('pj-status'), `✓ Committed ${commit.short}: ${commit.subject}`, 'ok');
  } catch (e) { return appAlert(e.message); }
  pjView('git'); pjRefresh();
}

async function pjGitSwitch(branch) {
  if (PJE.tabs.some(t => t.path && t.model.getAlternativeVersionId() !== t.saved))
    return appAlert('Save or close the files with unsaved changes before switching branch.');
  try { await apiFetch(_pjg('/switch'), { method: 'POST', body: { branch } }); }
  catch (e) { appAlert(e.message); }
  pjEditorReset(); pjView('git'); pjRefresh();
}
