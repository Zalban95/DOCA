/* Settings → Voice → Voice (voice-card.js): which voice services are on (asked 2026-10-08: "that also manages which
   models are switched on"). Beside each chosen service, a point — running or stopped — and when stopped "Start it",
   through the Services route (POST /api/services/start, the same start as Field → Models → Inference Services, with the
   GPU saved there), with what starting it needs from the row. Under the card, a voice service that runs while no voice
   uses it, with Stop — asked first, naming what uses it (lib/machine-ask.js). GET /api/services/voices
   (modules/voice-services.js) says all of it; an admin's, so a member sees the voices without the machines. */

/** The services row an engine speaks through ('' is the hive's speech service, where it is one here). */
function _vcRowOf(engine) {
  const d = _vc.services;
  if (!d || String(engine).startsWith('hosted:')) return null;
  const id = engine ? engine : d.hive?.row;
  return id ? d.services.find(s => s.id === id) || null : null;
}

/** The point and, when it is stopped, "Start it" — for a chosen engine. */
function voiceCardState(engine) {
  if (!_vc.services) return '';
  if (String(engine).startsWith('hosted:')) return '<div class="vc-state"><span class="vc-dot on"></span>a service, reached over the internet</div>';
  const row = _vcRowOf(engine);
  if (!row) {
    if (engine || !_vc.services.hive) return '';
    const up = _vc.services.hive.running;
    return `<div class="vc-state"><span class="vc-dot ${up ? 'on' : ''}"></span>${up ? 'answering' : 'not answering'} at ${escHtml(_vcHostOf(_vc.services.hive.url))}</div>`;
  }
  if (row.running) return `<div class="vc-state"><span class="vc-dot on"></span>${escHtml(row.label)} is running</div>`;
  return `<div class="vc-state"><span class="vc-dot"></span>${escHtml(row.label)} is stopped
    <button class="btn btn-xs btn-teal" id="vc-start-${escHtml(row.id)}" onclick="voiceCardStart(${jsArg(row.id)})">Start it</button>
    <span class="vc-needs">${escHtml(row.needs)}</span></div>`;
}

const _vcHostOf = url => { try { return new URL(url).host; } catch { return url || ''; } };

/** A voice service running with no voice using it: listed, with a Stop that asks first. */
function voiceCardUnused() {
  const d = _vc.services;
  const idle = (d?.services || []).filter(s => (d.unused || []).includes(s.id));
  if (!idle.length) return '';
  return `<div class="vc-unused" style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
    ${idle.map(s => `<div class="vc-state"><span class="vc-dot on"></span>${escHtml(s.label)} — running, not used by any voice
      <button class="btn btn-xs" onclick="voiceCardStop(${jsArg(s.id)}, ${jsArg(s.label)})">Stop</button></div>`).join('')}</div>`;
}

/** Start it: the Services route, with the GPU and model saved for that row; the card is drawn again when it answers. */
async function voiceCardStart(id) {
  const row = _vc.services?.services.find(s => s.id === id);
  if (!row) return;
  const btn = document.getElementById(`vc-start-${id}`);
  const status = document.getElementById('vc-status');
  if (btn) btn.disabled = true;
  setStatus(status, `Starting ${row.label}… (the first start downloads it)`);
  let failed = '';
  await sseStream('/api/services/start', { id, gpu: row.gpu, modelId: row.modelId }, {
    onStatus: text => { const line = String(text).trim().split('\n').pop(); if (line && !line.startsWith('$ ')) setStatus(status, `${row.label}: ${line.slice(0, 140)}`); },
    onDone: obj => { if (obj && obj.ok === false) failed = String(obj.status || 'it did not answer').trim().split('\n').pop().replace(/^✗\s*/, ''); },
    onError: e => { failed = e.message; },
  });
  await voiceCardRender({ scope: _vc.scope, split: document.getElementById('vc-split')?.checked });
  setStatus(document.getElementById('vc-status'), failed ? `✗ ${row.label}: ${failed}` : `✓ ${row.label} started`, failed ? 'err' : 'ok');
}

/** Stop: asked first with what uses it (2.325.0's machine confirmation), then the Services route. */
function voiceCardStop(id, label) {
  machineAsk('service', id, 'stop', label, async () => {
    try { await apiFetch('/api/services/stop', { method: 'POST', body: { id } }); } catch (e) { return appAlert(e.message); }
    voiceCardRender({ scope: _vc.scope });
  });
}
