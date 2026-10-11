/* Settings → Harness → Vision (modules/vision): how computer_look reads a computer's screen — a vision model, a Roboflow
   detector, Tesseract's text or OpenCV template matching. Each is a reader the owner can replace when a better one
   comes; the agent may also pick one per call. The switch is the experiment visionPass (Settings → Developer). */
async function visionCardRender(panel) {
  let v;
  if (!(typeof licenceFeatureOn !== 'function' || licenceFeatureOn('vision-pass'))) return;
  try { v = await apiFetch('/api/vision'); } catch { return; }
  document.getElementById('vision-card')?.remove();
  if (!v.experiment) return;   // its experiment is off (Settings → Developer): nothing to set yet
  const s = v.settings, has = id => v.available.includes(id);
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'vision-card' });
  const f = (label, input, info) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:11px;color:var(--muted);width:150px;flex-shrink:0">${label}${infoBtn(info)}</label>${input}</div>`;
  const inp = (id, val, ph, w = '240px', d) => `<input class="input" id="vision-${id}" value="${escHtml(val || '')}" placeholder="${escHtml(ph)}" style="width:${w}"${d != null ? ` data-default="${escHtml(d)}" data-label="${escHtml(id)}"` : ''}>`;
  card.innerHTML = `<div class="card-title">Vision <span style="font-size:10px;color:var(--muted)">experiment</span></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">How an agent reads a computer's screen when there is nothing to number (<code>computer_look</code>).
      Ready here: <b>${v.available.map(id => escHtml(v.readers[id])).join(', ') || 'none'}</b>. ${v.experiment ? '' : 'Off until "Look at a computer\'s screen" is on in Settings → Developer.'}</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${f('Default reader', `<select class="input" id="vision-backend" style="width:auto">${Object.entries(v.readers).map(([id, l]) => `<option value="${id}" ${s.backend === id ? 'selected' : ''}>${escHtml(l)}${has(id) ? '' : ' — not set up'}</option>`).join('')}</select>`, 'Which way an agent reads a screen unless it asks for another: a vision model (understands anything, needs one set below), a detector (finds trained objects), text recognition, or matching a small picture. One marked "not set up" cannot be used yet.')}
      ${f('Vision model', `${inp('provider', s.provider, 'provider (ollama)', '140px')} ${inp('model', s.model, 'e.g. qwen2.5vl')}`, 'A model that understands pictures: the provider (as in Field → API keys; Ollama for one on this machine) and the model\'s name. Empty: no vision model.')}
      ${advancedFold(`<div style="display:flex;flex-direction:column;gap:8px">
      ${f('Detector', `${inp('detectorUrl', s.detectorUrl, 'http://127.0.0.1:9001 (Services → Roboflow Inference)', '240px', 'http://127.0.0.1:9001')} ${inp('detectorModel', s.detectorModel, 'project/version', '160px', '')} ${inp('apiKey', s.apiKey, 'API key, if needed', '160px')}`, 'A Roboflow Inference server (Field → Models → Inference Services) that finds objects it was trained on: its address, the model as project/version, and an API key if it asks for one. Default address: http://127.0.0.1:9001.')}
      ${f('Text (Tesseract)', `${inp('ocrLang', s.ocrLang, 'eng', '120px', 'eng')} <span style="font-size:11px;color:var(--muted)">${has('text') ? 'installed' : 'install it in System → System tools'}</span>`, 'Reads the words on a screen with Tesseract. The box is its language code (eng, ita, deu…; several joined with +). Default: eng.')}
      ${f('Template (OpenCV)', `<span style="font-size:11px;color:var(--muted)">${has('template') ? 'installed' : 'install OpenCV (Python) in System → System tools'} </span>`, 'Finds where a small picture the agent gives (a button, an icon) appears on the screen, with OpenCV. Nothing to set.')}</div>`,
        { id: 'vision', label: 'Advanced — the detector, text and template readers' })}
      <div class="toolbar"><button class="btn btn-sm btn-blue" onclick="visionSave()">Save</button></div>
      ${f('Try it', `<input type="file" accept="image/png" id="vision-try-file" class="input" style="width:auto"> ${inp('try-q', '', 'a question: where is the Start button?')} <button class="btn btn-sm" onclick="visionTry()">Read</button>`, 'Choose a screenshot (PNG) and ask a question about it, to see what the saved reader would tell an agent. Nothing is kept.')}
      <div id="vision-try-out" style="font-size:12px;white-space:pre-wrap;color:var(--muted)"></div>
    </div>`;
  panel.append(card);
}

async function visionSave() {
  const g = id => document.getElementById(`vision-${id}`).value.trim();
  try { await apiFetch('/api/vision', { method: 'POST', body: Object.fromEntries(['backend', 'provider', 'model', 'detectorUrl', 'detectorModel', 'apiKey', 'ocrLang'].map(k => [k, g(k)])) }); }
  catch (e) { return appAlert(e.message); }
  visionCardRender(document.getElementById('sp-harness'));
}

/** A screenshot and a question, through the saved reader (POST /api/vision/try): what an agent would be told. */
async function visionTry() {
  const out = document.getElementById('vision-try-out'), file = document.getElementById('vision-try-file').files?.[0];
  if (!file) { out.textContent = 'Choose a PNG first — a screenshot of a screen with something to find.'; return; }
  out.textContent = 'Reading…';
  const png = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(file); });
  try {
    const r = await apiFetch('/api/vision/try', { method: 'POST', body: { png, question: document.getElementById('vision-try-q').value.trim() } });
    out.textContent = `${r.answer}\n(${r.ms} ms)`;
  } catch (e) { out.textContent = e.message; }
}
