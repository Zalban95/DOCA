/* Settings → Voice → Voice, "Different voices for each call" (voice-card.js): a row each for the Live call, the Deep
   call and Ambient's assistant — which service, which of its voices, a ▶ — and their speeds under one Advanced. A row
   left at "Same as the voice above" (Ambient's: "Same as the Live call") keeps no slot, so it follows; a row that
   names only a voice keeps the voice above's service (call-voices.js pick). */

/** The engine a row's service means: '' follows the voice above (Ambient's: the Live call's row), 'hive' is ''. */
function _vcRowEngine(kind, service) {
  if (service === 'hive') return '';
  if (service) return service;
  if (kind === 'ambient') { const q = document.getElementById('vc-quick-service')?.value; if (q !== undefined) return _vcRowEngine('quick', q); }
  return document.getElementById('vc-engine')?.value ?? _vc.engine ?? '';
}

async function voiceCallsHtml(v, mainEngine) {
  const live = v.quick?.service === 'hive' ? '' : v.quick?.service || mainEngine;   // what Ambient's follows
  const rows = await Promise.all(VOICE_CALLS.map(k => voiceCallRow(k, v[k.id] || {}, k.id === 'ambient' ? live : mainEngine)));
  const speeds = VOICE_CALLS.map(k => `<label style="font-size:12px;display:flex;gap:6px;align-items:center">${escHtml(k.title)}
    <input class="input" id="vc-${k.id}-speed" type="number" min="0.5" max="2" step="0.1" data-default="" data-label="${escHtml(k.title)} speed"
      placeholder="as the voice" value="${escHtml(v[k.id]?.speed ?? '')}" style="width:100px"></label>`).join('');
  return `<div style="display:flex;flex-direction:column;gap:10px">${rows.join('')}</div>
    ${advancedFold(`<div style="display:flex;gap:12px;flex-wrap:wrap">${speeds}</div>`, { id: 'voice-card-call-speeds', label: 'Each call’s speed' })}`;
}

/** One call's row: its service (or the voice above), its voice, ▶, and whether that service runs. */
/** `follows`: the engine a row left at "Same as …" speaks through — the voice above's, or for Ambient's the Live call's. */
async function voiceCallRow(k, slot, follows) {
  const service = slot.service ?? '';
  const engine = service === 'hive' ? '' : service || follows;
  // '' follows (the voice above, or the Live call); the hive's own service is 'hive' here.
  const opts = [['', k.same || 'Same as the voice above'], ..._vcServiceOptions(service === 'hive' ? '' : service).map(([id, l]) => [id === '' ? 'hive' : id, l])];
  const list = await _vcVoices(engine);
  return `<div class="vc-row vc-call" data-kind="${k.id}" data-service="${escHtml(service)}">
    <div style="font-size:12px;font-weight:600;margin-bottom:4px">${escHtml(k.title)} <span style="font-weight:400;color:var(--muted)">(${escHtml(k.who)})</span></div>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">
      ${_vcSelect(`vc-${k.id}-service`, opts, service, `voiceCallService('${k.id}', this.value)`)}
      ${choiceInput({ id: `vc-${k.id}-voice`, value: slot.voice || '', items: list?.items || null, source: list?.source || '', width: '200px',
        placeholder: service ? 'its own voice' : 'the voice above', load: async () => { const e = _vcRowEngine(k.id, service); delete _vc.voices[e]; return _vcVoices(e); } })}
      <button class="btn btn-sm" onclick="voiceCardTry('${k.id}')" title="Speak a sample in this call's voice" aria-label="Speak a sample in the ${escHtml(k.title)} voice">▶</button>
    </div>
    ${service ? voiceCardState(service === 'hive' ? '' : service) : ''}</div>`;
}

/** A call's service chosen: its row drawn again with that service's voices (nothing saved yet). */
async function voiceCallService(kind, service) {
  const row = document.querySelector(`#vc-calls .vc-call[data-kind="${kind}"]`);
  const k = VOICE_CALLS.find(x => x.id === kind);
  if (!row || !k) return;
  const voice = document.getElementById(`vc-${kind}-voice`)?.value || '';
  const follows = kind === 'ambient' ? _vcRowEngine('quick', document.getElementById('vc-quick-service')?.value || '') : document.getElementById('vc-engine')?.value || '';
  row.outerHTML = await voiceCallRow(k, { service, voice: service === (row.dataset.service || '') ? voice : '' }, follows);
  // Ambient's, while it follows the Live call, follows its new service too.
  const amb = document.querySelector('#vc-calls .vc-call[data-kind="ambient"]');
  if (kind === 'quick' && amb && !document.getElementById('vc-ambient-service')?.value) await voiceCallService('ambient', '');
}

/** What a call's row says, as a slot — or null when it says nothing (it follows). */
function voiceCallSlot(kind) {
  const g = x => document.getElementById(`vc-${kind}-${x}`)?.value?.trim() || '';
  const speed = parseFloat(g('speed'));
  const slot = { ...(g('service') ? { service: g('service') } : {}), ...(g('voice') ? { voice: g('voice') } : {}), ...(speed > 0 ? { speed } : {}) };
  return Object.keys(slot).length ? slot : null;
}

/** ▶: a sample spoken through what a row shows now, saved or not (POST /api/chat/synthesize with `engine`). */
async function voiceCardTry(kind) {
  const g = id => document.getElementById(id)?.value?.trim() || '';
  let engine = g('vc-engine'), voice = g('vc-voice'), speed = parseFloat(g('vc-speed'));
  if (kind !== 'main') {
    const service = g(`vc-${kind}-service`);
    const own = g(`vc-${kind}-voice`), ownSpeed = parseFloat(g(`vc-${kind}-speed`));
    if (!service && kind === 'ambient' && (g('vc-quick-service') || g('vc-quick-voice'))) return voiceCardTry('quick');   // follows the Live call
    if (service) { engine = _vcRowEngine(kind, service); voice = own; speed = ownSpeed; }
    else { voice = own || voice; if (ownSpeed > 0) speed = ownSpeed; }
  }
  const hosted = engine.startsWith('hosted:') && typeof hostedVoiceValue === 'function' ? hostedVoiceValue() : null;
  const status = document.getElementById('vc-status');
  setStatus(status, 'Speaking a sample…');
  try {
    const r = await fetch('/api/chat/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello. This is how I sound when I answer you.', engine, voice, ...(speed > 0 ? { speed } : {}), ...(hosted ? { hosted } : {}) }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `the speech service answered ${r.status}`);
    const fell = r.headers.get('X-Doca-Voice-Fallback');
    const audio = new Audio(URL.createObjectURL(await r.blob()));
    await audio.play();
    setStatus(status, fell ? `Spoken — "${fell.split(' -> ')[0]}" is not one of its voices, so it used ${fell.split(' -> ')[1]}` : '✓ Spoken', fell ? 'err' : 'ok');
  } catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
}
