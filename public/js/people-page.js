/* Controls → Chat: the hive chat on a page of its own (modules/people). The list on the left — your agents first, then
   the people — and the conversation on the right; on a phone one at a time. "Your Orchestrator" is the floating chat
   itself, docked into the page while it is open here, so an agent conversation and a people conversation are the same
   place. Made here: index.html is at its line ceiling. Servable alone: /?view=people. */
let _pcPage = null;          // the page's view (people-view.js)
let _pcDock = null;          // { was } while the floating chat is docked here

function peopleTab(shown) {
  if (!shown) { peopleUndock(); return; }
  const page = document.getElementById('tab-people');
  if (!page) return;
  if (!_pcPage) {
    page.innerHTML = `<div class="pc-page">
      <aside class="pc-side" aria-label="Conversations">
        <div class="pc-side-head"><h2 class="pc-side-title">Chat</h2>
          <button type="button" class="icon-btn" data-act="search" title="Search messages" aria-label="Search messages">⌕</button>
          <button type="button" class="icon-btn" data-act="org" title="The organisation" aria-label="The organisation">⌘</button>
          <button type="button" class="btn btn-sm btn-primary" data-act="new" hidden>＋ New</button></div>
        <input class="input pc-search" type="search" placeholder="Find a conversation" aria-label="Find a conversation">
        <div class="pc-list-body"></div>
      </aside>
      <section class="pc-space" aria-label="Conversation"></section></div>`;
    _pcPage = peopleView(page.querySelector('.pc-page'), 'page');
    page.querySelector('.pc-space').innerHTML = _pcPage.blankHtml();
  }
  peopleLoad().then(() => _pcPage.list());
}

function peoplePageOpen(id) {
  peopleUndock();
  if (!_pcPage) peopleTab(true);
  _pcPage?.openSpace(id);
}

/** Your Orchestrator in the page: the floating chat, moved into the conversation pane until another is opened. */
function peopleDockAgent() {
  const panel = document.getElementById('chat-panel'), pane = _pcPage?.root.querySelector('.pc-space');
  if (!panel || !pane || _pcDock) return;
  _pcPage.open = null;
  _pcPage.root.classList.add('pc-has-open');
  _pcPage.list();
  _pcDock = { was: !!chatOpen };
  pane.replaceChildren(panel);
  panel.classList.add('chat-docked');
  document.body.classList.add('people-docked');
  if (typeof chatFloatMode === 'function') chatFloatMode('agent');
  if (!chatOpen) toggleChat();
  _pcPage.root.querySelector('.pc-row[data-act="agent"][data-kind="orchestrator"]')?.classList.add('active');
}

function peopleUndock() {
  if (!_pcDock) return;
  const panel = document.getElementById('chat-panel');
  panel.classList.remove('chat-docked');
  document.body.classList.remove('people-docked');
  document.getElementById('chat-fab')?.after(panel);
  if (!_pcDock.was && chatOpen) toggleChat();
  _pcDock = null;
  if (_pcPage && !_pcPage.open) _pcPage.close();
}

/* ── Starting a conversation ── */
async function peopleNewOpen(mode = 'page') {
  let dir;
  try { dir = (await apiFetch('/api/people/directory')).people; } catch (e) { return appAlert(e.message); }
  const may = PEOPLE.data?.may || {};
  const ov = Object.assign(document.createElement('div'), { className: 'modal-overlay pc-modal' });
  const opts = dir.map(p => `<label class="pc-pick${p.may ? '' : ' off'}" title="${p.may ? '' : 'Your level does not start a conversation with them'}">
    <input type="checkbox" value="${escHtml(p.id)}" ${p.may ? '' : 'disabled'}>${_pcAvatar(p.id, p.name)}<span><b>${escHtml(p.name)}</b>
    <small>${escHtml([p.title, p.team].filter(Boolean).join(' · ') || p.levelName)}</small></span>${p.atPanel ? '<span class="pt pt-up" title="At the panel now"></span>' : ''}</label>`).join('');
  ov.innerHTML = `<div class="modal pc-new" role="dialog" aria-label="New conversation"><div class="modal-title">New conversation</div>
    <div class="pc-tabs" role="tablist"><button type="button" class="active" data-kind="people">People</button>${may.channel ? '<button type="button" data-kind="channel">Channel</button>' : ''}</div>
    <div class="pc-new-people"><input class="input pc-new-find" type="search" placeholder="Find someone" aria-label="Find someone">
      <div class="pc-picks">${opts || '<div class="placeholder">Nobody else is here yet.</div>'}</div>
      <input class="input pc-new-name" placeholder="Group name (for three or more)" hidden></div>
    <div class="pc-new-channel" hidden><input class="input pc-new-cname" placeholder="Channel name, e.g. general">
      <input class="input pc-new-topic" placeholder="What it is for (optional)">
      ${may.channel === 'org' ? `<select class="input pc-new-aud"><option value="org">Everyone in the organisation</option><option value="team">My team (everyone below me)</option></select>` : '<p class="desc">For your team: you and everyone below you in the organisation.</p>'}</div>
    <div class="modal-actions"><span class="status-line pc-new-status"></span><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn btn-primary" data-go>Start</button></div></div>`;
  document.body.append(ov);
  const close = () => { ov.remove(); release(); };
  const release = overlayBack(() => ov.remove());
  const $ = q => ov.querySelector(q);
  let kind = 'people';
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
  ov.querySelectorAll('.pc-tabs button').forEach(b => b.onclick = () => {
    kind = b.dataset.kind; ov.querySelectorAll('.pc-tabs button').forEach(x => x.classList.toggle('active', x === b));
    $('.pc-new-people').hidden = kind !== 'people'; $('.pc-new-channel').hidden = kind !== 'channel';
  });
  const picked = () => [...ov.querySelectorAll('.pc-picks input:checked')].map(i => i.value);
  ov.querySelector('.pc-picks').addEventListener('change', () => { $('.pc-new-name').hidden = picked().length < 2; });
  $('.pc-new-find').addEventListener('input', e => { const q = e.target.value.toLowerCase(); ov.querySelectorAll('.pc-pick').forEach(l => { l.hidden = !l.textContent.toLowerCase().includes(q); }); });
  $('[data-go]').onclick = async () => {
    try {
      let s;
      if (kind === 'channel') s = await apiFetch('/api/people/spaces', { method: 'POST', body: { kind: 'channel', name: $('.pc-new-cname').value, topic: $('.pc-new-topic').value, audience: $('.pc-new-aud')?.value || 'team' } });
      else if (picked().length === 1) s = await apiFetch('/api/people/dm', { method: 'POST', body: { person: picked()[0] } });
      else if (picked().length > 1) s = await apiFetch('/api/people/spaces', { method: 'POST', body: { kind: 'group', name: $('.pc-new-name').value, members: picked() } });
      else { $('.pc-new-status').textContent = 'Pick someone.'; return; }
      close();
      await peopleLoad();
      peopleOpenIn(mode, s.id);
    } catch (e) { $('.pc-new-status').textContent = e.message; }
  };
}

/** Who is in a group or channel — each opens their card — and adding someone. */
async function peopleMembersOpen(s) {
  rowMoreClose();
  const ov = Object.assign(document.createElement('div'), { className: 'modal-overlay pc-modal' });
  ov.innerHTML = `<div class="modal" role="dialog" aria-label="People in it"><div class="modal-title">${escHtml(s.title)} · ${s.members.length} ${s.members.length === 1 ? 'person' : 'people'}</div>
    <div class="pc-picks">${s.members.map(m => `<button type="button" class="pc-pick" data-card="${escHtml(m.id)}">${_pcAvatar(m.id, m.name)}<span><b>${escHtml(m.name)}</b><small>${m.role === 'owner' ? 'started it' : ''}</small></span></button>`).join('')}</div>
    <div class="pc-add"><select class="input pc-add-who" aria-label="Add someone"><option value="">Add someone…</option></select><button type="button" class="btn btn-sm" data-add>Add</button></div>
    <div class="modal-actions"><span class="status-line pc-add-status"></span><button type="button" class="btn" data-x>Close</button></div></div>`;
  document.body.append(ov);
  const release = overlayBack(() => ov.remove());
  const close = () => { ov.remove(); release(); };
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-x]')) return close();
    const c = e.target.closest('[data-card]');
    if (c) { close(); peopleCardOpen(c.dataset.card); }
  });
  try {
    const dir = (await apiFetch('/api/people/directory')).people.filter(p => p.may && !s.members.some(m => m.id === p.id));
    ov.querySelector('.pc-add-who').insertAdjacentHTML('beforeend', dir.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join(''));
    ov.querySelector('.pc-add').hidden = !dir.length;
  } catch { ov.querySelector('.pc-add').hidden = true; }
  ov.querySelector('[data-add]').onclick = async () => {
    const id = ov.querySelector('.pc-add-who').value;
    if (!id) return;
    try { Object.assign(s, await apiFetch(`/api/people/spaces/${encodeURIComponent(s.id)}/members`, { method: 'POST', body: { add: [id] } })); close(); peopleMembersOpen(s); }
    catch (e) { ov.querySelector('.pc-add-status').textContent = e.message; }
  };
}

/** Search the words of every conversation you are in. */
function peopleSearchOpen() {
  appPrompt('Search your conversations for…', async q => {
    let r;
    try { r = await apiFetch(`/api/people/search?q=${encodeURIComponent(q)}`); } catch (e) { return appAlert(e.message); }
    const ov = Object.assign(document.createElement('div'), { className: 'modal-overlay pc-modal' });
    ov.innerHTML = `<div class="modal pc-results" role="dialog" aria-label="Search results"><div class="modal-title">"${escHtml(q)}" · ${r.results.length} found</div>
      <div class="pc-picks">${r.results.map(m => `<button type="button" class="pc-pick pc-result" data-space="${escHtml(m.spaceId)}"><span><b>${escHtml(m.agentLabel || m.author.name)}</b>
        <small>${escHtml(peopleSpace(m.spaceId)?.title || '')} · ${escHtml(_pcTime(m.at))}</small><span class="pc-result-text">${escHtml(String(m.text).slice(0, 200))}</span></span></button>`).join('') || '<div class="placeholder">Nothing found in the conversations you are in.</div>'}</div>
      <div class="modal-actions"><button type="button" class="btn" data-x>Close</button></div></div>`;
    document.body.append(ov);
    const release = overlayBack(() => ov.remove());
    ov.addEventListener('click', e => {
      const hit = e.target.closest('[data-space]');
      if (e.target === ov || e.target.closest('[data-x]') || hit) { ov.remove(); release(); }
      if (hit) peopleOpenIn('page', hit.dataset.space);
    });
  });
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('tab-settings')?.before(Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-people' })));
