/* ═══════════════════════════════════════════════════════
   The tab strip over a project's conversations (projects/chat.js).

   - A tab is a conversation bound to the project (GET /api/projects/:id/chats);
     + makes a new one, ✕ closes the tab (the conversation stays — ▾ lists every
     one, to open again or archive), a double click renames it.
   - What a tab starts — a work chat, a specialist's mission — opens beside it
     on its own, once, marked ↳; a sub-agent closed by hand stays closed.
   - Which tabs are open, and in what order, is kept per project in this
     browser: it is how this screen is arranged, not a fact about the project.
   ═══════════════════════════════════════════════════════ */

const _pjTabsKey = () => `doca.pj.tabs.${PJ.project?.project?.id}`;

function _pjTabsSave() {
  try { localStorage.setItem(_pjTabsKey(), JSON.stringify({ open: PJC.open, active: PJC.active, seen: [...PJC.seen] })); } catch {}
}

async function pjTabsRestore(first) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(_pjTabsKey()) || '{}'); } catch {}
  PJC.seen = new Set(saved.seen || []);
  await pjTabsSync({ quiet: true });
  const known = new Set(PJC.chats.map(c => c.id));
  PJC.open = (saved.open || []).filter(id => known.has(id));
  if (!PJC.open.length) PJC.open = [first];
  for (const c of PJC.chats) PJC.seen.add(c.id);   // what exists now is not news
  await pjChatActivate(PJC.open.includes(saved.active) ? saved.active : PJC.open[0]);
  _pjTabsSave();
}

/** Re-read the project's conversations; a new sub-agent of an open tab opens beside it. */
async function pjTabsSync({ quiet = false } = {}) {
  if (!PJ.project) return;
  try { PJC.chats = (await apiFetch(`/api/projects/${encodeURIComponent(PJ.project.project.id)}/chats`)).chats || []; }
  catch { return; }
  if (!quiet) {
    for (const c of PJC.chats) {
      if (PJC.seen.has(c.id)) continue;
      PJC.seen.add(c.id);
      if (c.sub && PJC.open.includes(c.parentId)) PJC.open.splice(PJC.open.indexOf(c.parentId) + 1, 0, c.id);
    }
    _pjTabsSave();
  }
  pjTabsRender();
}

function pjTabsRender() {
  const strip = document.getElementById('pj-chat-tabs');
  if (!strip) return;
  const byId = new Map(PJC.chats.map(c => [c.id, c]));
  strip.innerHTML = PJC.open.map(id => {
    const c = byId.get(id) || { title: 'Chat' }, t = PJC.tabs.get(id);
    const working = t?.busy || c.running || c.state === 'running';
    return `<div class="pj-tab-chat ${id === PJC.active ? 'active' : ''} ${c.sub ? 'sub' : ''}" role="tab" aria-selected="${id === PJC.active}"
        data-id="${escHtml(id)}" title="${escHtml(`${c.title || ''}${c.mode && c.mode !== 'agent' ? ` · ${c.mode}` : ''}${c.waiting ? ` · ${c.waiting} queued` : ''}`)}">
      ${working ? '<span class="pj-tab-dot" aria-label="working"></span>' : ''}${c.sub ? '↳ ' : ''}${c.worktree ? `<span title="Its own git worktree, branch ${escHtml(c.worktree)}">⑂ </span>` : ''}<span class="pj-tab-name">${escHtml(c.title || 'Chat')}</span>
      <button class="pj-tab-x" title="Close the tab (the conversation stays)" data-close="${escHtml(id)}">✕</button></div>`;
  }).join('') + `<button class="btn btn-xs" onclick="pjTabNew()" title="A new conversation in this project">＋</button>
    <button class="btn btn-xs" onclick="pjTabNew(true)" title="A new conversation in its own git worktree: a second folder on its own branch, so it and the others can change the project at the same time">＋⑂</button>
    <button class="btn btn-xs" onclick="pjTabMenu(this)" title="Every conversation in this project">▾</button>
    <span class="pj-spacer"></span><button class="btn btn-xs" onclick="pjChatOpenInHarness()" title="This conversation, in the Harness tab">↗</button>`;
  strip.querySelectorAll('.pj-tab-chat').forEach(el => {
    el.onclick = e => { if (!e.target.dataset.close) pjChatActivate(el.dataset.id).then(_pjTabsSave); };
    el.ondblclick = () => pjTabRename(el.dataset.id);
  });
  strip.querySelectorAll('[data-close]').forEach(b => { b.onclick = e => { e.stopPropagation(); pjTabClose(b.dataset.close); }; });
}

async function pjTabNew(worktree = false) {
  try {
    const { chat } = await apiFetch(`/api/projects/${encodeURIComponent(PJ.project.project.id)}/chats`, { method: 'POST', body: worktree ? { worktree: true } : {} });
    PJC.seen.add(chat.id);
    PJC.open.push(chat.id);
    await pjTabsSync({ quiet: true });
    await pjChatActivate(chat.id);
    _pjTabsSave();
    document.getElementById('pj-chat-in')?.focus();
  } catch (e) { appAlert(e.message); }
}

function pjTabClose(id) {
  const i = PJC.open.indexOf(id);
  if (i < 0) return;
  if (PJC.open.length === 1) return appAlert('The last tab stays open: ＋ makes another, ▾ lists them all.');
  PJC.open.splice(i, 1);
  const t = PJC.tabs.get(id);
  if (t && !t.busy) { t.box.remove(); PJC.tabs.delete(id); }   // a working tab keeps drawing, out of sight
  if (PJC.active === id) pjChatActivate(PJC.open[Math.max(0, i - 1)]);
  else pjTabsRender();
  _pjTabsSave();
}

function pjTabRename(id) {
  const c = PJC.chats.find(x => x.id === id);
  appPrompt('Name this conversation:', async title => {
    try { await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/settings`, { method: 'POST', body: { title } }); await pjTabsSync({ quiet: true }); }
    catch (e) { appAlert(e.message); }
  }, c?.title || '');
}

/** Every conversation in the project: open one, or archive it. */
function pjTabMenu(anchor) {
  document.querySelector('.pj-tab-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'pj-tab-menu';
  menu.innerHTML = PJC.chats.map(c => `<div class="pj-tab-menu-row" data-id="${escHtml(c.id)}">
      <span>${c.sub ? '↳ ' : ''}${escHtml(c.title || 'Chat')}${PJC.open.includes(c.id) ? ' <span class="pj-tab-menu-open">open</span>' : ''}</span>
      <button class="btn btn-xs" data-archive="${escHtml(c.id)}" title="Archive: out of the list, kept, recallable in the Harness tab">⌫</button></div>`).join('')
    || '<div class="placeholder">No conversations yet.</div>';
  anchor.after(menu);
  const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } };
  setTimeout(() => document.addEventListener('click', close, true));
  menu.querySelectorAll('.pj-tab-menu-row').forEach(row => {
    row.onclick = e => {
      if (e.target.dataset.archive) return;
      if (!PJC.open.includes(row.dataset.id)) PJC.open.push(row.dataset.id);
      menu.remove();
      pjChatActivate(row.dataset.id).then(_pjTabsSave);
    };
  });
  menu.querySelectorAll('[data-archive]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.archive;
      try { await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST', body: { on: true } }); }
      catch (e) { return appAlert(e.message); }
      menu.remove();
      if (PJC.open.length > 1 && PJC.open.includes(id)) pjTabClose(id);
      pjTabsSync({ quiet: true });
    };
  });
}
