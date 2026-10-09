/* A person's card and the organisation tree (modules/org): name, title, level, where they sit (organisation › team),
   their manager and reports, how many of their devices are online, whether they are at the panel and their local
   time — with Message, and for an admin (or their team leader) where they sit, editable. Opened from a name in the
   chat, from the tree, and from Settings → Users. */

async function peopleCardOpen(id) {
  if (!id) return;
  let c;
  try { c = await apiFetch(`/api/org/people/${encodeURIComponent(id)}`); } catch (e) { return appAlert(e.message); }
  document.querySelector('.pc-card-ov')?.remove();
  const me = PEOPLE.data?.me?.id;
  const chip = p => `<button type="button" class="pc-chip-person" data-card="${escHtml(p.id)}">${_pcAvatar(p.id, p.name)}<span>${escHtml(p.name)}</span></button>`;
  const ov = Object.assign(document.createElement('div'), { className: 'modal-overlay pc-modal pc-card-ov' });
  ov.innerHTML = `<div class="modal pc-card" role="dialog" aria-label="${escHtml(c.name)}">
    <div class="pc-card-top">${_pcAvatar(c.id, c.name).replace('pc-av"', 'pc-av pc-av-lg"')}
      <div><div class="pc-card-name">${escHtml(c.name)}</div><div class="pc-card-title">${escHtml(c.title || c.levelName)}</div>
      ${c.path.length ? `<div class="pc-card-path">${c.path.map(escHtml).join(' <span aria-hidden="true">›</span> ')}</div>` : ''}</div></div>
    <dl class="pc-card-facts">
      <dt>Level</dt><dd>${escHtml(c.levelName)}</dd>
      ${c.email ? `<dt>Email</dt><dd>${escHtml(c.email)}</dd>` : ''}
      <dt>Now</dt><dd><span class="pt ${c.atPanel ? 'pt-up' : 'pc-pt-off'}" aria-hidden="true"></span> ${c.atPanel ? 'At the panel' : 'Not at the panel'}${c.localTime ? ` · ${escHtml(c.localTime)} their time` : ''}</dd>
      <dt>Devices</dt><dd>${c.devices.paired ? `${c.devices.online} of ${c.devices.paired} online` : 'None paired'}</dd>
      <dt>Manager</dt><dd>${c.manager ? chip(c.manager) : '<span class="desc">Nobody — at the top</span>'}</dd>
      <dt>Reports</dt><dd>${c.reports.length ? c.reports.map(chip).join('') : '<span class="desc">None</span>'}</dd>
    </dl>
    ${c.editable ? `<details class="pc-card-edit"><summary>Where ${escHtml(c.name)} sits</summary>
      <label class="input-label">Manager<select class="input pc-ed-manager"><option value="">Nobody (at the top)</option></select></label>
      <label class="input-label">Team<input class="input pc-ed-team" value="${escHtml(c.team)}" placeholder="e.g. Design"></label>
      <label class="input-label">Title<input class="input pc-ed-title" value="${escHtml(c.title)}" placeholder="e.g. Illustrator"></label>
      <div class="toolbar-right"><span class="status-line pc-ed-status"></span><button type="button" class="btn btn-sm btn-primary" data-save>Save</button></div></details>` : ''}
    <div class="modal-actions">${c.id !== me ? '<button type="button" class="btn btn-primary" data-msg>Message</button>' : ''}<button type="button" class="btn" data-org>Organisation</button><button type="button" class="btn" data-x>Close</button></div></div>`;
  document.body.append(ov);
  const release = overlayBack(() => ov.remove());
  const close = () => { ov.remove(); release(); };
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-x]')) return close();
    const p = e.target.closest('[data-card]');
    if (p) { close(); return peopleCardOpen(p.dataset.card); }
    if (e.target.closest('[data-msg]')) { close(); return peopleDm(c.id, currentTab === 'people' ? 'page' : 'float'); }
    if (e.target.closest('[data-org]')) { close(); return peopleOrgOpen(); }
  });
  if (!c.editable) return;
  try {
    const tree = (await apiFetch('/api/org')).tree, all = [];
    const walk = n => { all.push(n); (n.reports || []).forEach(walk); };
    tree.forEach(walk);
    ov.querySelector('.pc-ed-manager').insertAdjacentHTML('beforeend', all.filter(p => p.id !== c.id)
      .map(p => `<option value="${escHtml(p.id)}" ${p.id === c.managerId ? 'selected' : ''}>${escHtml(p.name)}${p.title ? ` — ${escHtml(p.title)}` : ''}</option>`).join(''));
  } catch { /* the field stays as it is */ }
  ov.querySelector('[data-save]').onclick = async () => {
    try {
      await apiFetch(`/api/org/people/${encodeURIComponent(c.id)}`, { method: 'PATCH', body: {
        managerId: ov.querySelector('.pc-ed-manager').value || null, team: ov.querySelector('.pc-ed-team').value, title: ov.querySelector('.pc-ed-title').value } });
      close(); peopleCardOpen(c.id);
    } catch (e) { ov.querySelector('.pc-ed-status').textContent = e.message; }
  };
}

/** The organisation as a tree: everyone under whoever they report to; a click opens the card. */
async function peopleOrgOpen() {
  let r;
  try { r = await apiFetch('/api/org'); } catch (e) { return appAlert(e.message); }
  document.querySelector('.pc-org-ov')?.remove();
  const node = n => `<li><button type="button" class="pc-org-node${n.id === r.me ? ' me' : ''}" data-card="${escHtml(n.id)}">${_pcAvatar(n.id, n.name)}
    <span><b>${escHtml(n.name)}</b><small>${escHtml([n.title, n.team].filter(Boolean).join(' · ') || n.levelName)}</small></span></button>
    ${n.reports?.length ? `<ul>${n.reports.map(node).join('')}</ul>` : ''}</li>`;
  const ov = Object.assign(document.createElement('div'), { className: 'modal-overlay pc-modal pc-org-ov' });
  ov.innerHTML = `<div class="modal pc-org" role="dialog" aria-label="The organisation"><div class="modal-title">${escHtml(r.org.name)} · the organisation</div>
    <p class="desc">${r.may.place === 'anyone' ? 'Open someone to set their manager, team and title.' : r.may.place === 'below' ? 'You place the people below you: open one to change where they sit.' : 'Who reports to whom. An admin places people here.'}</p>
    <ul class="pc-org-tree">${r.tree.map(node).join('')}</ul>
    <div class="modal-actions"><button type="button" class="btn" data-x>Close</button></div></div>`;
  document.body.append(ov);
  const release = overlayBack(() => ov.remove());
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-x]')) { ov.remove(); release(); return; }
    const p = e.target.closest('[data-card]');
    if (p) { ov.remove(); release(); peopleCardOpen(p.dataset.card); }
  });
}

/**
 * The owner's compliance export of every hive-chat conversation (people/keep.js): asked with the password, written in
 * the audit, downloaded as one JSON file. Nobody else reads conversations they are not in — an admin included.
 */
function peopleExport() {
  appConfirm('Export every hive-chat conversation, direct messages included? This is the owner\'s compliance export: it is written in the audit, and the people in them are not told.', async () => {
    try {
      const data = await apiFetch('/api/people/export', { method: 'POST' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
        download: `hive-chat-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { appAlert(e.message); }
  });
}
