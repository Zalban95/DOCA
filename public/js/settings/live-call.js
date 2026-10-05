/* Settings → Voice → Live call (TODO H8.3): everything about the 🎙 Live call in one place. How it listens is this
   screen's (the setting `call`, read by chat-call.js when a call starts) — a phone's microphone and a desk's hear a
   room differently; the experiments that change a call (barge-in, the face) are the owner's switches, shown here
   beside them as on Settings → Experiments. A test meter shows the microphone against the threshold. */
let _liveCallMeter = null;

async function liveCallRender() {
  const panel = document.getElementById('sp-voice');
  if (!panel) return;
  document.getElementById('live-call-card')?.remove();
  let s;
  try { s = await screenLoad(true); } catch { return; }
  const c = s.settings?.call || {}, mine = s.from?.call === 'device';
  let ex = null;
  try { ex = (await apiFetch('/api/experiments')).experiments.filter(x => ['bargeIn', 'faceVoice'].includes(x.id)); } catch { /* not the owner: no switches */ }
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
      <div style="font-size:11px;color:var(--muted)">Experiments — for every screen; what each measures and costs is on Settings → Experiments.</div>
      ${ex.map(x => `<label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" ${x.on ? 'checked' : ''}
        onchange="liveCallExperiment(${jsArg(x.id)}, this.checked)"> ${escHtml(x.label)}</label>`).join('')}</div>` : ''}
    <p style="font-size:11px;color:var(--muted);margin-top:12px">A realtime speech model (one that hears and speaks without the text in between) is not here yet: which provider — a hosted one or a local model — is still open (TODO H8.3).</p>`;
  panel.append(card);
  liveCallMark();
  document.getElementById('lc-sens').addEventListener('input', liveCallMark);
}

/** The threshold's place on the meter: the level the call loop compares is 0–~80 (chat-call.js). */
function liveCallMark() {
  const m = document.getElementById('lc-mark'), v = Number(document.getElementById('lc-sens')?.value || 15);
  if (m) m.style.left = `${Math.min(100, v / 80 * 100)}%`;
}

async function liveCallSave(reset = false) {
  const secs = parseFloat(document.getElementById('lc-silence').value), sens = parseInt(document.getElementById('lc-sens').value, 10);
  const value = reset ? null : { ...(secs >= 0.3 ? { silenceMs: Math.round(secs * 1000) } : {}), ...(sens >= 1 ? { sensitivity: sens } : {}) };
  try { await screenSave({ call: value }); } catch (e) { return appAlert(e.message); }
  liveCallStop();
  liveCallRender();
}

async function liveCallExperiment(id, on) {
  try { await apiFetch(`/api/experiments/${encodeURIComponent(id)}`, { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  if (typeof _subtabInited !== 'undefined') delete _subtabInited.experiments;   // Settings → Experiments redraws when next opened
}

/** The microphone's level as the call loop measures it, for ten seconds. */
async function liveCallMeter() {
  if (_liveCallMeter) return liveCallStop();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { return appAlert(`The microphone: ${e.message}`); }
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
