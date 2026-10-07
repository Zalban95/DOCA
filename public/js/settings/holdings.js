/* ═══════════════════════════════════════════════════════
   What you have (modules/auth/holdings.js; CONSTITUTION S13, TODO P1.10):
   a person's level and how far its agents reach, what is allotted to them
   (models, providers, keys, accounts, logins, computers, services, devices —
   by their level and by grants), their budget and spending permissions,
   and their devices. Read-only: Settings → Spending shows your own, and
   Settings → Users opens anyone's for an admin.
   ═══════════════════════════════════════════════════════ */

const _HOLD_KINDS = { model: 'Models', provider: 'Providers', key: 'Keys for services', connector: 'Connected accounts', login: 'Logins',
  computer: 'Agents\' computers', service: 'Inference services', device: 'Others\' devices' };
const _HOLD_REACH = { create: 'creates safely — files, pages, the web, the agents\' own computers', 'own-devices': 'creates, and uses their own devices',
  anything: 'anything — the hub machine and every device', none: 'no tools' };

/** One kind's line: the rule, then what is here for them. */
function _holdKind(kind, r) {
  const list = a => a.map(x => `<code>${escHtml(x)}</code>`).join(', ');
  const rule = r.rule === 'all' ? (kind === 'device' ? 'every one (holds host)' : 'any')
    : r.rule === 'listed' ? `what the level lists: ${list(r.level) || 'nothing'}` : 'only what an admin allots';
  const extra = r.granted.length ? ` · granted: ${list(r.granted)}` : '';
  const here = kind === 'model' || kind === 'device' ? '' : ` · here: ${r.here.length ? list(r.here) : '<span style="color:var(--muted)">none</span>'}`;
  return `<div class="disk-row"><span class="disk-label">${_HOLD_KINDS[kind] || escHtml(kind)}</span><span class="disk-path">${rule}${extra}${here}</span></div>`;
}

function _holdHtml(h) {
  const L = h.level, sp = h.spending, cur = sp.spent?.currency || '';
  const budget = typeof _spBudgetText === 'function' ? _spBudgetText(sp.budget, cur) : escHtml(JSON.stringify(sp.budget || 'none'));
  const dev = d => `${escHtml(d.name || d.id)}${d.kind ? ` <span style="color:var(--muted)">${escHtml(d.kind)}</span>` : ''}`;
  const who = h.self ? 'your' : 'their';
  return `<div class="card-title">What ${h.self || !h.person.name ? 'you have' : `${escHtml(h.person.name)} has`}</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">What ${who} agents may use, and how much — from ${who} level and the grants given to ${h.self ? 'you' : 'them'}. An admin changes it in Settings → Users.</p>
    <div class="disk-row"><span class="disk-label">Level</span><span class="disk-path"><b>${escHtml(L.name)}</b> · rights ${escHtml((L.rights || []).join(', ') || 'none')}
      · ${L.approval === 'ask' ? 'every tool call is asked first' : 'calls follow the panel\'s approval mode'}</span></div>
    <div class="disk-row"><span class="disk-label">Reach</span><span class="disk-path">${L.reach ? escHtml(_HOLD_REACH[L.reach] || L.reach) : 'as its tools allow'}</span></div>
    ${Object.entries(h.resources).map(([k, r]) => _holdKind(k, r)).join('')}
    <div class="disk-row"><span class="disk-label">Budget</span><span class="disk-path">${budget}${sp.spent ? ` · spent today ${sp.spent.today.tokens} tokens, this month ${sp.spent.month.tokens}` : ''}</span></div>
    <div class="disk-row"><span class="disk-label">May spend</span><span class="disk-path">${sp.permissions.filter(p => p.state === 'active')
      .map(p => `up to ${p.upTo} ${escHtml(p.currency || '')} ${p.permanent ? 'a month' : 'once'} on ${escHtml(p.on.kind)} ${escHtml(p.on.id)} (${p.left} left)`).join('; ') || '<span style="color:var(--muted)">nothing</span>'}</span></div>
    <div class="disk-row"><span class="disk-label">Devices</span><span class="disk-path">${h.devices.own.map(dev).join(', ') || '<span style="color:var(--muted)">none paired</span>'}
      ${h.devices.lent.length ? ` · lent to them: ${h.devices.lent.map(dev).join(', ')}` : ''}</span></div>
    ${h.grants.length ? `<div class="disk-row"><span class="disk-label">Grants</span><span class="disk-path">${h.grants.map(g => `<code>${escHtml(g.permission)}</code>`).join(', ')}</span></div>` : ''}`;
}

/** Draw a person's holdings (yours when `personId` is empty) into the element with id `elId`. */
async function holdingsRender(elId, personId) {
  const el = document.getElementById(elId);
  if (!el) return;
  try { el.innerHTML = _holdHtml(await apiFetch(`/api/auth/holdings${personId ? `?person=${encodeURIComponent(personId)}` : ''}`)); }
  catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; }
}

/** Settings → Users: one person's, in a window. */
function holdingsOpen(personId) {
  let overlay = document.getElementById('holdings-overlay');
  if (!overlay) {
    overlay = Object.assign(document.createElement('div'), { id: 'holdings-overlay', className: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    const m = Object.assign(document.createElement('div'), { className: 'modal' });
    m.style.maxWidth = '720px';
    m.innerHTML = '<div id="holdings-modal-body"><div class="placeholder pulse">Loading…</div></div><div class="toolbar-right mt8"><button class="btn btn-xs" id="holdings-close">Close</button></div>';
    overlay.appendChild(m);
    document.body.appendChild(overlay);
    m.querySelector('#holdings-close').onclick = () => { overlay.style.display = 'none'; };
  }
  overlay.style.display = 'flex';
  holdingsRender('holdings-modal-body', personId);
}
