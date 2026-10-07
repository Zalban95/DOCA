/* ═══════════════════════════════════════════════════════
   Settings → General → Your panel (modules/panel-layout; TODO P1.2): what a
   person changed about the panel — by asking the agent or here — layer by
   layer, with Undo and a way back to the default in one click each. Theirs
   on every device; this screen may keep its own on top; the default for
   everyone is an admin's. A layout downloads as a file and loads from one.
   ═══════════════════════════════════════════════════════ */

const _YP_NAMES = { person: ['Yours', 'on every device of yours'], screen: ['This screen', 'over yours, here only'], install: ['Everyone\'s default', 'what every person starts from (an admin\'s)'] };

async function yourPanelCard() {
  const anchor = document.getElementById('settings-tabs-list')?.closest('.card');
  if (!anchor) return;
  let card = document.getElementById('your-panel-card');
  if (!card) { card = Object.assign(document.createElement('div'), { id: 'your-panel-card', className: 'card' }); anchor.after(card); }
  let r;
  try { r = await apiFetch(`/api/screen/layout${_screenQ()}`); } catch (e) { card.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  const scopes = ['person', 'screen', ...(r.host ? ['install'] : [])];
  const scale = r.layers.person?.style?.fontScale || 1, density = r.layers.person?.style?.density || 'normal';
  card.innerHTML = `<div class="card-title">Your panel</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">How the panel is laid out is yours: ask the agent — "put Workstream first", "hide Models",
      "make me a page with the Workstream and the Harness", "bigger text" — or change it here. It is kept as your data, never as a change to DOCA, so it stays through every update.</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;font-size:12px">
      <label>Text size <select class="input" onchange="yourPanelStyle({fontScale: Number(this.value)})">${[0.9, 1, 1.15, 1.3, 1.5].map(v => `<option value="${v}" ${v === scale ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}</select></label>
      <label>Spacing <select class="input" onchange="yourPanelStyle({density: this.value})">${['compact', 'normal', 'roomy'].map(v => `<option ${v === density ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    ${scopes.map(s => `<div class="settings-tab-row" style="align-items:flex-start;gap:10px;padding:6px 0;border-top:1px solid var(--border)">
      <div style="flex:1;min-width:0"><b>${_YP_NAMES[s][0]}</b> <span style="color:var(--muted);font-size:11px">— ${_YP_NAMES[s][1]}</span>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">${(r.lines[s] || []).map(escHtml).join('<br>') || 'As shipped.'}</div></div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn btn-xs" ${r.undo[s] ? '' : 'disabled'} onclick="yourPanelDo('undo', '${s}')" title="Put back what the last change replaced">Undo${r.undo[s] ? ` (${r.undo[s]})` : ''}</button>
        <button class="btn btn-xs" ${(r.lines[s] || []).length ? '' : 'disabled'} onclick="yourPanelDo('reset', '${s}')" title="Back to the panel as shipped (Undo brings it back)">Reset</button>
        ${s === 'person' ? `<button class="btn btn-xs" onclick="yourPanelExport()" title="Download your layout as a file">⤓</button>
          <button class="btn btn-xs" onclick="yourPanelImport()" title="Load a layout from a file">⤒</button>` : ''}
      </div></div>`).join('')}
    <div id="your-panel-status" style="font-size:11px;margin-top:6px"></div>`;
  card.dataset.layers = JSON.stringify(r.layers);
}

async function _yourPanelSend(path, body) {
  try {
    await apiFetch(`/api/screen/layout${path}${_screenQ()}`, { method: 'POST', body });
    await panelLayoutLoad();
    settingsHiddenApply();
    await yourPanelCard();
    setStatus(document.getElementById('your-panel-status'), '✓ Saved', 'ok');
  } catch (e) { setStatus(document.getElementById('your-panel-status'), `✗ ${e.message}`, 'err'); }
}

function yourPanelStyle(style) { return _yourPanelSend('', { scope: 'person', ops: [{ op: 'style', ...style }] }); }

function yourPanelDo(what, scope) {
  return what === 'undo' ? _yourPanelSend('/undo', { scope }) : _yourPanelSend('', { scope, ops: [{ op: 'reset' }] });
}

function yourPanelExport() {
  const layers = JSON.parse(document.getElementById('your-panel-card')?.dataset.layers || '{}');
  const blob = new Blob([JSON.stringify({ format: 'doca-panel-layout', version: 1, layout: layers.person || {} }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'panel-layout.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function yourPanelImport() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    try {
      const doc = JSON.parse(await input.files[0].text());
      await _yourPanelSend('', { scope: 'person', layout: doc.format === 'doca-panel-layout' ? doc.layout : doc });   // the hub keeps only what this panel has
    } catch (e) { setStatus(document.getElementById('your-panel-status'), `✗ ${e.message}`, 'err'); }
  };
  input.click();
}
