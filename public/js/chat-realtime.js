/* The 🎙 Live call with a realtime speech model (experiments.realtimeVoice; modules/realtime, TODO H8.3). When the
   hub says one is available, chatToggleCall (chat-call.js) calls here instead of running speech-to-text → turn →
   text-to-speech. The microphone goes to the hub as PCM16 at 24 kHz over /ws/realtime and the model's voice comes
   back the same way; the hub holds the key and relays to whichever service the owner chose. Barge-in is the
   service's own: when it says `interrupted`, what is queued to play is dropped. The model hands real work to the
   hive (the `doca` tool), so what was asked and answered is in the conversation as ordinary turns. */
let _rt = null;

async function realtimeAvailable() {
  try { return !!(await apiFetch('/api/realtime')).available; } catch { return false; }
}

// Collects the microphone in 100 ms frames of float samples (an AudioWorklet, made from a Blob: no extra file).
const _RT_WORKLET = `class DocaMic extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2400); this.n = 0; }
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } }
    return true; } }
registerProcessor('doca-mic', DocaMic);`;

const _rtLevel = f => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; return Math.min(1, Math.sqrt(s / Math.max(1, f.length)) * 4); };

async function realtimeStart() {
  let stream;
  try { stream = await micOpen({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }); }
  catch (e) { chatAppendMsg('system', `The microphone did not open: ${e.message}`); return; }
  const ctx = new AudioContext({ sampleRate: 24000 });
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([_RT_WORKLET], { type: 'application/javascript' })));
  const mic = new AudioWorkletNode(ctx, 'doca-mic');
  ctx.createMediaStreamSource(stream).connect(mic);
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/realtime`);
  ws.binaryType = 'arraybuffer';
  _rt = { ws, ctx, stream, mic, next: 0, playing: new Set(), agentEl: null, agentText: '', ready: false };

  _callActive = true;
  document.getElementById('chat-panel').classList.add('call-active');
  document.getElementById('chat-call-toggle').classList.add('active');
  document.getElementById('chat-input-row').style.display = 'none';
  document.getElementById('chat-call-bar').style.display = 'flex';
  _callSetStatus('Connecting…', '');

  mic.port.onmessage = ({ data }) => {
    if (!_rt?.ready || ws.readyState !== 1) return;
    const pcm = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767)));
    ws.send(pcm.buffer);
    if (!_rt.playing.size && typeof faceCornerVoice === 'function') faceCornerVoice('listening', _rtLevel(data));
  };
  ws.onmessage = ({ data }) => {
    if (data instanceof ArrayBuffer) return _rtPlay(data);
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!_rt && m.type !== 'closed') return;
    if (m.type === 'ready') { _rt.ready = true; _callSetStatus(`Listening… (${m.protocol} · ${m.model})`, 'listening'); }
    else if (m.type === 'user') chatAppendMsg('user', m.text);
    else if (m.type === 'agent') {
      _rt.agentText += m.text;
      if (!_rt.agentEl) _rt.agentEl = chatAppendMsg('assistant', _rt.agentText, { plain: true });
      else _rt.agentEl.textContent = _rt.agentText;
    } else if (m.type === 'done') { _rt.agentEl = null; _rt.agentText = ''; _callSetStatus('Listening…', 'listening'); }
    else if (m.type === 'interrupted') { _rtFlush(); _callSetStatus('Listening…', 'listening'); }
    else if (m.type === 'working') _callSetStatus(`Asking the hive: ${m.text.slice(0, 60)}`, 'processing');
    else if (m.type === 'error') chatAppendMsg('system', `Live call: ${m.message}`);
    else if (m.type === 'closed') {
      const st = m.stats || {};
      chatAppendMsg('system', `Call ended (${m.reason}): ${st.minutes ?? 0} min, ${st.tools || 0} request${st.tools === 1 ? '' : 's'} to the hive${st.background ? ` (${st.background} carried on in the background)` : ''}, interrupted ${st.interrupted || 0}×${st.firstAudioMs != null ? `, first answer after ${(st.firstAudioMs / 1000).toFixed(1)} s` : ''}.`);
    }
  };
  ws.onclose = () => realtimeStop();
}

/** One frame of the model's voice, queued after the last. */
function _rtPlay(buf) {
  if (!_rt) return;
  const pcm = new Int16Array(buf), f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
  const ab = _rt.ctx.createBuffer(1, f.length, 24000);
  ab.copyToChannel(f, 0);
  const src = _rt.ctx.createBufferSource();
  src.buffer = ab;
  src.connect(_rt.ctx.destination);
  const at = Math.max(_rt.ctx.currentTime, _rt.next);
  src.start(at);
  _rt.next = at + ab.duration;
  _rt.playing.add(src);
  src.onended = () => _rt?.playing.delete(src);
  _callSetStatus('Speaking…', 'speaking');
  if (typeof faceCornerVoice === 'function') faceCornerVoice('speaking', _rtLevel(f));
}

/** The person talked over the answer: what is queued is no longer an answer. */
function _rtFlush() {
  if (!_rt) return;
  for (const s of _rt.playing) { try { s.stop(); } catch { /* ended */ } }
  _rt.playing.clear();
  _rt.next = 0;
}

function realtimeStop() {
  if (!_rt) return;
  const r = _rt;
  _rt = null;
  _callActive = false;
  try { if (r.ws.readyState === 1) r.ws.send(JSON.stringify({ type: 'stop' })); } catch { /* closed */ }
  setTimeout(() => { try { r.ws.close(); } catch { /* closed */ } }, 300);   // a moment for the hub's closing line
  r.stream.getTracks().forEach(t => t.stop());
  r.ctx.close().catch(() => {});
  document.getElementById('chat-panel').classList.remove('call-active');
  document.getElementById('chat-call-toggle').classList.remove('active');
  document.getElementById('chat-input-row').style.display = 'flex';
  document.getElementById('chat-call-bar').style.display = 'none';
}
