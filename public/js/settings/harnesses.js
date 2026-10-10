/* Settings → Harnesses → OpenDots and → CLI harnesses (settings/subnav.js draws the section). Each harness's settings
   are its own: OpenDots' folder and address and its Compose project (modules/harness/opendots.js), and each CLI
   harness's launch command, model, config file and environment — the same fields as its ⚙ on Controls, saved through
   the same route. */

async function openDotsSettingsLoad() {
  const panel = document.getElementById('sp-opendots');
  if (!panel) return;
  let s;
  try { s = await apiFetch('/api/harness/opendots/state'); } catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const color = s.state === 'ready' ? 'var(--green)' : s.state === 'absent' ? 'var(--muted)' : 'var(--amber)';
  panel.innerHTML = `<div class="card">
    <div class="card-title">OpenDots</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">CopilotKit's Dots, Spaces and pages, in its own web app with its own data and keys —
      a peer of DOCA, never a part of it. Its keys go in its own <code>.env</code>; DOCA does not fill them.</p>
    <p style="font-size:12px;color:${color};margin-bottom:10px">${escHtml(s.say)}</p>
    <div class="harness-cfg-grid">
      <label>Folder</label><input class="input" id="od-dir" value="${escHtml(s.dir)}">
      <label>Address</label><input class="input" id="od-url" value="${escHtml(s.url)}" placeholder="http://127.0.0.1:4310">
    </div>
    <div class="toolbar" style="gap:6px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-sm btn-blue" onclick="openDotsSave()">Save</button>
      <button class="btn btn-sm btn-green" onclick="window.open(document.getElementById('od-url').value, '_blank', 'noopener')">▶ Open</button>
      <button class="btn btn-sm" onclick="openDotsStack('start')">▶ Start</button>
      <button class="btn btn-sm" onclick="openDotsStack('stop')">■ Stop</button>
    </div>
    <pre id="od-out" class="terminal" style="display:none;margin-top:8px;max-height:min(45vh,320px)"></pre>
  </div>`;
}

async function openDotsSave() {
  try { await apiFetch('/api/harness/opendots/config', { method: 'POST', body: { dir: document.getElementById('od-dir').value, url: document.getElementById('od-url').value } }); }
  catch (e) { return appAlert(e.message); }
  openDotsSettingsLoad();
}

async function openDotsStack(action) {
  const out = document.getElementById('od-out');
  showStream(out, '');
  await sseStream('/api/harness/opendots/stack', { action }, { onStatus: t => appendStream(out, t), onError: e => appendStream(out, `\nError: ${e.message}`) });
  const keep = out.textContent;
  await openDotsSettingsLoad();
  const o = document.getElementById('od-out'); if (o) { o.style.display = 'block'; o.textContent = keep; }
}

async function otherHarnessesLoad(only) {
  const panel = document.getElementById('sp-harness-others');
  if (!panel) return;
  let list = [];
  try { list = (await apiFetch('/api/harness')).harnesses.filter(h => (h.kind === 'cli' || h.kind === 'custom') && h.detected && (!only || h.id === only)); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  panel.innerHTML = list.map(h => {
    const c = h.config || {}, id = escHtml(h.id);
    return `<div class="card">
      <div class="card-title" style="display:flex;gap:8px;align-items:center">${escHtml(h.label)} <span class="tool-version">${escHtml(h.version || '')}</span>
        <span style="font-size:10px;color:var(--muted);text-transform:none;letter-spacing:0">${escHtml(h.vendor || '')}${h.oneShot ? ' · answers the floating chat one question at a time' : ''}</span></div>
      <div class="harness-cfg-grid">
        <label>Launch command</label><input class="input" id="sh-launch-${id}" value="${escHtml(c.launchCmd || h.cmd || '')}">
        <label>Model</label><input class="input" id="sh-model-${id}" value="${escHtml(c.model || '')}" placeholder="passed as --model when set">
        <label>Config file</label><input class="input" id="sh-path-${id}" data-path-pick="file" value="${escHtml(c.configPath || '')}" placeholder="${escHtml(h.configPathHint || '/path/to/config')}">
        <label>Environment</label><textarea class="input" id="sh-env-${id}" rows="2" placeholder="KEY=VALUE (one per line) — exported before launch">${escHtml(c.env || '')}</textarea>
      </div>
      <div class="toolbar" style="gap:6px;margin-top:8px"><button class="btn btn-sm btn-blue" onclick="otherHarnessSave(${jsArg(h.id)})">Save</button>
        <button class="btn btn-sm" onclick="harnessOpen(${jsArg(h.id)})" title="Its terminal on the Harness tab">▶ Open</button>
        <span class="status-line" id="sh-status-${id}"></span></div>
    </div>`;
  }).join('') || '<div class="card"><div class="placeholder">No CLI harness is installed here (Controls → Add another agent).</div></div>';
}

async function otherHarnessSave(id) {
  const v = k => document.getElementById(`sh-${k}-${id}`).value;
  try {
    await apiFetch(`/api/harness/${encodeURIComponent(id)}/config`, { method: 'POST', body: { launchCmd: v('launch'), model: v('model'), configPath: v('path'), env: v('env') } });
    setStatus(document.getElementById(`sh-status-${id}`), '✓ Saved', 'ok');
  } catch (e) { setStatus(document.getElementById(`sh-status-${id}`), e.message, 'err'); }
}

// Their panels are made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const at = document.getElementById('sp-backups');
  for (const id of ['sp-opendots', 'sp-harness-others']) if (at && !document.getElementById(id)) at.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id }));
});
