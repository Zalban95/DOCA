/* ═══════════════════════════════════════════════════════
   Settings → Harness → Guards (modules/harness/guard/): the classifiers that
   read what comes in from outside, and the scout's reports, before an agent
   does. Several at once; text is clean only if every guard says so.
   docs/design/airlock.md.
   ═══════════════════════════════════════════════════════ */

function guardsCardRender(panel) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'doca-guards-card';
  card.innerHTML = `<div class="card-title">Guards</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">What the agents read from outside passes these first. Text is
      <b>clean</b> only if every guard switched on agrees; <b>blocked</b> parts are withheld and logged, <b>suspicious</b> ones are
      passed on with a warning. Nobody is asked.</p>
    <div id="guards-runtime"></div>
    <div id="guards-list"><div class="placeholder pulse">Loading…</div></div>
    <div class="guards-add">
      <select class="input" id="guards-preset"></select>
      <button class="btn btn-sm" onclick="guardsAddPreset()">+ Add</button>
      <button class="btn btn-sm" onclick="guardsAddCustom()" title="Another Hugging Face ONNX classifier, or a provider's model">+ Custom…</button>
    </div>
    <div class="input-label" style="margin-top:12px">Test on text</div>
    <textarea class="input" id="guards-test-text" rows="3" placeholder="Paste a page, a message, anything — see what the guards make of it."></textarea>
    <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
      <button class="btn btn-sm" onclick="guardsTest()">Test</button>
      <span id="guards-test-out" style="font-size:11px"></span>
    </div>
    <details style="margin-top:12px" ontoggle="if(this.open)guardsLog()"><summary class="input-label" style="cursor:pointer">Blocked and flagged</summary>
      <div id="guards-log" style="font-size:11px"></div></details>`;
  panel.appendChild(card);
  guardsLoad();
}

let _guardsState = null;

async function guardsLoad() {
  const list = document.getElementById('guards-list');
  if (!list) return;
  try { _guardsState = await apiFetch('/api/harness/guards'); } catch (e) { list.textContent = e.message; return; }
  const s = _guardsState;
  document.getElementById('guards-runtime').innerHTML = s.runtime
    ? '<div class="settings-tab-row"><span class="settings-tab-label">✓ Model runtime installed (transformers.js, in DOCA\'s data folder)</span></div>'
    : `<div class="settings-tab-row"><button class="btn btn-sm" id="guards-install" onclick="guardsInstall()">Install model runtime</button>
        <span class="settings-tab-label">Needed for model guards: about 740 MB, once, into DOCA's data folder — no sudo, nothing global.</span></div>`;
  const sel = document.getElementById('guards-preset');
  const have = new Set(s.guards.map(g => g.id));
  sel.innerHTML = Object.entries(s.presets).filter(([id]) => !have.has(id))
    .map(([id, p]) => `<option value="${escHtml(id)}">${escHtml(p.label)} · ${escHtml(p.size)}</option>`).join('') || '<option value="">All presets added</option>';
  list.innerHTML = '';
  for (const g of s.guards) list.appendChild(_guardRow(g, s));
}

function _guardRow(g, s) {
  const row = document.createElement('div');
  row.className = 'guard-row';
  const what = g.kind === 'rules' ? 'patterns, always available' : g.kind === 'endpoint' ? `asks ${g.provider}/${g.model}`
    : `${g.repo}${g.size ? ` · ${g.size}` : ''}${g.licence ? ` · ${g.licence}` : ''}`;
  row.innerHTML = `
    <label class="guard-on" title="${g.ready ? 'Screen with this guard' : 'Download it first'}"><input type="checkbox" ${g.enabled ? 'checked' : ''} ${g.ready ? '' : 'disabled'}>
      <span><b>${escHtml(g.label || g.id)}</b><br><small>${escHtml(what)}${g.note ? ` — ${escHtml(g.note)}` : ''}</small></span></label>
    <div class="guard-thr">
      <label title="At or above: passed on with a warning">suspect ≥ <input class="input" type="number" min="0.01" max="1" step="0.01" data-k="suspectAt" value="${g.suspectAt}"></label>
      <label title="At or above: withheld and logged">block ≥ <input class="input" type="number" min="0.01" max="1" step="0.01" data-k="blockAt" value="${g.blockAt}"></label>
    </div>
    <div class="guard-act"></div>`;
  const act = row.querySelector('.guard-act');
  if (g.kind === 'model' && !g.ready) {
    const b = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: s.runtime ? '⬇ Download' : 'needs runtime' });
    b.disabled = !s.runtime;
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Downloading…';
      try { await apiFetch(`/api/harness/guards/${encodeURIComponent(g.id)}/download`, { method: 'POST' }); guardsLoad(); }
      catch (e) { appAlert(e.message); b.disabled = false; b.textContent = '⬇ Download'; }
    };
    act.appendChild(b);
  }
  if (g.id !== 'rules') {
    const del = Object.assign(document.createElement('button'), { className: 'btn btn-xs btn-red', textContent: '✕', title: 'Remove this guard' });
    del.onclick = () => appConfirm(`Remove the guard "${g.label || g.id}"? Its downloaded files stay in the data folder.`, async () => {
      try { await apiFetch(`/api/harness/guards/${encodeURIComponent(g.id)}`, { method: 'DELETE' }); guardsLoad(); } catch (e) { appAlert(e.message); }
    });
    act.appendChild(del);
  }
  const save = async body => {
    try { await apiFetch(`/api/harness/guards/${encodeURIComponent(g.id)}`, { method: 'POST', body }); guardsLoad(); }
    catch (e) { appAlert(e.message); guardsLoad(); }
  };
  row.querySelector('.guard-on input').onchange = e => save({ enabled: e.target.checked });
  for (const inp of row.querySelectorAll('.guard-thr input')) inp.onchange = () => save({ [inp.dataset.k]: Number(inp.value) });
  return row;
}

async function guardsInstall() {
  const b = document.getElementById('guards-install');
  if (b) { b.disabled = true; b.textContent = 'Installing… (a few minutes)'; }
  try { await apiFetch('/api/harness/guards/runtime/install', { method: 'POST' }); } catch (e) { appAlert(e.message); }
  guardsLoad();
}

async function guardsAddPreset() {
  const id = document.getElementById('guards-preset')?.value;
  if (!id) return;
  try { await apiFetch('/api/harness/guards', { method: 'POST', body: { preset: id } }); guardsLoad(); } catch (e) { appAlert(e.message); }
}

function guardsAddCustom() {
  appPrompt('A Hugging Face ONNX classifier as owner/repo (with onnx/model.onnx), or provider/model of an endpoint as endpoint:provider/model', async v => {
    const spec = v.startsWith('endpoint:')
      ? (() => { const [provider, ...m] = v.slice(9).split('/'); return { kind: 'endpoint', provider, model: m.join('/'), id: `ep-${m.join('-')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40), label: `Endpoint ${v.slice(9)}` }; })()
      : { kind: 'model', repo: v, id: v.split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40), label: v };
    try { await apiFetch('/api/harness/guards', { method: 'POST', body: spec }); guardsLoad(); } catch (e) { appAlert(e.message); }
  });
}

async function guardsTest() {
  const out = document.getElementById('guards-test-out');
  const text = document.getElementById('guards-test-text')?.value || '';
  if (!text.trim()) return;
  out.textContent = 'Screening…';
  try {
    const r = await apiFetch('/api/harness/guards/test', { method: 'POST', body: { text } });
    const by = [...new Set(r.chunks.flatMap(c => c.by.map(b => b.error ? `${b.guard}: ${b.error}` : `${b.guard} ${b.score}`)))];
    out.innerHTML = `<b style="color:${r.verdict === 'clean' ? 'var(--green)' : r.verdict === 'blocked' ? 'var(--red)' : 'var(--amber)'}">${r.verdict}</b>`
      + ` · guards: ${escHtml(r.guards.join(', ') || 'none on')}${by.length ? ` · ${escHtml(by.join('; '))}` : ''}`;
  } catch (e) { out.textContent = e.message; }
}

async function guardsLog() {
  const box = document.getElementById('guards-log');
  try {
    const { log } = await apiFetch('/api/harness/guards/log?n=30');
    box.innerHTML = log.length ? '' : '<div class="placeholder">Nothing withheld or flagged yet.</div>';
    for (const e of log) {
      const d = document.createElement('div');
      d.className = 'guard-log-row';
      d.textContent = `${e.at.replace('T', ' ').slice(0, 16)} · ${e.direction} · ${e.verdict} · ${e.source || ''} — ${(e.chunks[0]?.excerpt || '').slice(0, 160)}`;
      box.appendChild(d);
    }
  } catch (e) { box.textContent = e.message; }
}
