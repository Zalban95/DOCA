/* ═══════════════════════════════════════════════════════
   Projects → 👥 Who has it (modules/projects/access.js): the project's owner,
   who it is shared with — to see, or to work on (change its parameters,
   build it, chat in it) — and who set what, when. Its owner or an admin
   shares it (people are chosen like a mail's To: line, lib/people-pick.js);
   an admin also hands it to a new owner. Taking someone off asks first.
   ═══════════════════════════════════════════════════════ */

const PJSH = { pick: null };

const _pjsWhat = a => ({
  created: 'made it',
  shared: `shared it with ${a.person?.name || '?'} to ${a.to === 'work' ? 'work on' : 'see'}${a.from ? ` (was ${a.from === 'work' ? 'work on' : 'see'})` : ''}`,
  unshared: `stopped sharing it with ${a.person?.name || '?'}`,
  owner: `gave it to ${a.to?.name || '?'}${a.from ? ` (from ${a.from.name})` : ''}`,
})[a.what] || a.what;

async function pjShareOpen() {
  if (!PJ.project) return;
  const id = PJ.project.project.id;
  let v;
  try { v = await apiFetch(`/api/projects/${encodeURIComponent(id)}/sharing`); } catch (e) { return appAlert(e.message); }
  document.querySelector('.pjs-ov')?.remove();
  const ov = Object.assign(document.createElement('div'), { className: 'modal-overlay pjs-ov' });
  const right = s => `<select class="input pjs-right" data-person="${escHtml(s.id)}"${v.manage ? '' : ' disabled'}><option value="see"${s.right === 'see' ? ' selected' : ''}>can see</option><option value="work"${s.right === 'work' ? ' selected' : ''}>can work on</option></select>`;
  ov.innerHTML = `<div class="modal pjs" role="dialog" aria-label="Who has ${escHtml(PJ.project.project.name)}">
    <div class="modal-title">Who has ${escHtml(PJ.project.project.name)}</div>
    <div class="desc">Owner: <b>${escHtml(v.owner?.name || 'the hub (made before projects had owners — admins only)')}</b>. You ${v.yours === 'host' ? 'see every project, as an admin' : v.yours === 'owner' ? 'own it' : v.yours === 'work' ? 'can work on it' : 'can see it'}.</div>
    <div class="pjs-list">${v.shares.length ? v.shares.map(s => `<div class="pjs-row"><span>${escHtml(s.name)}</span>${right(s)}${v.manage ? `<button class="btn btn-xs" data-unshare="${escHtml(s.id)}" title="Stop sharing">✕</button>` : ''}</div>`).join('') : '<div class="desc">Shared with nobody.</div>'}</div>
    ${v.manage ? `<div class="input-label">Share with${infoBtn('See: open it, read its parameters and build. Work on: also change the parameters, build it and chat in it. Its files and git stay an admin\'s.')}</div>
      <div class="pjs-add"><div class="pjs-people"></div><select class="input pjs-new-right"><option value="see">can see</option><option value="work">can work on</option></select><button class="btn btn-sm btn-primary" data-share>Share</button></div>` : ''}
    ${v.yours === 'host' ? `<div class="input-label">Owner${infoBtn('An admin hands a project to someone else; the change is recorded below.')}</div>
      <div class="pjs-add"><select class="input pjs-owner">${v.people.map(p => `<option value="${escHtml(p.id)}"${p.id === v.owner?.id ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('')}</select><button class="btn btn-sm" data-owner>Change owner</button></div>` : ''}
    ${advancedFold(`<div class="pjs-audit">${v.audit.map(a => `<div class="desc">${escHtml(new Date(a.at).toLocaleString())} — ${escHtml(a.by?.name || '?')} ${escHtml(_pjsWhat(a))}</div>`).join('') || '<div class="desc">Nothing recorded.</div>'}</div>`, { label: 'Who set what', id: 'pjs-audit', count: v.audit.length })}
    <div class="modal-actions"><span class="status-line pjs-status"></span><button class="btn" data-x>Close</button></div></div>`;
  document.body.append(ov);
  const release = overlayBack(() => ov.remove());
  const close = () => { ov.remove(); release(); };
  const st = ov.querySelector('.pjs-status');
  const send = async (url, body) => {
    try { await apiFetch(`/api/projects/${encodeURIComponent(id)}${url}`, { method: 'POST', body }); close(); pjShareOpen(); }
    catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
  };
  if (v.manage) PJSH.pick = peoplePick(ov.querySelector('.pjs-people'), { people: v.people.filter(p => p.id !== v.owner?.id && !v.shares.some(s => s.id === p.id)), label: 'Share with', placeholder: 'Add people…' });
  ov.addEventListener('change', e => { const s = e.target.closest('.pjs-right'); if (s) send('/sharing', { personId: s.dataset.person, right: s.value }); });
  ov.addEventListener('click', async e => {
    if (e.target === ov || e.target.closest('[data-x]')) return close();
    const un = e.target.closest('[data-unshare]');
    if (un) return appConfirm('Stop sharing this project with them? Their conversations in it stay theirs, outside the project.', () => send('/sharing', { personId: un.dataset.unshare, right: 'none' }));
    if (e.target.closest('[data-share]')) {
      const ids = PJSH.pick?.value().people || [];
      if (!ids.length) return setStatus(st, 'Choose someone first.', 'err');
      for (const pid of ids) {
        try { await apiFetch(`/api/projects/${encodeURIComponent(id)}/sharing`, { method: 'POST', body: { personId: pid, right: ov.querySelector('.pjs-new-right').value } }); }
        catch (err) { return setStatus(st, `✗ ${err.message}`, 'err'); }
      }
      close(); return pjShareOpen();
    }
    if (e.target.closest('[data-owner]')) {
      const to = ov.querySelector('.pjs-owner').value;
      if (to && to !== v.owner?.id) appConfirm('Hand this project to them? They become its owner and decide who has it.', () => send('/owner', { personId: to }));
    }
  });
}
