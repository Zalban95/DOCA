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
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">What the agents may spend, and on what. They ask every time unless a permission here covers it;
      a one-time permission is used by its first purchase, a kept one allows up to its amount each month. ${v.admin ? 'As an admin you may allow any amount, for anyone.'
        : most ? `Your level lets you allow up to ${most} ${escHtml(v.currency)} at a time.` : 'Your level does not let you allow spending yourself: an admin can.'}</p>
    ${waiting ? `<div class="card-title" style="font-size:12px;color:var(--amber)">Waiting for your answer</div>${waiting}` : ''}
    <div class="card-title" style="font-size:12px;margin-top:6px">Allowed</div>
    ${active || '<div class="placeholder">Nothing allowed — nothing can be spent.</div>'}
    <div class="input-label" style="margin-top:10px">Allow spending</div>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <select class="input" id="spp-kind" style="width:auto"><option value="service">a service</option><option value="provider">a model provider</option><option value="purchase">a purchase</option></select>
      <input class="input" id="spp-id" placeholder="which (e.g. hi3d.ai, or * for any)" style="width:200px">
      <input class="input" id="spp-up" type="number" min="0" step="any" placeholder="up to (${escHtml(v.currency)})" style="width:120px">
      <label style="display:flex;align-items:center;gap:4px;font-size:12px"><input type="checkbox" id="spp-keep"> every month</label>
      ${v.admin ? `<select class="input" id="spp-for" style="width:auto">${(v.people || []).map(p => `<option value="${escHtml(p.id)}" ${p.id === v.me.id ? 'selected' : ''}>for ${escHtml(p.name || p.email)}</option>`).join('')}</select>` : ''}
      <button class="btn btn-sm btn-blue" onclick="spendingPermitCreate()" ${v.admin || most ? '' : 'disabled'}>Allow</button></div>
    ${past ? `<div class="card-title" style="font-size:12px;margin-top:10px">Earlier</div>${past}` : ''}</div>`;
}

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
