/* Settings → Voice → Quick and Deep calls (modules/call-voices.js): a voice per kind of call. The Quick call is the
   face's (the corner face, its name), Ambient's and a device's — the watch's, a phone's; the Deep call is the 🎙 from
   the chat. Each is `voice.quick` / `voice.deep` of this screen ({service, voice, speed}); unset, it is this screen's
   own voice above, else the hive's. An admin can make a choice the hive's: every screen without its own, and the
   devices that have no screen of their own to set (a watch). The common choice is shown, the speed under Advanced. */
const CALL_VOICE_KINDS = [
  { id: 'quick', title: 'Quick call', who: 'the face, Ambient, the watch' },
  { id: 'deep', title: 'Deep call', who: 'from the chat' },
];

async function callVoicesRender() {
  const panel = document.getElementById('sp-voice');
  if (!panel) return;
  let s, prefs = {};
  try { s = await screenLoad(true); } catch { return; }
  const host = typeof authHasRight !== 'function' || authHasRight('host');
  if (host) { try { prefs = await apiFetch('/api/prefs'); } catch { /* not readable: the hive's row stays empty */ } }
  const v = s.settings?.voice || {};
  const rows = await Promise.all(CALL_VOICE_KINDS.map(k => _callVoiceRow(k, v[k.id] || {}, prefs.voice?.[k.id])));
  const old = document.getElementById('call-voices-card');
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'call-voices-card' });
  card.innerHTML = `<div class="card-title">Quick and Deep calls</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">A voice for each kind of call on <b>${escHtml(s.name || 'this screen')}</b>.
      "Same as this screen" uses the voice above. An expressive voice may whisper, laugh or light up where it fits — the agent is told of that only in a call it speaks.</p>
    <div style="display:flex;flex-direction:column;gap:12px">${rows.join('')}</div>`;
  if (old) old.replaceWith(card); else panel.append(card);   // redrawn where it stood
}

/** One kind's row: which service, which of its voices; speed under Advanced. */
async function _callVoiceRow(k, mine, hive) {
  const service = mine.service ?? '';
  let list = { voices: [], engines: [] };
  try { list = await apiFetch(`/api/chat/voices${service && service !== 'hive' ? `?engine=${encodeURIComponent(service)}` : ''}`); } catch { /* typed instead */ }
  const engines = list.engines?.length ? list.engines : [{ id: '', label: "The hive's speech service" }];
  const opts = [['', 'Same as this screen'], ...engines.map(e => [e.id || 'hive', `${e.label}${e.tags ? ' — expressive' : ''}`])];
  if (service && !opts.some(([id]) => id === service)) opts.push([service, `${service} — not running (Field → Models → Inference Services)`]);
  const id = x => `cv-${k.id}-${x}`;
  const voice = !service ? '' : list.voices.length
    ? `<select class="input" id="${id('voice')}" style="width:auto"><option value="">its own (${escHtml(list.default || list.hive || '')})</option>${
      list.voices.map(x => `<option value="${escHtml(x)}" ${x === mine.voice ? 'selected' : ''}>${escHtml(x)}</option>`).join('')}${
      mine.voice && !list.voices.includes(mine.voice) ? `<option value="${escHtml(mine.voice)}" selected>${escHtml(mine.voice)} — not a voice of the service</option>` : ''}</select>`
    : `<input class="input" id="${id('voice')}" placeholder="voice (e.g. af_heart)" value="${escHtml(mine.voice || '')}" style="width:180px">`;
  const speed = `<label style="font-size:12px;display:flex;gap:6px;align-items:center">Speed <input class="input" id="${id('speed')}" type="number" min="0.5" max="2" step="0.1"
    placeholder="as the voice" value="${escHtml(mine.speed ?? '')}" style="width:100px"></label>`;
  const adv = typeof advancedFold === 'function' ? advancedFold(speed, { id: `call-voice-${k.id}` })
    : `<details class="adv-fold"${mine.speed ? ' open' : ''}><summary style="cursor:pointer;font-size:12px">Advanced</summary><div style="margin-top:6px">${speed}</div></details>`;
  const hiveNote = hive && (hive.service || hive.voice) ? `<span style="font-size:11px;color:var(--muted)">The hive's: ${escHtml(hive.voice || hive.service)}</span>` : '';
  const host = typeof authHasRight !== 'function' || authHasRight('host');
  return `<div class="call-voice-row" data-kind="${k.id}"><div style="font-size:12px;font-weight:600;margin-bottom:4px">${escHtml(k.title)} <span style="font-weight:400;color:var(--muted)">(${escHtml(k.who)})</span></div>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <select class="input" id="${id('service')}" style="width:auto" title="Which speech service speaks" onchange="_callVoiceService('${k.id}', this.value)">${
        opts.map(([v, l]) => `<option value="${escHtml(v)}" ${v === service ? 'selected' : ''}>${escHtml(l)}</option>`).join('')}</select>
      ${voice}
      <button class="btn btn-sm btn-blue" onclick="callVoiceSave('${k.id}')">Save for this screen</button>
      ${host ? `<button class="btn btn-sm" onclick="callVoiceSave('${k.id}', 'hive')" title="Every screen without its own, and devices without a screen of their own (a watch)">Make it the hive's</button>` : ''}
      ${hiveNote}</div>${adv}</div>`;
}

/** A service chosen: its voices are another list, so the row is drawn again with it (not saved yet). */
async function _callVoiceService(kind, service) {
  const row = document.querySelector(`#call-voices-card .call-voice-row[data-kind="${kind}"]`);
  if (!row) return;
  const k = CALL_VOICE_KINDS.find(x => x.id === kind);
  const speed = document.getElementById(`cv-${kind}-speed`)?.value;
  row.outerHTML = await _callVoiceRow(k, { service, ...(speed ? { speed: Number(speed) } : {}) }, null);
}

/** What the row says, as a slot — or null when it says nothing (back to this screen's voice). */
function _callVoiceSlot(kind) {
  const g = x => document.getElementById(`cv-${kind}-${x}`)?.value?.trim() || '';
  const speed = parseFloat(g('speed'));
  const slot = { ...(g('service') ? { service: g('service') } : {}), ...(g('voice') ? { voice: g('voice') } : {}), ...(speed > 0 ? { speed } : {}) };
  return Object.keys(slot).length ? slot : null;
}

/** Save one kind for this screen (beside its other voice fields), or as the hive's (prefs.voice). */
async function callVoiceSave(kind, where = 'screen') {
  const slot = _callVoiceSlot(kind);
  try {
    if (where === 'hive') {
      const prefs = await apiFetch('/api/prefs');
      const cur = { ...(prefs.voice || {}) };
      if (slot) cur[kind] = slot; else delete cur[kind];
      await apiFetch('/api/prefs', { method: 'POST', body: { voice: cur } });
    } else {
      const cur = { ...((await screenLoad(true)).settings?.voice || {}) };   // the voice above is kept as it is
      if (slot) cur[kind] = slot; else delete cur[kind];
      await screenSave({ voice: Object.keys(cur).length ? cur : null });
    }
  } catch (e) { return appAlert(e.message); }
  callVoicesRender();
}
