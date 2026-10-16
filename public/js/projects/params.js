/* ═══════════════════════════════════════════════════════
   Projects → Parameters: the project's project.params.json as a form
   (modules/params). Groups are cards, `advanced` values fold under
   Advanced (marked "changed" against their default), units sit after each
   box, a colour gets a picker; ranges are checked here and by the hub.
   Save writes the values and builds at once, with no model, as the person
   who saved; below, where the build is, whether the deliverables are built
   from the current values, each stage's files and checks.
   ═══════════════════════════════════════════════════════ */

const PJP = { data: null, timer: null, off: null };

function _pjpBox(p, may) {
  const id = `pjp-${p.name}`;
  const dis = may ? '' : ' disabled';
  const common = `id="${id}" data-param="${escHtml(p.name)}" data-type="${escHtml(p.type)}" data-default="${escHtml(String(p.default ?? ''))}" data-label="${escHtml(p.label)}"${dis}`;
  const input = p.oneOf ? `<select class="input" ${common}>${p.oneOf.map(o => `<option${o === p.value ? ' selected' : ''}>${escHtml(o)}</option>`).join('')}</select>`
    : p.type === 'boolean' ? `<input type="checkbox" ${common}${p.value ? ' checked' : ''}>`
    : p.type === 'color' ? `<input type="color" ${common} value="${escHtml(String(p.value || '#000000'))}">`
    : `<input class="input" ${common} ${['number', 'integer'].includes(p.type) ? `type="number"${p.min != null ? ` min="${p.min}"` : ''}${p.max != null ? ` max="${p.max}"` : ''} step="${p.step ?? (p.type === 'integer' ? 1 : 'any')}" style="width:120px"` : 'type="text" style="width:240px"'} value="${escHtml(String(p.value ?? ''))}">`;
  const range = p.min != null || p.max != null ? ` ${p.min ?? '…'}–${p.max ?? '…'}${p.unit ? ` ${p.unit}` : ''}.` : '';
  const hint = `${p.hint || ''}${range} Default: ${JSON.stringify(p.default)}${p.unit ? ` ${p.unit}` : ''}.${p.lock ? ' Locked: yours to change, never an agent\'s.' : ''}`.trim();
  return `<div class="field pjp-field"><label class="input-label" for="${id}">${escHtml(p.label)}${p.lock ? ' 🔒' : ''}${infoBtn(hint)}</label>
    <span class="pjp-box">${input}${p.unit ? `<span class="pjp-unit">${escHtml(p.unit)}</span>` : ''}</span></div>`;
}

function _pjpState(d) {
  const b = d.build || {};
  const run = b.running ? `<div class="pjp-run"><span class="pt pt-run" aria-hidden="true"></span> Building — stage ${b.running.done + 1} of ${b.running.of}${b.running.stage ? ` (${escHtml(b.running.stage)})` : ''}. Every stage counts the same.</div>` : '';
  const proof = b.built ? `<div class="pjp-proof ${b.built.ok ? 'ok' : 'no'}">${b.built.ok ? '✓' : '✗'} ${escHtml(b.built.ok ? b.built.why : `Not built from the current values: ${b.built.why}`)}</div>` : '';
  const stages = (b.stages || []).map(s => `<div class="pjp-stage ${s.ok ? 'ok' : 'no'}"><b>${escHtml(s.id)}</b> ${s.skipped ? 'unchanged, not run again' : s.ok ? `done in ${(s.ms / 1000).toFixed(1)} s` : `stopped: ${escHtml(s.why || '')}`}
    ${s.outputs.length ? `<div class="desc">${s.outputs.map(escHtml).join(' · ')}</div>` : ''}${s.checks.map(c => `<div class="desc">${c.ok ? '✓' : '✗'} ${escHtml(c.why || '')}</div>`).join('')}</div>`).join('');
  const derived = Object.entries(b.derived || {});
  return `${run}${proof}${stages}${derived.length ? `<div class="pjp-derived"><div class="input-label">Worked out by the build</div>${derived.map(([k, v]) => `<div class="desc">${escHtml(k)} = ${escHtml(JSON.stringify(v))}</div>`).join('')}</div>` : ''}`;
}

async function pjParamsRender(body) {
  clearTimeout(PJP.timer);
  body.innerHTML = '<div class="placeholder">Reading the parameters…</div>';
  let d;
  try { d = await apiFetch(_pjp('/params')); } catch (e) { body.innerHTML = `<div class="placeholder">✗ ${escHtml(e.message)}</div>`; return; }
  PJP.data = d;
  if (!d.exists) {
    body.innerHTML = emptyStateHtml({ title: 'No parameters yet', text: `A project that builds deliverables keeps every value a person might change in ${d.file} at its root — each with a type, a default and a range — and its scripts and templates read them from there. Ask the agent to make this project parametric.` });
    return;
  }
  const may = !!d.mayWork;
  const groups = (d.groups || []).map(g => {
    const mine = (d.params || []).filter(p => (p.group || '') === g.id);
    if (!mine.length) return '';
    const common = mine.filter(p => !p.advanced), adv = mine.filter(p => p.advanced);
    return `<div class="card pjp-group"><div class="card-title">${escHtml(g.label)}</div>${common.map(p => _pjpBox(p, may)).join('')}
      ${adv.length ? advancedFold(adv.map(p => _pjpBox(p, may)).join(''), { id: `pjp-${PJ.project.project.id}-${g.id}` }) : ''}</div>`;
  }).join('');
  body.innerHTML = `${d.title ? `<div class="pjp-title">${escHtml(d.title)}</div>` : ''}
    ${d.errors.length ? `<div class="pjp-errors">${d.errors.map(e => `<div>✗ ${escHtml(e)}</div>`).join('')}</div>` : ''}
    ${groups}
    <div class="toolbar pjp-actions">${may ? `<button class="btn btn-sm btn-primary" onclick="pjParamsSave()" title="Write the values and build from them">Save and build</button>
      <button class="btn btn-sm" onclick="pjParamsBuild()" title="Build from the values as they are">Build</button>` : `<span class="desc">Shared with you to see: ask its owner to work on it.</span>`}<span class="status-line" id="pjp-status"></span></div>
    <div class="pjp-state" id="pjp-state">${_pjpState(d)}</div>`;
  if (typeof advancedFoldRefresh === 'function') advancedFoldRefresh(body);
  _pjpFollow();
}

/** While a build runs: its state redrawn when the hub says so (the live feed), and every 2 s in case it does not. */
function _pjpFollow() {
  clearTimeout(PJP.timer);
  if (!PJP.off && typeof liveOn === 'function') PJP.off = liveOn('project', c => { if (PJ.project && c.id === PJ.project.project.id) _pjpRefreshState(); });
  if (PJP.data?.build?.running) PJP.timer = setTimeout(_pjpRefreshState, 2000);
}

async function _pjpRefreshState() {
  if (!PJ.project || PJ.view !== 'params') return;
  try { PJP.data.build = await apiFetch(_pjp('/params/build')); } catch { return; }
  const el = document.getElementById('pjp-state');
  if (el) el.innerHTML = _pjpState(PJP.data);
  _pjpFollow();
}

function _pjpValues() {
  const values = {};
  for (const f of document.querySelectorAll('#pj-side-body [data-param]')) {
    const t = f.dataset.type;
    let v = f.type === 'checkbox' ? f.checked : f.value;
    if (['number', 'integer'].includes(t)) {
      v = Number(String(v).trim());
      if (!Number.isFinite(v) || (t === 'integer' && !Number.isInteger(v))) return askFor(f, `${f.dataset.label} is a ${t === 'integer' ? 'whole ' : ''}number.`);
      if (f.min !== '' && v < Number(f.min)) return askFor(f, `${f.dataset.label} is at least ${f.min}.`);
      if (f.max !== '' && v > Number(f.max)) return askFor(f, `${f.dataset.label} is at most ${f.max}.`);
    }
    values[f.dataset.param] = v;
  }
  return values;
}

/** A build changed since this person last ran it: its diff shown, and a yes needed before it runs (params/stamp.js). */
function _pjpAccept(e, again) {
  const ch = e.data?.change || {};
  const lines = [...(ch.diff || []).slice(0, 30), ...(ch.scripts?.length ? [`scripts changed: ${ch.scripts.join(', ')}`] : [])];
  appConfirm(`${e.message}\n\n${lines.join('\n')}\n\nRun the build as it is now?`, () => again(true));
}

async function pjParamsSave(acceptBuild = false) {
  const values = _pjpValues();
  if (!values) return;
  const st = document.getElementById('pjp-status');
  setStatus(st, 'Saving…', 'info');
  try {
    const r = await apiFetch(_pjp('/params'), { method: 'POST', body: { values, ifMatch: PJP.data?.hash, acceptBuild } });
    setStatus(st, r.changes.length ? `✓ Saved ${r.changes.length} value(s)${r.build ? ', building' : ''}` : r.build ? '✓ Building' : '✓ Nothing changed', 'ok');
    PJP.data = r.params;
    await pjParamsRender(document.getElementById('pj-side-body'));
  } catch (e) {
    if (e.code === 'build_changed') return _pjpAccept(e, yes => pjParamsSave(yes));
    if (e.code === 'stale') { setStatus(st, '✗ Changed since you opened it — showing the values now', 'err'); return pjParamsRender(document.getElementById('pj-side-body')); }
    setStatus(st, `✗ ${e.message}`, 'err');
  }
}

async function pjParamsBuild(acceptBuild = false) {
  const st = document.getElementById('pjp-status');
  try {
    await apiFetch(_pjp('/params/build'), { method: 'POST', body: { acceptBuild } });
    setStatus(st, '✓ Building', 'ok');
    _pjpRefreshState();
  } catch (e) {
    if (e.code === 'build_changed') return _pjpAccept(e, yes => pjParamsBuild(yes));
    setStatus(st, `✗ ${e.message}`, 'err');
  }
}
