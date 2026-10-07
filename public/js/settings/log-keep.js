/* Settings → System → Logs (modules/log-keep.js; TODO P1.12): what the hub keeps of what happened — in memory and on
   disk — how much each holds now, and the bounds that keep it from filling either. Work nobody watched is only
   logged (Chronicle reads it back); these say how much of that log stays. A host's; never proposable by the agent. */
async function logKeepCard() {
  const panel = document.querySelector('#sp-system .scroll-y') || document.getElementById('sp-system');
  if (!panel || (typeof authHasRight === 'function' && !authHasRight('host'))) return;
  let d;
  try { d = await apiFetch('/api/logs/keep'); } catch { return; }
  let card = document.getElementById('log-keep-card');
  if (!card) { card = Object.assign(document.createElement('div'), { className: 'card form-help-skip', id: 'log-keep-card' }); panel.append(card); }
  card.innerHTML = logKeepHtml(d);
}

function logKeepBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function logKeepHtml(d) {
  const unit = p => (/Days$/.test(p) ? 'days' : /Lines$/.test(p) ? 'lines' : /Kept$/.test(p) ? 'kept' : /maxSpans$/.test(p) ? 'rows' : '');
  const field = s => `<label style="display:inline-flex;gap:6px;align-items:center;font-size:12px;margin:2px 10px 2px 0" title="${escHtml(s.hint || '')}">
      <input class="input" type="number" data-log-keep="${escHtml(s.path)}" value="${escHtml(String(s.value))}" min="${s.min ?? ''}" max="${s.max ?? ''}" style="width:96px">
      <span style="color:var(--muted)">${unit(s.path)}${s.value !== s.default ? ` <span title="the default">(${escHtml(String(s.default))})</span>` : ''}</span></label>`;
  const rows = d.stores.map(s => `<div class="tool-row" style="grid-template-columns:minmax(150px,auto) 1fr auto;align-items:center">
      <span class="tool-label"><b>${escHtml(s.label)}</b><br><span style="color:var(--muted);font-size:10px">${s.where === 'memory' ? 'in memory' : 'on disk'}</span></span>
      <span class="tool-note" style="white-space:normal">${escHtml(s.what)}${s.enabled === false ? ' — <span style="color:var(--amber)">tracing is off</span>' : ''}<br>
        ${s.settings.length ? s.settings.map(field).join('') : `<span style="color:var(--muted)">${escHtml(s.fixed || '')}</span>`}</span>
      <span class="tool-actions" style="text-align:right;font-size:11px;white-space:nowrap">${s.entries == null ? '—' : s.entries.toLocaleString()} ${s.where === 'memory' ? 'lines' : s.id === 'runs' || s.id === 'traces' ? 'rows' : 'files'}<br>
        <span style="color:var(--muted)">${s.approx ? '≈ ' : ''}${logKeepBytes(s.bytes)}</span></span></div>`).join('');
  return `<div class="card-title">Logs — what is kept of what happened</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Work nobody is watching is only logged; Chronicle (Agents → Chronicle) reads it back.
      These bounds keep that log from filling memory or the disk: past them the oldest goes first, at start, daily and when you save.
      Hover a box for what it bounds; the number in brackets is the default.</p>
    ${rows}
    <div class="toolbar" style="margin-top:8px"><button class="btn btn-sm btn-blue" onclick="logKeepSave(this)">Save</button>
      <span class="status-line" id="log-keep-status"></span></div>`;
}

async function logKeepSave(btn) {
  const values = {};
  btn.closest('.card').querySelectorAll('[data-log-keep]').forEach(i => { values[i.dataset.logKeep] = Number(i.value); });
  let r;
  try { r = await apiFetch('/api/logs/keep', { method: 'POST', body: { values } }); } catch (e) { return appAlert(e.message); }
  const gone = Object.values(r.removed || {}).reduce((a, b) => a + b, 0);
  document.getElementById('log-keep-card').innerHTML = logKeepHtml(r);
  setStatus(document.getElementById('log-keep-status'), `✓ Saved${gone ? ` — ${gone.toLocaleString()} old entr${gone === 1 ? 'y' : 'ies'} removed` : ''}`, 'ok', { clear: 0 });
}
