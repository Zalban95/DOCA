/* ═══════════════════════════════════════════════════════
   How a conversation's turns went (modules/harness/trace.js; TODO H10.1):
   its recent runs, and for one run every model request and tool call in
   order with its time, tokens and outcome — a waterfall — plus the approvals,
   waits and folds between them. Names and numbers only; the conversation's
   words stay in the transcript. "OTLP" downloads it for Jaeger, Tempo or
   Langfuse. Opened from ⏱ on the conversation bar.
   ═══════════════════════════════════════════════════════ */

function traceOpen(sessionId, runId) {   // runId: open on that run (Chronicle) rather than the latest
  let overlay = document.getElementById('trace-overlay');
  if (!overlay) {
    overlay = Object.assign(document.createElement('div'), { id: 'trace-overlay', className: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    overlay.innerHTML = `<div class="modal" style="max-width:980px;width:96vw">
      <div class="modal-title">Trace</div>
      <div id="trace-runs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"></div>
      <div id="trace-body" style="overflow-x:auto;max-height:65vh;overflow-y:auto"></div>
      <small class="harness-hint">Each model request (who answered, how long, tokens in and out, how many messages and tools it carried, a fingerprint
        of the system prompt it was sent) and each tool call (how long, how much came back, whether it failed). Names and numbers — never the conversation's words.</small>
      <div class="toolbar-right mt8"><button class="btn btn-xs" id="trace-otlp">OTLP</button><button class="btn btn-xs" id="trace-close">close</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#trace-close').onclick = () => { overlay.style.display = 'none'; };
  }
  overlay.style.display = 'flex';
  traceRuns(sessionId, runId);
}

async function traceRuns(sessionId, runId) {
  const runsEl = document.getElementById('trace-runs'), body = document.getElementById('trace-body');
  let runs = [];
  try { runs = (await apiFetch(`/api/harness/runs?sessionId=${encodeURIComponent(sessionId)}&limit=12`)).runs || []; }
  catch (e) { body.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  if (!runs.length) { runsEl.innerHTML = ''; body.innerHTML = '<div class="placeholder">No turns recorded in this conversation yet.</div>'; return; }
  runsEl.innerHTML = runs.map((r, i) => `<button class="btn btn-xs" data-run="${escHtml(r.id)}" title="${escHtml(r.state)}">${escHtml(new Date(r.startedAt).toLocaleTimeString())}
    · ${r.steps ?? '?'} steps${r.state === 'done' ? '' : ` · ${escHtml(r.state)}`}${i === 0 ? ' (latest)' : ''}</button>`).join('');
  runsEl.querySelectorAll('button').forEach(b => { b.onclick = () => traceShow(b.dataset.run); });
  traceShow(runId || runs[0].id);
}

async function traceShow(runId) {
  const body = document.getElementById('trace-body');
  document.querySelectorAll('#trace-runs button').forEach(b => b.classList.toggle('btn-blue', b.dataset.run === runId));
  document.getElementById('trace-otlp').onclick = async () => {
    const res = await fetch(`/api/harness/runs/${encodeURIComponent(runId)}/trace?format=otlp`);
    if (!res.ok) return appAlert(`HTTP ${res.status}`);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: `${runId}.otlp.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  let t;
  try { t = await apiFetch(`/api/harness/runs/${encodeURIComponent(runId)}/trace`); } catch (e) { body.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const spans = t.spans || [];
  if (!spans.length) { body.innerHTML = '<div class="placeholder">This turn has no trace (tracing was off, or it ran before 2.182.0).</div>'; return; }
  const max = Math.max(1, ...spans.map(s => s.ms || 0));
  const fmt = n => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
  const what = s => {
    const d = s.data || {};
    if (s.kind === 'model') return `${escHtml(s.name)} · in ${d.prompt ?? `~${d.estimate ?? '?'}`}${d.cached ? ` (${d.cached} cached)` : ''} · out ${d.completion ?? '?'} · ${d.messages} msgs · ${d.tools} tools · sys ${escHtml(d.system || '')}${d.calls?.length ? ` → ${escHtml(d.calls.join(', '))}` : ''}${d.finish && d.finish !== 'stop' && d.finish !== 'tool_calls' ? ` · ${escHtml(d.finish)}` : ''}`;
    if (s.kind === 'tool') return `${escHtml(s.name)}(${escHtml((d.args || []).join(', '))}) · ${d.chars} chars${d.failure ? ` · <span style="color:var(--red)">${escHtml(d.failure)}</span>` : ''}`;
    return `${escHtml(s.name || '')} ${escHtml(JSON.stringify(s.data || {}).slice(0, 160))}`;
  };
  body.innerHTML = `<table class="data-table" style="width:100%;font-size:11px"><thead><tr><th>step</th><th>kind</th><th style="width:28%">time</th><th>what</th></tr></thead><tbody>
    ${spans.map(s => `<tr><td>${s.step ?? ''}</td><td>${escHtml(s.kind)}</td>
      <td>${s.ms != null ? `<div style="display:flex;align-items:center;gap:6px"><div style="height:8px;background:${s.kind === 'model' ? 'var(--blue)' : 'var(--green)'};width:${Math.max(2, Math.round(100 * s.ms / max))}%;border-radius:2px"></div><span style="white-space:nowrap">${fmt(s.ms)}</span></div>` : ''}</td>
      <td>${what(s)}</td></tr>`).join('')}</tbody></table>
    <div class="harness-hint" style="margin-top:6px">${escHtml(t.run.state)} · ${t.run.steps ?? '?'} steps · ${t.run.tokens ?? '?'} tokens · model ${fmt(spans.filter(s => s.kind === 'model').reduce((n, s) => n + (s.ms || 0), 0))} · tools ${fmt(spans.filter(s => s.kind === 'tool').reduce((n, s) => n + (s.ms || 0), 0))}</div>`;
}
