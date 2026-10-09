/* Field → Models → Wake words (modules/wakeword; TODO H8.4): a model trained here for the word a screen answers to —
   any word, by any install, kept like the other models. Set the trainer up once, record your own voice saying the word
   and saying other things, train (about an hour of GPU), and see how the model scored on what it did not train on. */
const WW = { word: '', rec: null, poll: null };

async function wakewordTab() {
  let card = document.getElementById('ww-card');
  if (!card) {
    card = Object.assign(document.createElement('div'), { className: 'card', id: 'ww-card' });
    document.getElementById('tab-models')?.append(card);
  }
  if (!WW.word) {
    try { const s = await screenLoad(); WW.word = String(s.settings?.call?.wakeWord || '').trim() || (typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA'; } catch { WW.word = 'DOCA'; }
  }
  return _wwLoad();
}

async function _wwLoad() {
  const card = document.getElementById('ww-card');
  if (!card) return;
  card.style.display = (typeof licenceFeatureOn !== 'function' || licenceFeatureOn('wake-model')) ? '' : 'none';   // not licensed here (lib/licence.js)
  if (card.style.display) return;
  let s;
  try { s = await apiFetch(`/api/wakeword?word=${encodeURIComponent(WW.word)}`); }
  catch (e) { card.innerHTML = `<div class="card-title">Wake words</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const r = s.ready, ready = Object.values(r).every(Boolean), j = s.job, running = j?.state === 'running';
  const tick = (ok, label) => `<span class="ww-tick ${ok ? 'ok' : ''}">${ok ? '✓' : '·'} ${label}</span>`;
  card.innerHTML = `<div class="card-title">Wake words — a model trained for the name a screen answers to</div>
    <p class="ww-note">A small model that hears one word on the screen itself — sooner than sending sound to speech-to-text, and nothing leaves the
      screen until the word is heard. Trained here from synthetic voices, this hub's own voices and your recordings. An experiment (wake model).</p>
    <div class="ww-row">${tick(r.env, 'environment')}${tick(r.generator, 'synthetic voices')}${tick(r.features, 'other audio (17 GB)')}${tick(r.rir, 'room echoes')}${tick(r.noise, 'everyday sounds')}${tick(r.runtime, 'feature models')}
      ${ready ? '' : `<button class="btn btn-sm" ${running ? 'disabled' : ''} onclick="wakewordSetup()">Set up (about 20 GB, once)</button>`}
      <span class="ww-dir" title="wakeword.dir">${escHtml(s.dir)}</span></div>
    <div class="ww-row"><label>The word <input class="input" id="ww-word" value="${escHtml(WW.word)}" style="width:160px" onchange="WW.word=this.value.trim();_wwLoad()"></label>
      <span>Your voice: <b>${s.samples?.said ?? 0}</b> of the word, <b>${s.samples?.other ?? 0}</b> other</span></div>
    <div class="ww-row">
      <button class="btn btn-sm" id="ww-rec-word" onclick="wakewordRecord('word', this)" ${r.env ? '' : 'disabled'}>🎤 Say the word, 6–10 times, a pause between</button>
      <button class="btn btn-sm" id="ww-rec-other" onclick="wakewordRecord('other', this)" ${r.env ? '' : 'disabled'}>🎤 Say other things: near words, a sentence</button>
      <button class="btn btn-xs" onclick="wakewordFromChat()" ${r.env ? '' : 'disabled'} title="Voice messages you sent in the chat">From the chat…</button>
      ${s.samples?.said || s.samples?.other ? `<a href="#" onclick="wakewordClear();return false" class="ww-dim">start over</a>` : ''}</div>
    <div class="ww-row"><button class="btn btn-sm btn-blue" onclick="wakewordTrain()" ${ready && !running ? '' : 'disabled'}>Train “${escHtml(WW.word)}” (about an hour)</button>
      ${running ? `<button class="btn btn-sm btn-red" onclick="wakewordStop()">■ Stop</button>` : ''}</div>
    ${j ? `<div class="ww-job ${escHtml(j.state)}"><b>${escHtml(j.kind)}: ${escHtml(j.state)}</b> — ${escHtml(j.stage || '')}${j.error ? ` — ${escHtml(j.error)}` : ''}
      <pre>${escHtml((j.log || []).slice(-8).join('\n'))}</pre></div>` : ''}
    <div class="ww-models">${s.models.length ? s.models.map(_wwModel).join('') : '<div class="placeholder">No wake-word model yet.</div>'}</div>`;
  clearTimeout(WW.poll);
  if (running && pageShown('models')) WW.poll = setTimeout(_wwLoad, 3000);
}

function _wwModel(m) {
  const pct = x => (x ? `${Math.round(x.share * 100)}% (${x.n}/${x.of})` : '—');
  const sc = m.scores || {};
  return `<div class="ww-model"><b>${escHtml(m.word)}</b> <span class="ww-dim">${escHtml(new Date(m.at).toLocaleString())} · ${Math.round((m.bytes || 0) / 1024)} KB</span>
    <span>heard: synthetic ${pct(sc.heard)}, your voice ${pct(sc.heardPerson)}</span>
    <span>wrongly woken: near words ${pct(sc.falseNear)}, your other words ${pct(sc.falsePerson)}</span>
    <a href="/api/wakeword/models/${encodeURIComponent(m.name)}/model.onnx" download="${escHtml(m.name)}.onnx">⬇ onnx</a>
    <button class="btn btn-xs" onclick="wakewordRemove(${jsArg(m.name)})">✕</button></div>`;
}

async function wakewordSetup() {
  appConfirm('Set up wake-word training: a Python environment with PyTorch, and about 20 GB of training data, downloaded once into the folder shown.', async () => {
    try { await apiFetch('/api/wakeword/setup', { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
    _wwLoad();
  });
}

async function wakewordTrain() {
  try { await apiFetch('/api/wakeword/train', { method: 'POST', body: { word: WW.word } }); } catch (e) { return appAlert(e.message); }
  _wwLoad();
}

async function wakewordStop() { try { await apiFetch('/api/wakeword/stop', { method: 'POST', body: {} }); } catch { /* shown on reload */ } _wwLoad(); }
async function wakewordRemove(name) { appConfirm(`Remove the model for “${name}”?`, async () => { try { await apiFetch(`/api/wakeword/models/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); } _wwLoad(); }); }
async function wakewordClear() {
  appConfirm(`Forget your recordings for “${WW.word}”?`, async () => {
    for (const k of ['word', 'other']) { try { await apiFetch(`/api/wakeword/samples/${encodeURIComponent(WW.word)}/${k}`, { method: 'DELETE' }); } catch { /* none */ } }
    _wwLoad();
  });
}

/** Record until pressed again; the recording is split into utterances on the hub and labelled as asked. */
async function wakewordRecord(kind, btn) {
  if (WW.rec) { WW.rec.stop(); return; }
  let stream;
  try { stream = await micOpen({ echoCancellation: false, noiseSuppression: false }); } catch (e) { return appAlert(`The microphone did not open: ${e.message}`); }
  const chunks = [], rec = new MediaRecorder(stream);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop()); WW.rec = null;
    btn.textContent = 'Splitting…';
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    try {
      const r = await fetch(`/api/wakeword/samples?word=${encodeURIComponent(WW.word)}&kind=${kind}`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
    } catch (e) { appAlert(e.message); }
    _wwLoad();
  };
  rec.start(); WW.rec = rec;
  btn.textContent = '■ Stop recording'; btn.classList.add('btn-red');
}

/** Voice messages from the chat, labelled as the word or as other. */
async function wakewordFromChat() {
  let list = [];
  try { list = (await apiFetch('/api/wakeword/voice-messages')).messages; } catch (e) { return appAlert(e.message); }
  if (!list.length) return appAlert('No voice messages in the chat yet: record one with 🎤 in the chat.');
  const box = Object.assign(document.createElement('div'), { className: 'ww-pick' });
  box.innerHTML = `<div class="card"><div class="card-title">Voice messages — what do they say?</div>
    ${list.map(m => `<label class="ww-pick-row"><input type="checkbox" value="${escHtml(m.name)}"> ${escHtml(m.name)}</label>`).join('')}
    <div class="ww-row"><button class="btn btn-sm" onclick="_wwImport(this,'word')">The word</button><button class="btn btn-sm" onclick="_wwImport(this,'other')">Other things</button>
      <button class="btn btn-sm" onclick="this.closest('.ww-pick').remove()">Cancel</button></div></div>`;
  document.body.append(box);
}

async function _wwImport(btn, kind) {
  const box = btn.closest('.ww-pick'), names = [...box.querySelectorAll('input:checked')].map(i => i.value);
  if (!names.length) return;
  btn.disabled = true;
  try { await apiFetch('/api/wakeword/samples/import', { method: 'POST', body: { word: WW.word, kind, names } }); box.remove(); _wwLoad(); }
  catch (e) { btn.disabled = false; appAlert(e.message); }
}
