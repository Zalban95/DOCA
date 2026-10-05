/* Settings → Harness → Vision (modules/vision): how computer_look reads a computer's screen — a vision model, a Roboflow
   detector, Tesseract's text or OpenCV template matching. Each is a reader the owner can replace when a better one
   comes; the agent may also pick one per call. The switch is the experiment visionPass (Settings → Developer). */
async function visionCardRender(panel) {
  let v;
  try { v = await apiFetch('/api/vision'); } catch { return; }
  document.getElementById('vision-card')?.remove();
  const s = v.settings, has = id => v.available.includes(id);
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'vision-card' });
  const f = (label, input) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:11px;color:var(--muted);width:150px;flex-shrink:0">${label}</label>${input}</div>`;
  const inp = (id, val, ph, w = '240px') => `<input class="input" id="vision-${id}" value="${escHtml(val || '')}" placeholder="${escHtml(ph)}" style="width:${w}">`;
  card.innerHTML = `<div class="card-title">Vision <span style="font-size:10px;color:var(--muted)">experiment</span></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">How an agent reads a computer's screen when there is nothing to number (<code>computer_look</code>).
      Ready here: <b>${v.available.map(id => escHtml(v.readers[id])).join(', ') || 'none'}</b>. ${v.experiment ? '' : 'Off until "Look at a computer\'s screen" is on in Settings → Developer.'}</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${f('Default reader', `<select class="input" id="vision-backend" style="width:auto">${Object.entries(v.readers).map(([id, l]) => `<option value="${id}" ${s.backend === id ? 'selected' : ''}>${escHtml(l)}${has(id) ? '' : ' — not set up'}</option>`).join('')}</select>`)}
      ${f('Vision model', `${inp('provider', s.provider, 'provider (ollama)', '140px')} ${inp('model', s.model, 'e.g. qwen2.5vl')}`)}
      ${f('Detector', `${inp('detectorUrl', s.detectorUrl, 'http://127.0.0.1:9001 (Services → Roboflow Inference)')} ${inp('detectorModel', s.detectorModel, 'project/version', '160px')} ${inp('apiKey', s.apiKey, 'API key, if needed', '160px')}`)}
      ${f('Text (Tesseract)', `${inp('ocrLang', s.ocrLang, 'eng', '120px')} <span style="font-size:11px;color:var(--muted)">${has('text') ? 'installed' : 'install it in System → System tools'}</span>`)}
      ${f('Template (OpenCV)', `<span style="font-size:11px;color:var(--muted)">${has('template') ? 'installed' : 'install OpenCV (Python) in System → System tools'} — finds a picture of an element the agent gives</span>`)}
      <div class="toolbar"><button class="btn btn-sm btn-blue" onclick="visionSave()">Save</button></div>
    </div>`;
  panel.append(card);
}

async function visionSave() {
  const g = id => document.getElementById(`vision-${id}`).value.trim();
  try { await apiFetch('/api/vision', { method: 'POST', body: Object.fromEntries(['backend', 'provider', 'model', 'detectorUrl', 'detectorModel', 'apiKey', 'ocrLang'].map(k => [k, g(k)])) }); }
  catch (e) { return appAlert(e.message); }
  visionCardRender(document.getElementById('sp-harness'));
}
