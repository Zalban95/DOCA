/* ═══════════════════════════════════════════════════════
   Harness → Recipes (modules/recipes; TODO H3): what the agent got working
   once, run again without a model — through the same approvals as its own
   calls, in a conversation of its own. Keep the open conversation's last turn
   as one, run one (its steps are shown first), export it, delete it.
   ═══════════════════════════════════════════════════════ */

let _hcRecipes = [];

async function hcRecipesLoad() {
  const box = document.getElementById('hc-recipes');
  if (!box) return;
  try { _hcRecipes = (await apiFetch('/api/recipes')).recipes || []; }
  catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  box.innerHTML = _hcRecipes.map(r => `
    <div class="hc-agent" title="${escHtml(r.description || '')}">
      <span class="hc-agent-id">${escHtml(r.title)}</span>
      <span class="hc-agent-note">${r.steps.length} step${r.steps.length === 1 ? '' : 's'}${r.params.length ? ` · ${escHtml(r.params.map(p => p.name).join(', '))}` : ''} · r${r.revision}${r.proposed ? ` · <a href="#" onclick="hcRecipeReview(${jsArg(r.id)});return false" style="color:var(--amber)">r${r.proposed.revision} proposed</a>` : ''}</span>
      <button class="btn btn-xs btn-blue" onclick="hcRecipeRun(${jsArg(r.id)})" title="Run it">▶</button>
      <button class="btn btn-xs" onclick="hcScheduleNew(${jsArg(r.id)})" title="Run it on a timetable">⏰</button>
      <button class="btn btn-xs" onclick="hcRecipeExport(${jsArg(r.id)})" title="Export: JSON, or a script">⬇</button>
      <button class="btn btn-xs btn-red" onclick="hcRecipeDelete(${jsArg(r.id)})" title="Delete">✕</button>
    </div>`).join('') || '<div class="placeholder">None yet — when a turn got something working, keep it with ＋ last turn.</div>';
}

function hcRecipeKeep() {
  if (!_hcSession) return appAlert('Open a conversation first.');
  appPrompt('A name for what the last turn did:', async title => {
    try {
      const r = await apiFetch('/api/recipes/from-session', { method: 'POST', body: { sessionId: _hcSession, title } });
      appAlert(`Kept "${r.title}": ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}. To make a value a parameter, ask the agent to revise it (recipe save with the same id).`);
    } catch (e) { appAlert(e.message); }
    hcRecipesLoad();
  });
}

/** Ask for each parameter in turn (the default offered), then show the steps before anything runs. */
function hcRecipeRun(id) {
  const r = _hcRecipes.find(x => x.id === id);
  if (!r) return;
  const values = {};
  const ask = i => {
    if (i >= r.params.length) return confirmRun();
    const p = r.params[i];
    appPrompt(`${p.name}${p.description ? ` — ${p.description}` : ''}`, v => { values[p.name] = v; ask(i + 1); }, p.default || '');
  };
  const confirmRun = () => appConfirm(`Run "${r.title}"? Its steps, with your level and approvals:\n\n${r.steps.map((s, n) => `${n + 1}. ${s.tool} ${JSON.stringify(s.args).slice(0, 140)}`).join('\n')}`, async () => {
    try {
      const out = await apiFetch(`/api/recipes/${encodeURIComponent(id)}/run`, { method: 'POST', body: { values } });
      appConfirm(`${out.summary}\n\n${out.steps.map(s => `${s.n}. ${s.tool}: ${s.ok ? 'ok' : `failed — ${s.why}`}`).join('\n')}\n\nOpen its conversation?`, () => hcOpenSession(out.sessionId));
    } catch (e) { appAlert(e.message); }
  });
  ask(0);
}

/** A repaired revision the agent proposed (the recipe-repair experiment): read its steps, then accept or discard it. */
function hcRecipeReview(id) {
  const r = _hcRecipes.find(x => x.id === id);
  if (!r?.proposed) return;
  const steps = s => s.map((x, n) => `${n + 1}. ${x.tool} ${JSON.stringify(x.args).slice(0, 140)}`).join('\n');
  appChoose(`Revision ${r.proposed.revision} of "${r.title}", proposed after a failed run.\n\n${r.proposed.why || '(no reason given)'}\n\nNow:\n${steps(r.steps)}\n\nProposed:\n${steps(r.proposed.steps)}`,
    [{ label: 'Discard', value: 'discard', cls: 'btn-red' }, { label: 'Accept', value: 'accept', cls: 'btn-blue' }], async how => {
      try { await apiFetch(`/api/recipes/${encodeURIComponent(id)}/${how}`, { method: 'POST' }); } catch (e) { appAlert(e.message); }
      hcRecipesLoad();
    });
}

function hcRecipeExport(id) {
  appChoose('Export as', [{ label: 'JSON', value: 'json' }, { label: 'bash', value: 'bash' }, { label: 'PowerShell', value: 'powershell' }], async format => {
    try {
      const res = await fetch(`/api/recipes/${encodeURIComponent(id)}/export?format=${format}`);
      if (!res.ok) return appAlert((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || `${id}.${format}`;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { appAlert(e.message); }
  });
}

function hcRecipeDelete(id) {
  appConfirm('Delete this recipe? Its earlier revisions stay on disk.', async () => {
    try { await apiFetch(`/api/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    hcRecipesLoad();
  });
}
