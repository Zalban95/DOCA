/* Settings → Voice → This screen (TODO H2.4): the voice this screen is answered in, over the hive's (the setting
   `voice`, a screen's own like its theme — modules/screens; chat.js handleSynthesize reads it). Empty is the hive's. */
async function screenVoiceRender() {
  const panel = document.getElementById('sp-voice');
  if (!panel) return;
  document.getElementById('screen-voice-card')?.remove();
  let s;
  try { s = await screenLoad(); } catch { return; }
  const v = s.settings?.voice || {};
  const mine = s.from?.voice === 'device';
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'screen-voice-card' });
  card.innerHTML = `<div class="card-title">This screen's voice</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">How answers are read aloud on <b>${escHtml(s.name || 'this screen')}</b> — a phone can speak faster than the kitchen tablet.
      Empty uses the voice above. ${mine ? 'Set here.' : "Now: the hive's."}</p>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap">
      <input class="input" id="sv-voice" placeholder="voice (e.g. af_heart)" value="${escHtml(v.ttsVoice || '')}" style="width:200px">
      <input class="input" id="sv-speed" type="number" min="0.5" max="2" step="0.1" placeholder="speed" value="${escHtml(v.ttsSpeed ?? '')}" style="width:100px">
      <button class="btn btn-sm btn-blue" onclick="screenVoiceSave()">Save for this screen</button>
      ${mine ? '<button class="btn btn-sm" onclick="screenVoiceSave(true)">Back to the hive\'s</button>' : ''}</div>`;
  panel.append(card);
}

async function screenVoiceSave(reset = false) {
  const voice = document.getElementById('sv-voice').value.trim(), speed = parseFloat(document.getElementById('sv-speed').value);
  const value = reset || (!voice && !speed) ? null : { ...(voice ? { ttsVoice: voice } : {}), ...(speed > 0 ? { ttsSpeed: speed } : {}) };
  try { await screenSave({ voice: value }); } catch (e) { return appAlert(e.message); }
  screenVoiceRender();
}
