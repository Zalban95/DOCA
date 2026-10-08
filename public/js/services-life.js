/* ═══════════════════════════════════════════════════════
   When a service stops and starts by itself (modules/service-life): a line on each Services row and llama.cpp row —
   "last used 12 min ago · idle for 12 min, stops at 30", "kept on while the panel is open", "started outside DOCA" —
   and under Advanced the row's own choices: its idle minutes, whether it stops with DOCA, whether it starts when
   needed, and "Let DOCA manage it" for one started outside DOCA. The switch itself is Settings → System → Services.
   ═══════════════════════════════════════════════════════ */

let _svcLife = [];

/** Read every row's standing and fill the lines (and each row's Advanced, once). */
async function servicesLifeLoad() {
  try { _svcLife = (await apiFetch('/api/services/life')).rows || []; } catch { return; }   // not a host: the rows say nothing more
  for (const r of _svcLife) {
    const line = document.getElementById(`life-line-${r.kind}-${r.id}`);
    if (line) line.textContent = r.starting ? 'starting — a request needed it…' : r.text || '';
    const adv = document.getElementById(`life-adv-${r.kind}-${r.id}`);
    if (adv && !adv.dataset.drawn) { adv.dataset.drawn = '1'; adv.innerHTML = _svcLifeAdvanced(r); }
  }
}

function _svcLifeAdvanced(r) {
  const k = `${r.kind}-${r.id}`, own = r.own || {};
  const tick = (field, label, on, hint) => `<label style="display:flex;gap:6px;align-items:center;font-size:11px;margin:4px 0">
    <input type="checkbox" id="life-${field}-${k}" data-default="${field === 'stop' ? 'true' : String(!!r.startedByDoca)}" data-label="${escHtml(label)}" ${on ? 'checked' : ''}>
    ${escHtml(label)} <span style="color:var(--muted)">${escHtml(hint)}</span></label>`;
  const managed = r.managed
    ? (r.adopted ? `<button class="btn btn-xs" onclick="svcLifeAdopt('${r.kind}','${escHtml(r.id)}',false)">Stop managing it</button>` : '')
    : `<p style="font-size:11px;color:var(--muted);margin:4px 0">Started outside DOCA: it is never stopped or started by DOCA unless you let it.
       <button class="btn btn-xs btn-teal" onclick="svcLifeAdopt('${r.kind}','${escHtml(r.id)}',true)">Let DOCA manage it</button></p>`;
  return advancedFold(`${managed}
    <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin:4px 0">Stop after
      <input class="input" type="number" min="0" max="10080" id="life-idle-${k}" data-label="Idle minutes for this one" style="width:70px"
             value="${own.idleStopMinutes ?? ''}" placeholder="${r.idleMinutes || 'off'}"> minutes unused
      <span style="color:var(--muted)">empty: the switch in Settings → System → Services; 0: never this one</span></label>
    ${tick('stop', 'Stop it when DOCA stops', own.stopWithDoca !== false, 'when the switch for that is on')}
    ${tick('need', 'Start when needed', r.startsWhenNeeded, 'a request that needs it starts it, and the person is told')}
    <div class="toolbar"><button class="btn btn-xs btn-blue" onclick="svcLifeSave('${r.kind}','${escHtml(r.id)}')">Save</button>
      <span class="status-line" id="life-status-${k}"></span></div>`, { id: 'service-life', label: 'Advanced — when it stops and starts by itself' });
}

async function svcLifeSave(kind, id) {
  const k = `${kind}-${id}`, v = document.getElementById(`life-idle-${k}`)?.value ?? '';
  const body = { idleStopMinutes: v === '' ? null : Number(v),
    stopWithDoca: !!document.getElementById(`life-stop-${k}`)?.checked, startWhenNeeded: !!document.getElementById(`life-need-${k}`)?.checked };
  try {
    await apiFetch(`/api/services/life/${kind}/${encodeURIComponent(id)}`, { method: 'POST', body });
    setStatus(document.getElementById(`life-status-${k}`), '✓ Saved', 'ok');
  } catch (e) { setStatus(document.getElementById(`life-status-${k}`), e.message, 'err'); }
  servicesLifeLoad();
}

async function svcLifeAdopt(kind, id, on) {
  try { await apiFetch(`/api/services/life/${kind}/${encodeURIComponent(id)}/adopt`, { method: 'POST', body: { on } }); } catch (e) { return appAlert(e.message); }
  const adv = document.getElementById(`life-adv-${kind}-${id}`);
  if (adv) delete adv.dataset.drawn;
  servicesLifeLoad();
}
