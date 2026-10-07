/* ═══════════════════════════════════════════════════════
   Settings → Evaluations (modules/evals; TODO H10.1): sets of turns with
   checks, run against the configured model on a throwaway copy of the
   settings, and their results — what passed, what regressed since the run
   before. Export for promptfoo; import OpenAI Evals JSONL or DOCA's JSON.
   ═══════════════════════════════════════════════════════ */

let _evalsPoll = null;

async function evalsLoad() {
  const panel = document.getElementById('sp-evals');
  if (!panel) return;
  let d;
  try { d = await apiFetch('/api/evals'); } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const run = d.running && !d.running.done ? d.running : null;
  panel.innerHTML = `<div class="card"><div class="card-title">Evaluations</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">A set is turns with checks — what the answer must say, which tools it may or must not call, how many steps and
      tokens it may take, or a rubric a model judges. A run plays every case against the configured model on a throwaway copy of the settings (the live
      conversations and memory are never part of it) and spends that model's tokens. Run one after changing the model, the prompt, or a setting that shapes them.</p>
    ${run ? `<div style="font-size:12px;margin-bottom:6px">Running <b>${escHtml(run.set)}</b>: ${run.progress.length} done${run.progress.map(p => ` ${p.pass ? '✓' : '✗'}`).join('')}</div>` : ''}
    ${d.sets.map(s => `<div class="disk-row">
      <span class="disk-label">${escHtml(s.title)} <span style="color:var(--muted)">${escHtml(s.id)} · ${s.cases} cases${s.origin === 'shipped' ? '' : ' · yours'}</span></span>
      <span class="disk-path">${s.last ? `${s.last.passed}/${s.last.total} on ${escHtml(s.last.model)} · ${escHtml(new Date(s.last.startedAt).toLocaleString())}${s.last.regressed?.length ? ` · <span style="color:var(--red)">regressed: ${escHtml(s.last.regressed.join(', '))}</span>` : ''}` : 'never run'}</span>
      <span class="disk-free" style="display:flex;gap:4px">
        <button class="btn btn-xs" onclick="evalsShow(${jsArg(s.id)})">Results</button>
        <button class="btn btn-xs" onclick="evalsExport(${jsArg(s.id)})">Export</button>
        <button class="btn btn-xs btn-blue" onclick="evalsRun(${jsArg(s.id)})" ${run ? 'disabled' : ''}>Run</button></span></div>`).join('')}
    <div class="toolbar" style="margin-top:10px;gap:6px"><button class="btn btn-sm" onclick="evalsImport()">Import…</button></div>
    <div id="evals-detail" style="margin-top:10px"></div></div>`;
  clearTimeout(_evalsPoll);
  if (run) _evalsPoll = setTimeout(() => { if (document.getElementById('sp-evals')?.offsetParent) evalsLoad(); }, 3000);
}

function evalsRun(id) {
  appConfirm(`Run "${id}" against the configured model? It spends that model's tokens: every case is a full turn, and a judged check one more call.`, async () => {
    try { await apiFetch(`/api/evals/${encodeURIComponent(id)}/run`, { method: 'POST' }); } catch (e) { appAlert(e.message); }
    evalsLoad();
  });
}

async function evalsShow(id) {
  const el = document.getElementById('evals-detail');
  let d;
  try { d = await apiFetch(`/api/evals/${encodeURIComponent(id)}`); } catch (e) { el.textContent = e.message; return; }
  const r = d.results[0];
  if (!r) { el.innerHTML = '<div class="placeholder">Not run yet.</div>'; return; }
  el.innerHTML = `<div class="card-subtitle">${escHtml(d.set.title)} — ${r.passed}/${r.total} on ${escHtml(r.model)}, ${r.tokens} tokens · ${escHtml(new Date(r.startedAt).toLocaleString())}</div>
    ${r.cases.map(c => `<details style="font-size:12px;margin:4px 0"><summary>${c.pass ? '✓' : '<span style="color:var(--red)">✗</span>'} <b>${escHtml(c.id)}</b>
        <span style="color:var(--muted)">${c.steps ?? '?'} steps · ${c.tokens ?? '?'} tokens${c.tools.length ? ` · ${escHtml(c.tools.join(' → '))}` : ''}</span></summary>
      <div style="margin:4px 0 0 16px"><div style="color:var(--muted)">${escHtml(c.prompt)}</div>
        ${c.checks.map(k => `<div>${k.pass ? '✓' : '✗'} ${escHtml(k.why)}</div>`).join('')}
        <pre class="terminal" style="white-space:pre-wrap;max-height:180px;margin-top:4px">${escHtml(c.text || c.error || '')}</pre></div></details>`).join('')}
    ${d.results.length > 1 ? `<div class="harness-hint">Earlier: ${d.results.slice(1).map(x => `${x.passed}/${x.total} (${escHtml(new Date(x.startedAt).toLocaleDateString())})`).join(' · ')}</div>` : ''}`;
}

function evalsExport(id) {
  appChoose('Export as', [{ label: 'DOCA JSON', value: 'json' }, { label: 'promptfoo YAML', value: 'promptfoo' }], async format => {
    const res = await fetch(`/api/evals/${encodeURIComponent(id)}/export?format=${format}`);
    if (!res.ok) return appAlert(`HTTP ${res.status}`);
    const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || `${id}.json`;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

function evalsImport() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,.jsonl' });
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    const text = await f.text();
    const jsonl = /\.jsonl$/i.test(f.name);
    const id = f.name.replace(/\.(eval\.)?jsonl?$/i, '').replace(/[^\w-]/g, '-').slice(0, 60) || 'imported';
    try {
      const r = await apiFetch('/api/evals/import', { method: 'POST', body: jsonl ? { format: 'openai-evals', text, id } : { text } });
      appAlert(`Imported "${r.set.id}": ${r.set.cases.length} cases${r.skipped ? `, ${r.skipped} lines skipped` : ''}.`);
    } catch (e) { appAlert(e.message); }
    evalsLoad();
  };
  input.click();
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-evals' })));
