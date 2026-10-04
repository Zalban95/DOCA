/* ═══════════════════════════════════════════════════════
   Settings → Users (auth phase 2, docs/design/permissions.md §4): the people
   on this panel, their permission level, and the levels themselves — what each
   lets a person (and the agent acting for them) do: rights, the settings it
   may change, the tools, and whether tool calls always ask.
   ═══════════════════════════════════════════════════════ */

let _usersData = { users: [], levels: [], rights: [] };

async function usersLoad() {
  const panel = document.getElementById('sp-users');
  if (!panel) return;
  panel.innerHTML = '<div class="placeholder pulse">Loading…</div>';
  try {
    const [u, l] = await Promise.all([apiFetch('/api/auth/users'), apiFetch('/api/auth/levels')]);
    _usersData = { users: u.users, levels: l.levels, rights: l.rights };
  } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  panel.innerHTML = '';
  panel.append(_usersPeopleCard(), _usersLevelsCard());
}

const _levelName = id => _usersData.levels.find(l => l.id === id)?.name || id;

function _usersPeopleCard() {
  const card = Object.assign(document.createElement('div'), { className: 'card' });
  card.innerHTML = `<div class="card-title">People</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Everyone who can sign in here, and their level. The agent acts for a person
      with that person's level: what they may not do, the agent may not do for them.</p>`;
  const table = Object.assign(document.createElement('table'), { className: 'models-table' });
  table.innerHTML = '<tr><th>Person</th><th>Level</th><th>Status</th><th>Signed in</th><th></th></tr>';
  for (const p of _usersData.users) {
    const tr = document.createElement('tr');
    const who = document.createElement('td');
    who.innerHTML = `${escHtml(p.name || p.email)}<br><small>${escHtml(p.email)}${p.mustChangePassword ? ' · must set a password' : ''}</small>`;
    const lvl = document.createElement('td');
    const sel = Object.assign(document.createElement('select'), { className: 'input' });
    for (const l of _usersData.levels) sel.appendChild(new Option(l.name, l.id, false, l.id === p.level));
    sel.onchange = () => _usersPatch(p.id, { level: sel.value });
    lvl.appendChild(sel);
    const status = Object.assign(document.createElement('td'), { textContent: p.suspended ? 'suspended' : p.status });
    const sess = Object.assign(document.createElement('td'), { textContent: String(p.sessions) });
    const act = document.createElement('td');
    const b = (t, title, fn) => act.appendChild(Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: t, title, onclick: fn }));
    b(p.suspended ? 'Restore' : 'Suspend', p.suspended ? 'Let them sign in again' : 'Sign them out and stop them signing in', () => _usersPatch(p.id, { suspended: !p.suspended }));
    b('Reset password', 'A new one-time password, shown once', () => appConfirm(`Give ${p.email} a new one-time password? Their sessions end.`, async () => {
      try { const r = await apiFetch(`/api/auth/users/${encodeURIComponent(p.id)}/password`, { method: 'POST' }); appAlert(`One-time password for ${p.email}:\n\n${r.oneTimePassword}\n\nShown once. They replace it when they sign in.`); usersLoad(); }
      catch (e) { appAlert(e.message); }
    }));
    if (p.sessions) b('Sign out', 'End every session they have', async () => { try { await apiFetch(`/api/auth/users/${encodeURIComponent(p.id)}/sessions`, { method: 'DELETE' }); usersLoad(); } catch (e) { appAlert(e.message); } });
    tr.append(who, lvl, status, sess, act);
    table.appendChild(tr);
  }
  card.appendChild(table);
  const add = Object.assign(document.createElement('div'), { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px' });
  add.innerHTML = `<input class="input" id="users-new-email" placeholder="email" style="flex:2;min-width:160px">
    <input class="input" id="users-new-name" placeholder="name" style="flex:1;min-width:100px">
    <select class="input" id="users-new-level">${_usersData.levels.map(l => `<option value="${escHtml(l.id)}" ${l.id === 'member' ? 'selected' : ''}>${escHtml(l.name)}</option>`).join('')}</select>
    <button class="btn btn-xs btn-blue" onclick="usersAdd()">+ Add person</button>`;
  card.appendChild(add);
  return card;
}

async function usersAdd() {
  const email = document.getElementById('users-new-email').value.trim();
  if (!email) return;
  try {
    const r = await apiFetch('/api/auth/users', { method: 'POST', body: { email, name: document.getElementById('users-new-name').value.trim(), level: document.getElementById('users-new-level').value } });
    appAlert(`${email} can sign in with this one-time password:\n\n${r.oneTimePassword}\n\nShown once. They replace it at their first sign-in.`);
    usersLoad();
  } catch (e) { appAlert(e.message); }
}

async function _usersPatch(id, body) {
  try { await apiFetch(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body }); }
  catch (e) { appAlert(e.message); }
  usersLoad();
}

function _usersLevelsCard() {
  const card = Object.assign(document.createElement('div'), { className: 'card' });
  card.innerHTML = `<div class="card-title" style="display:flex;align-items:center;gap:8px">Levels
      <button class="btn btn-xs" onclick="usersLevelEdit()">+ New level</button></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">What a level lets a person do: its rights, the settings it may change, the tools the
      agent may use for them, and whether those calls always ask. The four built-in levels cannot be changed; copy one to start a level of your own.</p>`;
  for (const l of _usersData.levels) {
    const row = Object.assign(document.createElement('div'), { className: 'settings-tab-row' });
    const btn = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: l.builtin ? `Copy ${l.name}` : `Edit ${l.name}` });
    btn.onclick = () => usersLevelEdit(l.builtin ? { ...l, id: '', name: `${l.name} (copy)` } : l);
    const holders = _usersData.users.filter(u => u.level === l.id).length;
    row.append(btn, Object.assign(document.createElement('span'), { className: 'settings-tab-label',
      textContent: `${l.name}${l.builtin ? ' (built in)' : ''} — ${l.rights.join(', ') || 'nothing'} · settings: ${l.settings.join(', ') || 'none'} · tools: ${l.tools.allow.join(', ') || 'none'}${l.tools.deny.length ? ` except ${l.tools.deny.join(', ')}` : ''} · ${l.approval === 'ask' ? 'always asks' : 'follows the panel\'s mode'} · ${holders} ${holders === 1 ? 'person' : 'people'}` }));
    card.appendChild(row);
  }
  return card;
}

/** The level editor, in a window: `l` is an existing custom level, a copy of a built-in, or nothing (new). */
function usersLevelEdit(l = { id: '', name: '', rights: ['read', 'chat'], settings: [], tools: { allow: ['*'], deny: [] }, approval: 'ask' }) {
  let overlay = document.getElementById('users-level-overlay');
  if (!overlay) {
    overlay = Object.assign(document.createElement('div'), { id: 'users-level-overlay', className: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    overlay.appendChild(Object.assign(document.createElement('div'), { className: 'modal', id: 'users-level-modal' }));
    document.body.appendChild(overlay);
  }
  const m = document.getElementById('users-level-modal');
  m.style.maxWidth = '640px';
  const boxes = _usersData.rights.map(r => `<label style="margin-right:10px"><input type="checkbox" data-right="${escHtml(r)}" ${l.rights.includes(r) ? 'checked' : ''}> ${escHtml(r)}</label>`).join('');
  m.innerHTML = `<div class="modal-title">${l.id ? `Level: ${escHtml(l.name)}` : 'New level'}</div>
    <label class="harness-hint">Name</label><input class="input" id="lvl-name" value="${escHtml(l.name)}" style="width:100%">
    <label class="harness-hint" style="margin-top:8px;display:block">Rights</label><div>${boxes}</div>
    <small class="harness-hint">host is the machine itself (shell, files, Docker); delegate lets them make exceptions for others of their level or below.</small>
    <label class="harness-hint" style="margin-top:8px;display:block">Settings they may change (prefixes, one per line; * for all)</label>
    <textarea class="input" id="lvl-settings" rows="3" style="width:100%">${escHtml(l.settings.join('\n'))}</textarea>
    <label class="harness-hint" style="margin-top:8px;display:block">Tools the agent may use for them — allowed / denied (one per line: shell, shell:git, read_file, mcp__*, *)</label>
    <div style="display:flex;gap:6px"><textarea class="input" id="lvl-allow" rows="4" style="flex:1">${escHtml(l.tools.allow.join('\n'))}</textarea>
      <textarea class="input" id="lvl-deny" rows="4" style="flex:1">${escHtml(l.tools.deny.join('\n'))}</textarea></div>
    <label class="harness-hint" style="margin-top:8px;display:block">Approval</label>
    <select class="input" id="lvl-approval"><option value="ask" ${l.approval === 'ask' ? 'selected' : ''}>Always ask before a tool call</option>
      <option value="mode" ${l.approval === 'mode' ? 'selected' : ''}>Follow the panel's Auto / Manual mode</option></select>
    <div class="toolbar-right mt8"><span class="status-line" id="lvl-status"></span>
      ${l.id ? '<button class="btn btn-xs btn-red" id="lvl-delete">Delete</button>' : ''}
      <button class="btn btn-xs btn-blue" id="lvl-save">Save</button><button class="btn btn-xs" id="lvl-close">Close</button></div>`;
  overlay.style.display = 'flex';
  m.querySelector('#lvl-close').onclick = () => { overlay.style.display = 'none'; };
  const lines = id => m.querySelector(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  m.querySelector('#lvl-save').onclick = async () => {
    const body = { name: m.querySelector('#lvl-name').value, rights: [...m.querySelectorAll('[data-right]:checked')].map(c => c.dataset.right),
      settings: lines('#lvl-settings'), tools: { allow: lines('#lvl-allow'), deny: lines('#lvl-deny') }, approval: m.querySelector('#lvl-approval').value };
    try {
      await apiFetch(l.id ? `/api/auth/levels/${encodeURIComponent(l.id)}` : '/api/auth/levels', { method: l.id ? 'PATCH' : 'POST', body });
      overlay.style.display = 'none'; usersLoad();
    } catch (e) { m.querySelector('#lvl-status').textContent = e.message; }
  };
  m.querySelector('#lvl-delete')?.addEventListener('click', () => appConfirm(`Delete the level ${l.name}?`, async () => {
    try { await apiFetch(`/api/auth/levels/${encodeURIComponent(l.id)}`, { method: 'DELETE' }); overlay.style.display = 'none'; usersLoad(); }
    catch (e) { m.querySelector('#lvl-status').textContent = e.message; }
  }));
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-users' })));
