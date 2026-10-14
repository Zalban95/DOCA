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
    const [u, l, g] = await Promise.all([apiFetch('/api/auth/users'), apiFetch('/api/auth/levels'), apiFetch('/api/auth/grants').catch(() => ({ grants: [] }))]);
    _usersData = { users: u.users, levels: l.levels, rights: l.rights, grants: g.grants };
  } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  panel.innerHTML = '';
  panel.append(_usersPeopleCard(), _usersLevelsCard(), _usersGrantsCard());
}

const _levelName = id => _usersData.levels.find(l => l.id === id)?.name || id;

function _usersPeopleCard() {
  const card = Object.assign(document.createElement('div'), { className: 'card' });
  card.innerHTML = `<div class="card-title">People${typeof peopleOrgOpen === 'function' ? ' <button type="button" class="btn btn-xs" style="float:right" onclick="peopleOrgOpen()">Organisation</button>' : ''}</div>
    <p class="desc" style="margin-bottom:10px">Everyone who can sign in here, and their level. The agent acts for a person
      with that person's level: what they may not do, the agent may not do for them.</p>`;
  const table = Object.assign(document.createElement('table'), { className: 'models-table' });
  table.innerHTML = `<tr><th>Person</th><th>Level${infoBtn('What this person may do, and so what the agent may do for them. Changing it takes effect at once.')}</th><th>Status</th><th>Signed in${infoBtn('How many sessions (browsers or apps) they are signed in with now.')}</th><th></th></tr>`;
  for (const p of _usersData.users) {
    const tr = document.createElement('tr');
    const who = document.createElement('td');
    who.innerHTML = `${escHtml(p.name || p.email)}<br><small>${escHtml(p.email)}${p.mustChangePassword ? ' · must set a password' : ''}</small>`;
    const lvl = document.createElement('td');
    const sel = Object.assign(document.createElement('select'), { className: 'input' });
    sel.setAttribute('aria-label', `Level of ${p.email}`);
    sel.style.minWidth = '130px';
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
    b('What they have', 'Their level, reach, what is allotted to them, budget and devices', () => holdingsOpen(p.id));
    if (typeof peopleCardOpen === 'function') b('Card', 'Their card: manager, reports, team and title — where they sit in the organisation', () => peopleCardOpen(p.id));
    if (p.sessions) b('Sign out', 'End every session they have', async () => { try { await apiFetch(`/api/auth/users/${encodeURIComponent(p.id)}/sessions`, { method: 'DELETE' }); usersLoad(); } catch (e) { appAlert(e.message); } });
    tr.append(who, lvl, status, sess, act);
    table.appendChild(tr);
  }
  // On a phone the table scrolls in its own box rather than squeezing the level to two letters.
  card.appendChild(Object.assign(document.createElement('div'), { className: 'scroll-x' })).appendChild(table);
  const add = Object.assign(document.createElement('div'), { className: 'form-row', style: 'margin-top:12px' });
  add.innerHTML = `${_usersField('users-new-email', 'Email', 'What they sign in with. They get a one-time password, shown to you once, which they replace at their first sign-in.', '<input class="input" id="users-new-email" type="email" placeholder="name@example.com">')}
    ${_usersField('users-new-name', 'Name', 'How they are shown in the panel and to others. Optional.', '<input class="input" id="users-new-name" placeholder="optional">')}
    ${_usersField('users-new-level', 'Level', 'What they may do. Member (the default) talks to the agents and uses their own devices; an Admin runs the machine. You can change it later.',
      `<select class="input" id="users-new-level">${_usersData.levels.map(l => `<option value="${escHtml(l.id)}" ${l.id === 'member' ? 'selected' : ''}>${escHtml(l.name)}</option>`).join('')}</select>`)}
    <button class="btn btn-xs btn-blue" onclick="usersAdd()">+ Add person</button><span class="status-line" id="users-new-status"></span>`;
  card.appendChild(add);
  if (typeof peopleExport === 'function') {   // the owner's alone (org): shown once /api/auth/me says so
    const ex = Object.assign(document.createElement('p'), { className: 'desc', hidden: true });
    ex.innerHTML = 'Hive chat: nobody reads a conversation they are not in, an admin included. <button type="button" class="btn btn-xs" onclick="peopleExport()">Export every conversation</button> — for compliance, the owner\'s alone, with the password, written in the audit.';
    card.appendChild(ex);
    apiFetch('/api/auth/me').then(me => { ex.hidden = !(me.rights || []).includes('org'); }).catch(() => {});
  }
  return card;
}

async function usersAdd() {
  const field = document.getElementById('users-new-email'), email = field.value.trim();
  // An empty press said nothing at all (newcomer run 2026-10-14): the form says what it needs.
  if (!email) { setStatus(document.getElementById('users-new-status'), 'Type their email first — it is what they sign in with.', 'err'); field.focus(); return; }
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
    <p class="desc" style="margin-bottom:10px">What a level lets a person do. The four built-in levels cannot be changed; copy one to start a level of your own.</p>`;
  for (const l of _usersData.levels) {
    const row = Object.assign(document.createElement('div'), { className: 'settings-tab-row' });
    const btn = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: l.builtin ? `Copy ${l.name}` : `Edit ${l.name}` });
    btn.onclick = () => usersLevelEdit(l.builtin ? { ...l, id: '', name: `${l.name} (copy)` } : l);
    const holders = _usersData.users.filter(u => u.level === l.id).length;
    row.append(btn, Object.assign(document.createElement('span'), { className: 'settings-tab-label',
      textContent: `${l.name}${l.builtin ? ' (built in)' : ''} — ${l.rights.join(', ') || 'nothing'} · settings: ${l.settings.join(', ') || 'none'} · tools: ${l.tools.allow.join(', ') || 'none'}${l.tools.deny.length ? ` except ${l.tools.deny.join(', ')}` : ''} · ${l.approval === 'ask' ? 'always asks' : 'follows the panel\'s mode'}${l.reach ? ` · reaches: ${l.reach}` : ''}${l.resources ? ` · uses: ${Object.entries(l.resources).map(([k, v]) => `${k} ${v.join(', ')}`).join('; ')}` : ''}${l.delegates ? ` · may give: ${l.delegates.join(', ')}` : ''} · ${holders} ${holders === 1 ? 'person' : 'people'}` }));
    card.appendChild(row);
  }
  return card;
}

/** Exceptions to a level (auth/grants.js): who gave what to whom, and taking one back. */
function _usersGrantsCard() {
  const card = Object.assign(document.createElement('div'), { className: 'card' });
  card.innerHTML = `<div class="card-title">Grants — exceptions to a level</div>
    <p class="desc" style="margin-bottom:6px">One thing a person or a specialist may have that their level does not give.</p>
    <details class="desc page-about" style="margin-bottom:10px"><summary>What this is</summary>A grant gives one person, specialist or mission one thing their level does not:
      a tool (tool:shell:git), a call without asking (approve:shell:git), a setting (setting:models), a folder (path:/srv/x) or a resource
      (use:model:deepseek/*, use:service:vllm, use:device:&lt;id&gt; — another person's device, lent). Given by someone
      holding delegate, never beyond what they hold; the agent can give its own missions tool grants the same way. The rules — files that govern
      the agent, asking people — are never grantable.</details>`;
  const who = id => _usersData.users.find(u => u.id === id)?.email || id;
  if (!(_usersData.grants || []).length) card.appendChild(Object.assign(document.createElement('div'), { className: 'placeholder', textContent: 'No grants.' }));
  for (const g of _usersData.grants || []) {
    const row = Object.assign(document.createElement('div'), { className: 'settings-tab-row' });
    const rev = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: 'Revoke' });
    rev.onclick = () => confirmRemove(`the grant ${g.permission}`, 'Whoever held it loses it at once; giving it back is a new grant.', async () => { try { await apiFetch(`/api/auth/grants/${encodeURIComponent(g.id)}`, { method: 'DELETE' }); usersLoad(); } catch (e) { appAlert(e.message); } }, { verb: 'Revoke' });
    row.append(rev, Object.assign(document.createElement('span'), { className: 'settings-tab-label',
      textContent: `${g.permission} → ${g.subject.kind} ${g.subject.kind === 'user' ? who(g.subject.id) : g.subject.id} · ${g.scope} · by ${g.by.kind === 'agent' ? 'an agent for ' : ''}${who(g.by.user || g.by.id)}${g.note ? ` · ${g.note}` : ''}` }));
    card.appendChild(row);
  }
  const form = Object.assign(document.createElement('div'), { className: 'form-row', style: 'margin-top:10px' });
  form.innerHTML = `${_usersField('grant-kind', 'To', 'A person, or a specialist type (every mission of that specialist).', '<select class="input" id="grant-kind"><option value="user">person</option><option value="specialist">specialist type</option></select>')}
    ${_usersField('grant-user', 'Who', 'The person, or the specialist\'s id (e.g. scribe), who gets it.',
      `<select class="input" id="grant-user">${_usersData.users.map(u => `<option value="${escHtml(u.id)}">${escHtml(u.email)}</option>`).join('')}</select>
      <input class="input" id="grant-spec" placeholder="specialist id (e.g. scribe)" style="display:none">`)}
    ${_usersField('grant-perm', 'What', 'The one thing given, e.g. tool:shell:git (a tool), approve:shell:git (no asking for it), setting:models, path:/srv/x (a folder) or use:model:deepseek/* (a resource). You can only give what you hold yourself.', '<input class="input" id="grant-perm" placeholder="tool:shell:git">')}
    ${_usersField('grant-note', 'Why', 'A note kept with the grant, so whoever reads it later knows why it was given. Optional.', '<input class="input" id="grant-note" placeholder="optional">')}
    <button class="btn btn-xs btn-blue" id="grant-give">Give</button>`;
  card.appendChild(form);
  const kind = form.querySelector('#grant-kind');
  kind.onchange = () => { form.querySelector('#grant-user').style.display = kind.value === 'user' ? '' : 'none'; form.querySelector('#grant-spec').style.display = kind.value === 'user' ? 'none' : ''; };
  form.querySelector('#grant-give').onclick = async () => {
    const subject = { kind: kind.value, id: kind.value === 'user' ? form.querySelector('#grant-user').value : form.querySelector('#grant-spec').value.trim() };
    try { await apiFetch('/api/auth/grants', { method: 'POST', body: { subject, permission: form.querySelector('#grant-perm').value.trim(), note: form.querySelector('#grant-note').value } }); usersLoad(); }
    catch (e) { appAlert(e.message); }
  };
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
    <label class="input-label" for="lvl-name">Name${infoBtn('What the level is called, as people and the agents see it.')}</label><input class="input" id="lvl-name" value="${escHtml(l.name)}" style="width:100%">
    <div class="input-label" style="margin-top:8px">Rights${infoBtn('read: see the panel · chat: talk to the agents · propose: decide the agents\' proposed settings · host: the machine itself (shell, files, Docker, services) · devices: pair and manage devices · users: manage people and levels · org: the owner\'s things (backups, updates, how the hub listens, exporting conversations) · delegate: give others of their level or below an exception (a grant). A level never gets more than the person making it holds.')}</div><div>${boxes}</div>
    <label class="input-label" for="lvl-approval" style="margin-top:8px;display:block">Approval${infoBtn('Always ask (the default for a new level): every tool call the agent makes for them waits for a yes. Follow the panel\'s mode: their calls run as Auto or Manual says, like an admin\'s.')}</label>
    <select class="input" id="lvl-approval"><option value="ask" ${l.approval === 'ask' ? 'selected' : ''}>Always ask before a tool call</option>
      <option value="mode" ${l.approval === 'mode' ? 'selected' : ''}>Follow the panel's Auto / Manual mode</option></select>
    <div class="input-label" style="margin-top:8px">How far its agents reach${infoBtn('A ceiling on top of the tools: "create safely" keeps the agents to files, pages, the web and their own computers; "their own devices" adds the person\'s paired devices; "anything" includes this machine\'s command line and every device. As its tools allow: no extra ceiling.')}</div>
    <select class="input" id="lvl-reach"><option value="" ${!l.reach ? 'selected' : ''}>As its tools allow</option>
      <option value="create" ${l.reach === 'create' ? 'selected' : ''}>Create safely — files, pages, the web, the agents' own computers</option>
      <option value="own-devices" ${l.reach === 'own-devices' ? 'selected' : ''}>Create, and their own devices</option>
      <option value="anything" ${l.reach === 'anything' ? 'selected' : ''}>Anything — the hub machine and every device</option></select>
    <div class="input-label" style="margin-top:8px">Whom they may message in the hive chat${infoBtn('Who people of this level may start a conversation with in the hive chat. By default it follows the rights: with chat, anyone in the organisation.')}</div>
    <select class="input" id="lvl-people"><option value="" ${!l.people ? 'selected' : ''}>As its rights say (chat: anyone in the organisation; otherwise only where added)</option>
      <option value="org" ${l.people === 'org' ? 'selected' : ''}>Anyone in the organisation</option>
      <option value="team" ${l.people === 'team' ? 'selected' : ''}>Their team only — their manager, peers and reports</option>
      <option value="added" ${l.people === 'added' ? 'selected' : ''}>Only where someone adds them (a guest)</option></select>
    ${advancedFold(`<label class="input-label" style="margin-top:4px;display:block">Settings they may change${infoBtn('Which settings people of this level may change or accept from the agent, as the start of their names, one per line (e.g. voice, ambient); * for all. Empty (the default): none.')}</label>
    <textarea class="input" id="lvl-settings" rows="3" style="width:100%" data-default="" data-label="Settings">${escHtml(l.settings.join('\n'))}</textarea>
    <label class="input-label" style="margin-top:8px;display:block">Tools the agent may use for them — allowed / denied${infoBtn('One per line, e.g. shell, shell:git, read_file, mcp__*, or * for all. Left: allowed (default *). Right: denied, which wins over allowed (default none).')}</label>
    <div style="display:flex;gap:6px"><textarea class="input" id="lvl-allow" rows="4" style="flex:1" data-default="*" data-label="Tools allowed">${escHtml(l.tools.allow.join('\n'))}</textarea>
      <textarea class="input" id="lvl-deny" rows="4" style="flex:1" data-default="" data-label="Tools denied">${escHtml(l.tools.deny.join('\n'))}</textarea></div>
    <div class="input-label" style="margin-top:8px">What its people's agents may use${infoBtn('Per kind, a comma-separated list: * for all, deepseek/* for everything starting so. Empty (the default): the usual rule — models and computers for everyone; keys, accounts and logins for admins only. A grant use:<kind>:<id> adds one for a person.')}</div>
    ${USERS_RESOURCE_KINDS.map(([k, label]) => `<div style="display:flex;gap:6px;align-items:center;margin-top:3px"><label class="harness-hint" style="width:110px" for="lvl-res-${k}">${label}</label>
      <input class="input" id="lvl-res-${k}" data-resource="${k}" data-default="" data-label="${escHtml(label)}" style="flex:1" value="${escHtml((l.resources?.[k] || []).join(', '))}"></div>`).join('')}
    <div class="input-label" style="margin-top:8px">What its people may give others${infoBtn('Only with the delegate right: which grants they may give, one per line (e.g. use:model:*, tool:shell:git). Empty (the default): anything they hold themselves.')}</div>
    <textarea class="input" id="lvl-delegates" rows="2" style="width:100%" data-default="" data-label="May give others">${escHtml((l.delegates || []).join('\n'))}</textarea>
    <div class="input-label" style="margin-top:8px">New devices they may approve${infoBtn('A newly paired device waits until someone allowed says yes. By default this follows the rights: with devices, anyone\'s; otherwise their own.')}</div>
    <select class="input" id="lvl-approve-devices" data-default="" data-label="New devices"><option value="" ${!l.approveDevices ? 'selected' : ''}>As its rights say (devices: anyone's; own devices: their own)</option>
      <option value="none" ${l.approveDevices === 'none' ? 'selected' : ''}>None — not even their own</option>
      <option value="own" ${l.approveDevices === 'own' ? 'selected' : ''}>Their own — one tap when it shows up</option>
      <option value="anyone" ${l.approveDevices === 'anyone' ? 'selected' : ''}>Anyone's, at most with what they hold themselves</option></select>`,
    { id: 'users-level', label: 'Advanced — settings, tools, resources, what they may give, new devices' })}
    <div class="toolbar-right mt8"><span class="status-line" id="lvl-status"></span>
      ${l.id ? '<button class="btn btn-xs btn-red" id="lvl-delete">Delete</button>' : ''}
      <button class="btn btn-xs btn-blue" id="lvl-save">Save</button><button class="btn btn-xs" id="lvl-close">Close</button></div>`;
  overlay.style.display = 'flex';
  m.querySelector('#lvl-close').onclick = () => { overlay.style.display = 'none'; };
  const lines = id => m.querySelector(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  m.querySelector('#lvl-save').onclick = async () => {
    const body = { name: m.querySelector('#lvl-name').value, rights: [...m.querySelectorAll('[data-right]:checked')].map(c => c.dataset.right),
      settings: lines('#lvl-settings'), tools: { allow: lines('#lvl-allow'), deny: lines('#lvl-deny') }, approval: m.querySelector('#lvl-approval').value, reach: m.querySelector('#lvl-reach').value,
      resources: Object.fromEntries([...m.querySelectorAll('[data-resource]')].map(i => [i.dataset.resource, i.value.split(',').map(s => s.trim()).filter(Boolean)]).filter(([, v]) => v.length)),
      delegates: lines('#lvl-delegates'), approveDevices: m.querySelector('#lvl-approve-devices').value, people: m.querySelector('#lvl-people').value };
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

/** A labelled field with its ⓘ. */
const _usersField = (id, label, info, input) => `<div class="field"><label class="input-label" for="${id}">${label}${infoBtn(info)}</label>${input}</div>`;

/** Resources a level allots (modules/auth/allot.js): kind and its label in the editor. */
const USERS_RESOURCE_KINDS = [['model', 'Models'], ['provider', 'Providers'], ['key', 'Keys for services'], ['connector', 'Connected accounts'], ['login', 'Logins'], ['computer', 'Agents\' computers'], ['service', 'Inference services'], ['device', 'Others\' devices'], ['vnc', 'VNC screens'], ['account', 'Own accounts (Google, Microsoft 365)'],
  ['home', 'Home (light.*, climate.hall)'], ['nearby', 'Nearby things (an id, or place:Home)']];

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-users' })));
