/* Settings → System → Features (modules/features; CONSTITUTION §0 and W14): every feature ever built, where it is and
   how it is switched on — the same index the agent reads with its `features` tool — and the alternatives kept beside
   what replaced them, with how much each is used. An unused one can be hidden from the default: it keeps working and
   the agents still find it; nothing here removes a feature. A host's. */
let _featuresData = null;

async function featuresRender() {
  const panel = document.querySelector('#sp-system .scroll-y') || document.getElementById('sp-system');
  if (!panel || (typeof authHasRight === 'function' && !authHasRight('host'))) return;
  try { _featuresData = await apiFetch('/api/features'); } catch { return; }
  document.getElementById('features-card')?.remove();
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'features-card' });
  card.innerHTML = `<div class="card-title">Features</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Everything DOCA can do, where it is and how it is switched on — the index the agents read
      when they look for a way to do something. Nothing built is ever removed.</p>
    <input type="search" class="input" id="features-find" placeholder="Find a feature…" oninput="featuresFilter(this.value)" style="width:100%;margin-bottom:8px">
    <div id="features-list" style="max-height:340px;overflow:auto"></div>
    <div class="card-title" style="margin-top:12px;font-size:13px">Alternatives kept beside their replacements</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">How often each older or other way was used. One unused while what replaced it kept running
      can be hidden from the default: it still works and the agents still find it.</p>
    <div id="features-review" style="max-height:340px;overflow:auto">${featuresReviewHtml(_featuresData.review)}</div>`;
  panel.append(card);
  featuresFilter('');
}

function featuresFilter(q) {
  const list = document.getElementById('features-list');
  if (!list || !_featuresData) return;
  const want = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = _featuresData.features.filter(f => {
    const text = [f.id, f.name, f.use, f.words || '', ...f.tools, ...f.settings, ...f.pageLabels].join(' ').toLowerCase();
    return want.every(w => text.includes(w));
  });
  const state = f => f.state === 'experiment' ? `experiment ${f.flag}` : f.hidden ? 'hidden from the default' : _featuresData.states[f.state];
  list.innerHTML = rows.length ? rows.map(f => `<div class="tool-row" style="grid-template-columns:1fr auto;align-items:start">
      <span><b style="font-size:12px">${escHtml(f.name)}</b> <span class="tool-note" style="white-space:normal">${escHtml(f.use)}</span>
        <span class="tool-note" style="display:block;white-space:normal">${escHtml([f.pageLabels.join(', '), f.tools.join(', ')].filter(Boolean).join(' · '))}</span></span>
      <span class="tool-note">${escHtml(state(f))}</span></div>`).join('')
    : '<div class="placeholder" style="font-size:12px">No feature matches.</div>';
}

function featuresReviewHtml(rows) {
  const row = r => `<div class="tool-row" style="grid-template-columns:1fr auto;align-items:center">
      <span><b style="font-size:12px">${escHtml(r.name)}</b> <span class="tool-note">beside ${escHtml(r.besideName)} · used ${r.uses}×${r.last ? `, last ${escHtml(r.last.slice(0, 10))}` : ''}</span>
        <span class="tool-note" style="display:block;white-space:normal${r.candidate ? ';color:var(--amber)' : ''}">${escHtml(r.recommendation)}</span></span>
      <span class="tool-actions"><button class="btn btn-xs" onclick="featureHide(${jsArg(r.id)}, ${!r.hidden})">${r.hidden ? 'Show again' : 'Hide from default'}</button></span></div>`;
  const shown = rows.filter(r => !r.hidden), hidden = rows.filter(r => r.hidden);
  return shown.map(row).join('') + (hidden.length ? `<details style="margin-top:6px"><summary style="font-size:12px;cursor:pointer">Hidden from the default (${hidden.length})</summary>${hidden.map(row).join('')}</details>` : '');
}

async function featureHide(id, on) {
  try { await apiFetch(`/api/features/${encodeURIComponent(id)}/hidden`, { method: 'POST', body: { on } }); }
  catch (e) { appAlert(e.message); }
  featuresRender();
}
