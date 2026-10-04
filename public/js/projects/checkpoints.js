/* ═══════════════════════════════════════════════════════
   Projects → Checkpoints: undo for agent runs (modules/projects/checkpoints.js).
   One is taken before each turn of the project's conversation, when files
   changed; take one by hand before trying something. Pick one to see what
   changed since, open a file's diff, or restore — which first takes a
   checkpoint of now, so a restore can be undone the same way.
   ═══════════════════════════════════════════════════════ */

const _pjc = p => `/api/projects/${encodeURIComponent(PJ.project.project.id)}/checkpoints${p}`;

async function pjCheckpointsRender(body) {
  body.innerHTML = '';
  const take = Object.assign(document.createElement('button'), { className: 'btn btn-sm btn-teal', textContent: '+ Checkpoint now' });
  take.onclick = pjCheckpointTake;
  body.append(take, Object.assign(document.createElement('div'), { className: 'pj-meta', style: 'white-space:normal;margin:4px 0',
    textContent: 'Taken before every turn of this project\'s conversation when files changed. Restore puts the files back; it can be undone.' }));
  let list = [];
  try { list = (await apiFetch(_pjc(''))).checkpoints; } catch (e) { body.appendChild(Object.assign(document.createElement('div'), { className: 'placeholder', textContent: e.message })); return; }
  if (!list.length) body.appendChild(Object.assign(document.createElement('div'), { className: 'placeholder', textContent: 'No checkpoints yet.' }));
  for (const c of list) {
    const row = document.createElement('div');
    row.className = 'pj-git-commit';
    row.title = `${c.id} · ${c.by}`;
    row.append(Object.assign(document.createElement('span'), { className: 'pj-git-hash', textContent: new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
      Object.assign(document.createElement('span'), { className: 'pj-git-subj', textContent: `${c.pinned ? '📌 ' : ''}${c.label}`, title: c.note || '' }),
      Object.assign(document.createElement('span'), { className: 'pj-meta', textContent: c.changedSincePrevious != null ? ` ${c.changedSincePrevious}Δ` : '' }));
    const box = document.createElement('div');
    row.onclick = () => (box.childElementCount ? (box.innerHTML = '') : _pjCheckpointOpen(c, box));
    body.append(row, box);
  }
}

async function _pjCheckpointOpen(c, box) {
  box.innerHTML = '<div class="placeholder pulse">Comparing with now…</div>';
  let changes;
  try { changes = (await apiFetch(_pjc(`/${c.id}/changes`))).changes; } catch (e) { box.textContent = e.message; return; }
  box.innerHTML = '';
  const restore = Object.assign(document.createElement('button'), { className: 'btn btn-xs btn-amber', textContent: '↶ Restore this' });
  restore.onclick = () => pjCheckpointRestore(c, changes.length);
  // Rename, note, pin, delete (asked 2026-10-04): DOCA's list changes, the snapshot does not.
  const btn = (text, title, fn, cls = '') => Object.assign(document.createElement('button'), { className: `btn btn-xs ${cls}`, textContent: text, title, onclick: fn });
  const tools = document.createElement('div');
  tools.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin:4px 0';
  tools.append(restore,
    btn('✎ Edit', 'Rename it and add a note', () => _pjCheckpointEdit(c, box)),
    btn(c.pinned ? '📌 Unpin' : '📌 Pin', c.pinned ? 'Let it go when it gets old' : 'Keep it however many newer ones are taken', () => _pjCheckpointPatch(c, { pinned: !c.pinned })),
    btn('🗑 Delete', 'Take it off the list (no file changes)', () => pjCheckpointDelete(c), 'btn-red'));
  box.append(...(c.note ? [Object.assign(document.createElement('div'), { className: 'pj-meta', textContent: c.note, style: 'white-space:pre-wrap;margin:4px 0' })] : []),
    Object.assign(document.createElement('div'), { className: 'pj-meta', textContent: changes.length ? `${changes.length} file(s) differ since then` : 'Nothing differs since then.' }), tools);
  for (const ch of changes) {
    const row = document.createElement('div');
    row.className = 'pj-git-file';
    const code = ch.status === 'A' ? 'n' : ch.status;
    row.append(Object.assign(document.createElement('span'), { className: `pj-git-code c-${code}`, textContent: ch.status === 'A' ? '+' : ch.status }),
      Object.assign(document.createElement('span'), { className: 'pj-git-path', textContent: ch.path }));
    row.title = ch.status === 'A' ? 'made since the checkpoint' : ch.status === 'D' ? 'deleted since' : 'changed since';
    row.onclick = async () => {
      const { diff } = await apiFetch(`${_pjc(`/${c.id}/diff`)}?file=${encodeURIComponent(ch.path)}`);
      const monaco = await _pjEditors();
      const key = `cpdiff:${c.id}:${ch.path}`;
      if (!PJE.tabs.some(t => t.key === key))
        PJE.tabs.push({ key, title: `↶ ${ch.path.split('/').pop()}`, path: null, model: monaco.editor.createModel(diff || '(no text difference)', 'diff'), saved: 0 });
      pjActivate(key);
    };
    box.appendChild(row);
  }
}

/** Inline form: label and note, saved with PATCH. */
function _pjCheckpointEdit(c, box) {
  box.querySelector('.pj-cp-edit')?.remove();
  const form = Object.assign(document.createElement('div'), { className: 'pj-cp-edit' });
  form.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:4px 0';
  const label = Object.assign(document.createElement('input'), { className: 'input', value: c.label, placeholder: 'Name' });
  const note = Object.assign(document.createElement('textarea'), { className: 'input', value: c.note || '', rows: 3, placeholder: 'A note: what this state was, why it matters' });
  const save = Object.assign(document.createElement('button'), { className: 'btn btn-xs btn-blue', textContent: 'Save' });
  save.onclick = () => _pjCheckpointPatch(c, { label: label.value, note: note.value });
  form.append(label, note, save);
  box.insertBefore(form, box.firstChild);
  label.focus();
}

async function _pjCheckpointPatch(c, changes) {
  try {
    await apiFetch(_pjc(`/${c.id}`), { method: 'PATCH', body: changes });
    setStatus(document.getElementById('pj-status'), '✓ Checkpoint updated', 'ok');
    pjView('checkpoints');
  } catch (e) { appAlert(e.message); }
}

function pjCheckpointDelete(c) {
  appConfirm(`Delete the checkpoint "${c.label}"? No file changes; it only comes off the list, and you can no longer go back to it.`, async () => {
    try {
      await apiFetch(_pjc(`/${c.id}`), { method: 'DELETE' });
      setStatus(document.getElementById('pj-status'), `✓ Deleted ${c.label}`, 'ok');
      pjView('checkpoints');
    } catch (e) { appAlert(e.message); }
  });
}

function pjCheckpointTake() {
  appPrompt('What is this moment? (e.g. before trying the new layout)', async label => {
    try {
      const { checkpoint } = await apiFetch(_pjc(''), { method: 'POST', body: { label: label || 'checkpoint' } });
      setStatus(document.getElementById('pj-status'), checkpoint.unchanged ? 'Nothing changed since the last checkpoint.' : `✓ Checkpoint ${checkpoint.id}`, 'ok');
      pjView('checkpoints');
    } catch (e) { appAlert(e.message); }
  }, '', { allowEmpty: true });
}

function pjCheckpointRestore(c, n) {
  if (PJE.tabs.some(_pjDirty))
    return appAlert('Save or close the files with unsaved changes first.');
  appConfirm(`Put the project back as it was at "${c.label}"? ${n} file(s) change. A checkpoint of now is taken first, so this can be undone.`, async () => {
    try {
      const r = await apiFetch(_pjc(`/${c.id}/restore`), { method: 'POST' });
      setStatus(document.getElementById('pj-status'), `✓ Restored: ${r.reverted} put back, ${r.removed} removed`, 'ok');
      pjEditorReset(); pjView('checkpoints'); pjRefresh();
    } catch (e) { appAlert(e.message); }
  });
}
