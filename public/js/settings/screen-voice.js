/* Settings → Voice → This screen (TODO H2.4): the voice this screen is answered in, over the hive's (the setting
   `voice`, a screen's own like its theme — modules/screens; chat.js handleSynthesize reads it). Empty is the hive's.
   Which speech service speaks is a choice too (`voice.engine`, modules/tts-engines.js): the hive's, or a speech service
   of the Services tab while it runs — the expressive voice, which takes a tone ("[whispers]") as well as words. */
async function screenVoiceRender(engineAsked) {
  const panel = document.getElementById('sp-voice');
  if (!panel) return;
  let s, list = { voices: [], hive: '', engines: [] };
  try { s = await screenLoad(); } catch { return; }
  const v = s.settings?.voice || {};
  const engine = engineAsked ?? v.engine ?? '';
  try { list = await apiFetch(`/api/chat/voices${engine ? `?engine=${encodeURIComponent(engine)}` : ''}`); } catch { /* the service does not list them: type one */ }
  window._hvList = list;   // hosted-voice.js: the services, their keys' state and how each takes its key
  const hosted = engine.startsWith('hosted:');
  document.getElementById('screen-voice-card')?.remove();
  const mine = s.from?.voice === 'device';
  const engines = list.engines?.length ? list.engines : [{ id: '', label: "The hive's speech service" }];
  const lost = engine && !engines.some(e => e.id === engine);   // chosen, and not running now
  const voiceVal = engine === (v.engine || '') ? v.ttsVoice : '';
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'screen-voice-card' });
  card.innerHTML = `<div class="card-title">This screen's voice</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">How answers are read aloud on <b>${escHtml(s.name || 'this screen')}</b> — a phone can speak faster than the kitchen tablet.
      Empty uses the voice above. ${mine ? 'Set here.' : "Now: the hive's."}</p>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <select class="input" id="sv-engine" style="width:auto" title="Which speech service speaks" onchange="screenVoiceRender(this.value)">${
        engines.map(e => `<option value="${escHtml(e.id)}" ${e.id === engine ? 'selected' : ''}>${escHtml(e.label)}${e.tags ? ' — expressive' : ''}</option>`).join('')}${
        lost ? `<option value="${escHtml(engine)}" selected>${escHtml(engine)} — ${hosted ? 'its key is not kept (below)' : 'not running (Field → Models → Inference Services)'}</option>` : ''}</select>
      ${hosted ? '' : list.voices.length ? `<select class="input" id="sv-voice" style="width:auto"><option value="">${engine ? `its own (${escHtml(list.default || '')})` : `the hive's (${escHtml(list.hive)})`}</option>${
        list.voices.map(x => `<option value="${escHtml(x)}" ${x === voiceVal ? 'selected' : ''}>${escHtml(x)}</option>`).join('')}${
        voiceVal && !list.voices.includes(voiceVal) ? `<option value="${escHtml(voiceVal)}" selected>${escHtml(voiceVal)} — not a voice of the service</option>` : ''}</select>`
        : `<input class="input" id="sv-voice" placeholder="voice (e.g. af_heart)" value="${escHtml(voiceVal || '')}" style="width:200px">`}
      <input class="input" id="sv-speed" type="number" min="0.5" max="2" step="0.1" placeholder="speed" value="${escHtml(v.ttsSpeed ?? '')}" style="width:100px">
      <button class="btn btn-sm btn-blue" onclick="screenVoiceSave()">Save for this screen</button>
      ${mine ? '<button class="btn btn-sm" onclick="screenVoiceSave(true)">Back to the hive\'s</button>' : ''}</div>
    ${hosted && !lost ? hostedVoiceFields(list, v) : ''}
    ${engines.find(e => e.id === engine)?.tags ? '<p style="font-size:11px;color:var(--muted);margin-top:6px">This voice changes its tone: in a live call the agent may whisper, laugh or light up where it fits. The tags it uses for that are never shown.</p>' : ''}
    ${hostedVoiceSetup(list)}`;
  panel.append(card);
}

async function screenVoiceSave(reset = false) {
  const engine = document.getElementById('sv-engine')?.value || '';
  const voice = (document.getElementById('sv-voice')?.value || '').trim(), speed = parseFloat(document.getElementById('sv-speed').value);
  const hosted = engine.startsWith('hosted:') ? hostedVoiceValue() : null;   // the service's model and Advanced (hosted-voice.js)
  // The Live and Deep calls' own voices (settings/call-voices.js) live beside these and are kept as they are.
  const cur = (await screenLoad(true)).settings?.voice || {};
  const calls = Object.fromEntries(['quick', 'deep'].filter(k => cur[k]).map(k => [k, cur[k]]));
  const value = reset || (!engine && !voice && !speed) ? (Object.keys(calls).length && !reset ? calls : null)
    : { ...calls, ...(engine ? { engine } : {}), ...(voice ? { ttsVoice: voice } : {}), ...(speed > 0 ? { ttsSpeed: speed } : {}), ...(hosted ? { hosted } : {}) };
  try { await screenSave({ voice: value }); } catch (e) { return appAlert(e.message); }
  screenVoiceRender();
  if (typeof callVoicesRender === 'function') callVoicesRender();
}
