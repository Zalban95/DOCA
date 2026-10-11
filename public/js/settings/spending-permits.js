/* ═══════════════════════════════════════════════════════
   Settings → Spending → Spending permissions (modules/spending/permissions.js): "the agent may spend up to X on Y".
   What the agent asked for waits here (spend_propose) — accept it once, or keep it every month when the person asks;
   declining needs no password. A person allows their own within their level; an admin anyone's.
   ═══════════════════════════════════════════════════════ */

function _spPermitLine(p, v) {
  const person = v.admin && p.personId !== v.me.id ? ` · for ${escHtml((v.people || []).find(x => x.id === p.personId)?.name || p.personId)}` : '';
  const when = p.permanent ? 'a month' : 'once';
  return `<b>up to ${p.upTo} ${escHtml(p.currency)} ${when}</b> on ${escHtml(p.on.kind)} <b>${escHtml(p.on.id)}</b>${person}`
    + `${p.why ? ` — <span style="color:var(--muted)">${escHtml(p.why)}</span>` : ''}`;
}

function spendingPermitsRender(v) {
  const box = document.getElementById('spending-permits');
  if (!box) return;
  const all = v.permissions || [];
  const waiting = all.filter(p => p.state === 'proposed').map(p => `<div class="disk-row" style="flex-wrap:wrap">
      <span class="disk-label">${_spPermitLine(p, v)} <span style="color:var(--muted);font-size:11px">· the agent asked ${escHtml(p.createdAt.slice(0, 10))}</span></span>
      <span class="disk-free" style="display:flex;gap:4px">
        <button class="btn btn-xs btn-blue" onclick="spendingPermitAccept(${jsArg(p.id)}, false)" title="Allow it for one purchase">Allow once</button>
        <button class="btn btn-xs" onclick="spendingPermitAccept(${jsArg(p.id)}, true)" title="Keep it: up to this amount every month, until revoked">Keep it</button>
        <button class="btn btn-xs btn-red" onclick="spendingPermitDecline(${jsArg(p.id)})">Decline</button></span></div>`).join('');
  const active = all.filter(p => p.state === 'active').map(p => `<div class="disk-row">
      <span class="disk-label">${_spPermitLine(p, v)}</span>
      <span class="disk-path">${p.left} ${escHtml(p.currency)} left${p.permanent ? ' this month' : ''}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="spendingPermitRevoke(${jsArg(p.id)})">Revoke</button></span></div>`).join('');
  const past = all.filter(p => !['proposed', 'active'].includes(p.state)).slice(0, 10).map(p => `<div class="disk-row" style="color:var(--muted)">
      <span class="disk-label">${_spPermitLine(p, v)}</span><span class="disk-path">${escHtml(p.state)} ${escHtml(String(p.decidedAt || p.revokedAt || p.createdAt).slice(0, 10))}</span></div>`).join('');
  const most = v.me.mayAllow;
  box.innerHTML = `<div class="card">
    <div class="card-title">Spending permissions</div>
    <p class="desc" style="margin-bottom:6px">Real money the agents may spend, and on what. Without a permission here they ask every time.</p>
    <details class="desc page-about" style="margin-bottom:8px"><summary>What this is</summary>A one-time permission is used by its first purchase; a kept one allows up to its amount each month, until revoked. ${v.admin ? 'As an admin you may allow any amount, for anyone.'
        : most ? `Your level lets you allow up to ${most} ${escHtml(v.currency)} in all.` : 'Your level does not let you allow spending yourself: an admin can.'}</details>
    ${waiting ? `<div class="card-subtitle" style="color:var(--amber)">Waiting for your answer</div>${waiting}` : ''}
    <div class="card-subtitle" style="margin-top:6px">Allowed</div>
    ${active || '<div class="placeholder">Nothing allowed — nothing can be spent.</div>'}
    <div class="card-subtitle" style="margin-top:10px">Allow spending</div>
    <div class="form-row" style="margin-top:4px">
      ${_sppField('spp-kind', 'On what', 'A service (an online API the agents call), a model provider, or a purchase (buying something).',
        '<select class="input" id="spp-kind"><option value="service">a service</option><option value="provider">a model provider</option><option value="purchase">a purchase</option></select>')}
      ${_sppField('spp-id', 'Which', 'Its name, e.g. hi3d.ai or openai, or * for any of that kind.', '<input class="input" id="spp-id" placeholder="hi3d.ai, or * for any">')}
      ${_sppField('spp-up', `Up to (${escHtml(v.currency)})`, 'The most that may be spent under this permission.', `<input class="input" id="spp-up" type="number" min="0" step="any" placeholder="0.00">`)}
      ${v.admin ? _sppField('spp-for', 'For', 'Whose agents may spend it. As an admin you may allow any amount, for anyone.',
        `<select class="input" id="spp-for">${(v.people || []).map(p => `<option value="${escHtml(p.id)}" ${p.id === v.me.id ? 'selected' : ''}>${escHtml(p.name || p.email)}</option>`).join('')}</select>`) : ''}
    </div>
    <div class="settings-tab-row" style="margin:8px 0"><label class="skill-toggle"><input type="checkbox" id="spp-keep" aria-label="Every month"><span class="skill-toggle-track"></span></label>
      <span class="settings-tab-label">Every month${infoBtn('Off (the default): used once, by the first purchase. On: up to the amount every calendar month, until you revoke it.')}</span></div>
    <button class="btn btn-sm btn-blue" onclick="spendingPermitCreate()" ${v.admin || most ? '' : 'disabled'}>Allow</button>
    ${past ? `<div class="card-subtitle" style="margin-top:10px">Earlier</div>${past}` : ''}</div>`;
}

const _sppField = (id, label, info, input) => `<div class="field"><label class="input-label" for="${id}">${label}${infoBtn(info)}</label>${input}</div>`;

async function _spPermitCall(path, method, body) {
  try { await apiFetch(path, { method, body }); } catch (e) { return appAlert(e.message); }
  spendingLoad();
}
const spendingPermitAccept = (id, permanent) => _spPermitCall(`/api/spending/permissions/${encodeURIComponent(id)}/accept`, 'POST', { permanent });
const spendingPermitDecline = id => _spPermitCall(`/api/spending/permissions/${encodeURIComponent(id)}/decline`, 'POST', {});
const spendingPermitRevoke = id => appConfirm('Revoke this permission? The agents will have to ask again.', () => _spPermitCall(`/api/spending/permissions/${encodeURIComponent(id)}`, 'DELETE'));
const spendingPermitCreate = () => _spPermitCall('/api/spending/permissions', 'POST', {
  on: { kind: document.getElementById('spp-kind').value, id: document.getElementById('spp-id').value },
  upTo: document.getElementById('spp-up').value, permanent: document.getElementById('spp-keep').checked,
  ...(document.getElementById('spp-for') ? { personId: document.getElementById('spp-for').value } : {}),
});
