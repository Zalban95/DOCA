/* Settings → Voice → Live call (TODO H8.3): everything about the 🎙 Live call in one place. How it listens is this
   screen's (the setting `call`, read by chat-call.js when a call starts) — a phone's microphone and a desk's hear a
   room differently; the experiments that change a call (barge-in, the face) are the owner's switches, shown here
   beside them as on Settings → Developer; and the realtime speech model a call uses when one is set (the owner's form,
   modules/realtime). A test meter shows the microphone against the threshold. */
let _liveCallMeter = null;

async function liveCallRender() {
  const panel = document.getElementById('sp-voice');
  if (!panel) return;
  document.getElementById('live-call-card')?.remove();
  let s;
  try { s = await screenLoad(true); } catch { return; }
  const c = s.settings?.call || {}, mine = s.from?.call === 'device';
  let ex = null;
  try { const d = await apiFetch('/api/experiments'); ex = d.developer ? d.experiments.filter(x => ['realtimeVoice', 'bargeIn', 'faceVoice', 'wakeWord'].includes(x.id)) : null; }
  catch { /* not the owner: no switches */ }
  let rt = null;
  try { rt = await apiFetch('/api/realtime'); } catch { /* without chat */ }
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'live-call-card' });
  const row = (label, input, hint) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <label style="font-size:11px;color:var(--muted);width:150px;flex-shrink:0">${label}</label>${input}<span style="font-size:11px;color:var(--muted)">${hint}</span></div>`;
  card.innerHTML = `<div class="card-title">Live call</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">How the 🎙 Live call in the chat listens on <b>${escHtml(s.name || 'this screen')}</b>.
      ${mine ? 'Set here.' : "Now: the hive's."} It uses the speech services above, and takes effect from the next call.</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${row('Pause before sending', `<input class="input" id="lc-silence" type="number" min="0.3" max="10" step="0.1" value="${(c.silenceMs || 2000) / 1000}" style="width:90px"> s`,
        'Shorter answers sooner; longer lets you think mid-sentence.')}
      ${row('Microphone threshold', `<input type="range" id="lc-sens" min="1" max="60" step="1" value="${c.sensitivity || 15}" style="width:180px"
          oninput="document.getElementById('lc-sens-val').textContent=this.value"><span id="lc-sens-val" style="font-size:11px;min-width:22px">${c.sensitivity || 15}</span>`,
        'Lower hears quieter voices — and more of the room.')}
      ${row('Call by name', `<label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="lc-listen" ${c.listenWithFace ? 'checked' : ''}>
          while the corner face shows, listen for</label><input class="input" id="lc-word" value="${escHtml(c.wakeWord || '')}" placeholder="${escHtml((typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA')}" style="width:120px">`,
        `Say it to start a call — "${escHtml(c.wakeWord || (typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA')}, what's on today?" sends the rest as your first message. ${s.experiments?.wakeWord ? '' : '<b>Needs the experiment "Start a call by saying the hive\'s name" (developer mode).</b> '}
         While it listens, whatever is said near this screen goes to your speech-to-text service.`)}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-sm" id="lc-test" onclick="liveCallMeter()">🎤 Test the microphone</button>
        <div style="position:relative;width:240px;height:10px;background:var(--raised);border:1px solid var(--border2)">
          <div id="lc-level" style="height:100%;width:0;background:var(--green)"></div>
          <div id="lc-mark" style="position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--accent)"></div></div>
        <span style="font-size:11px;color:var(--muted)">Speak: the bar should pass the mark; silence should stay under it.</span>
      </div>
      <div class="toolbar" style="gap:6px">
        <button class="btn btn-sm btn-blue" onclick="liveCallSave()">Save for this screen</button>
        ${mine ? '<button class="btn btn-sm" onclick="liveCallSave(true)">Back to the hive\'s</button>' : ''}
      </div>
    </div>
    ${ex ? `<div style="margin-top:14px;border-top:1px solid var(--border2);padding-top:10px;display:flex;flex-direction:column;gap:6px">
      <div style="font-size:11px;color:var(--muted)">Experiments (developer mode) — for every screen; what each measures and costs is on Settings → Developer.</div>
      ${ex.map(x => `<label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" ${x.on ? 'checked' : ''}
        onchange="liveCallExperiment(${jsArg(x.id)}, this.checked)"> ${escHtml(x.label)}</label>`).join('')}</div>` : ''}
    ${liveCallRealtimeHtml(rt, !!ex)}`;
  panel.append(card);
  liveCallMark();
  document.getElementById('lc-sens').addEventListener('input', liveCallMark);
}

/** The realtime speech model: what a call uses when one is set (modules/realtime). The form is the owner's. */
function liveCallRealtimeHtml(rt, owner) {
  if (!rt) return '';
  const s = rt.settings || {}, v = k => escHtml(s[k] ?? '');
  const state = rt.available ? `<span style="color:var(--green)">On: ${escHtml(rt.protocol)} · ${escHtml(rt.model)}. The 🎙 Live button uses it.</span>`
    : `<span style="color:var(--muted)">Off${rt.experiment ? ': set a model' : ': switch on "Live calls with a realtime speech model" above'} — calls use the speech services above.</span>`;
  const f = (id, label, input) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:11px;color:var(--muted);width:150px;flex-shrink:0">${label}</label>${input}</div>`;
  return `<div style="margin-top:14px;border-top:1px solid var(--border2);padding-top:10px;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:12px;font-weight:600">Realtime speech model</div>
    <div style="font-size:11px;color:var(--muted)">A model that hears and speaks directly, without text in between — quicker, and you can talk over it. It is a voice in front of the hive:
      anything real it hands to your conversation as an ordinary turn, with your approvals. The hub holds the key. ${state}</div>
    ${owner ? `${f('rt-protocol', 'Protocol', `<select class="input" id="rt-protocol" style="width:auto">${['openai', 'gemini'].map(p => `<option value="${p}" ${s.protocol === p ? 'selected' : ''}>${p === 'openai' ? 'OpenAI Realtime (OpenAI, Azure, local servers)' : 'Gemini Live (Google)'}</option>`).join('')}</select>`)}
    ${f('rt-provider', 'Provider (its key)', `<input class="input" id="rt-provider" value="${v('provider')}" placeholder="openai, google, or one from API Keys" style="width:240px">`)}
    ${f('rt-model', 'Model', `<input class="input" id="rt-model" value="${v('model')}" placeholder="gpt-realtime / a Gemini Live model" style="width:240px">`)}
    ${f('rt-voice', 'Voice', `<input class="input" id="rt-voice" value="${v('voice')}" placeholder="the service's default" style="width:160px">`)}
    ${f('rt-url', 'Address (optional)', `<input class="input" id="rt-url" value="${v('url')}" placeholder="wss://… — Azure, or a local server such as ws://127.0.0.1:8765/v1/realtime" style="flex:1;min-width:220px">`)}
    ${f('rt-dialect', 'OpenAI session shape', `<select class="input" id="rt-dialect" style="width:auto"><option value="ga" ${s.dialect !== 'beta' ? 'selected' : ''}>current</option><option value="beta" ${s.dialect === 'beta' ? 'selected' : ''}>beta (older servers)</option></select>`)}
    ${f('rt-wait', 'Wait for the hive', `<input class="input" id="rt-wait" type="number" min="3" max="120" value="${v('waitSec') || 20}" style="width:80px"> s, then it carries on in the background`)}
    <div class="toolbar"><button class="btn btn-sm btn-blue" onclick="liveCallRealtimeSave()">Save the realtime model</button><span class="status-line" id="rt-status"></span></div>` : ''}
  </div>`;
}

async function liveCallRealtimeSave() {
  const g = id => document.getElementById(id).value.trim();
  try {
    await apiFetch('/api/realtime', { method: 'POST', body: { protocol: g('rt-protocol'), provider: g('rt-provider'), model: g('rt-model'), voice: g('rt-voice'), url: g('rt-url'), dialect: g('rt-dialect'), waitSec: Number(g('rt-wait')) || 20 } });
  } catch (e) { return appAlert(e.message); }
  liveCallRender();
}

/** The threshold's place on the meter: the level the call loop compares is 0–~80 (chat-call.js). */
function liveCallMark() {
  const m = document.getElementById('lc-mark'), v = Number(document.getElementById('lc-sens')?.value || 15);
  if (m) m.style.left = `${Math.min(100, v / 80 * 100)}%`;
}

async function liveCallSave(reset = false) {
  const secs = parseFloat(document.getElementById('lc-silence').value), sens = parseInt(document.getElementById('lc-sens').value, 10);
  const value = reset ? null : { ...(secs >= 0.3 ? { silenceMs: Math.round(secs * 1000) } : {}), ...(sens >= 1 ? { sensitivity: sens } : {}),
    listenWithFace: document.getElementById('lc-listen').checked, wakeWord: document.getElementById('lc-word').value.trim() };
  try { await screenSave({ call: value }); } catch (e) { return appAlert(e.message); }
  liveCallStop();
  await screenLoad(true);
  if (typeof wakeWordApply === 'function') wakeWordApply();
  liveCallRender();
}

async function liveCallExperiment(id, on) {
  try { await apiFetch(`/api/experiments/${encodeURIComponent(id)}`, { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  if (typeof _subtabInited !== 'undefined') delete _subtabInited.experiments;   // Settings → Developer redraws when next opened
  await screenLoad(true);
  if (typeof wakeWordApply === 'function') wakeWordApply();
  liveCallRender();
}

/** The microphone's level as the call loop measures it, for ten seconds. */
async function liveCallMeter() {
  if (_liveCallMeter) return liveCallStop();
  let stream;
  try { stream = await micOpen({ echoCancellation: true, noiseSuppression: true }); }
  catch (e) { return appAlert(`The microphone did not open: ${e.message}`); }
  const ctx = new AudioContext(), an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const data = new Uint8Array(an.frequencyBinCount), bar = document.getElementById('lc-level');
  const tick = () => {
    if (!_liveCallMeter) return;
    an.getByteFrequencyData(data);
    const energy = data.reduce((a, b) => a + b, 0) / data.length, sens = Number(document.getElementById('lc-sens')?.value || 15);
    if (bar) { bar.style.width = `${Math.min(100, energy / 80 * 100)}%`; bar.style.background = energy > sens ? 'var(--green)' : 'var(--muted)'; }
    _liveCallMeter.raf = requestAnimationFrame(tick);
  };
  _liveCallMeter = { stream, ctx, timer: setTimeout(liveCallStop, 10000) };
  document.getElementById('lc-test').textContent = '■ Stop';
  tick();
}

function liveCallStop() {
  if (!_liveCallMeter) return;
  cancelAnimationFrame(_liveCallMeter.raf);
  clearTimeout(_liveCallMeter.timer);
  _liveCallMeter.stream.getTracks().forEach(t => t.stop());
  _liveCallMeter.ctx.close().catch(() => {});
  _liveCallMeter = null;
  const b = document.getElementById('lc-test');
  if (b) b.textContent = '🎤 Test the microphone';
  const bar = document.getElementById('lc-level');
  if (bar) bar.style.width = '0';
}
