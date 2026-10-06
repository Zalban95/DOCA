/* Hearing the wake word with a model trained for it, on the screen itself (experiments.wakeModel; modules/wakeword,
   docs/experiments/wake-model.md). openWakeWord's three steps, run by ONNX Runtime in WebAssembly on the microphone the
   wake word already holds: every 80 ms of 16 kHz sound → a mel spectrogram (the runtime's shared model) → one speech
   embedding of the last 76 frames (the other shared model) → the word's own model over the last 16 embeddings → a score.
   Nothing is sent anywhere until the score passes the threshold. */
const WAKE_ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const _wmAvail = new Map();   // word → model URL or '' (asked once per page)

const _wmSlug = w => String(w || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 30);

/** Whether this hub keeps a model for the word: its address, or ''. */
async function wakeModelFor(word) {
  const name = _wmSlug(word);
  if (_wmAvail.has(name)) return _wmAvail.get(name);
  const url = `/api/wakeword/models/${encodeURIComponent(name)}/model.onnx`;
  let ok = false;
  try { ok = (await fetch(url, { method: 'HEAD' })).ok; } catch { /* none */ }
  _wmAvail.set(name, ok ? url : '');
  return ok ? url : '';
}

async function _wmOrt() {
  if (window.ort) return window.ort;
  await new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: `${WAKE_ORT_URL}ort.min.js`, onload: resolve, onerror: () => reject(new Error('ONNX Runtime did not load')) });
    document.head.append(s);
  });
  window.ort.env.wasm.wasmPaths = WAKE_ORT_URL;
  return window.ort;
}

/** Listen on `stream` for the word; `onWake(score)` when heard. Returns {stop()}. Throws when the model cannot run. */
async function wakeModelStart(stream, url, { onWake, threshold = 0.5, onScore } = {}) {
  const ort = await _wmOrt();
  const load = async u => ort.InferenceSession.create(new Uint8Array(await (await fetch(u)).arrayBuffer()), { executionProviders: ['wasm'] });
  const [mel, emb, word] = await Promise.all([load('/api/wakeword/runtime/melspectrogram.onnx'), load('/api/wakeword/runtime/embedding_model.onnx'), load(url)]);
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(2048, 1, 1);
  const raw = [], mels = Array.from({ length: 76 }, () => new Float32Array(32).fill(1)), feats = [];
  let pending = new Float32Array(0), quietUntil = 0, stopped = false, working = false;
  const queue = [];
  // Each 80 ms chunk in order — the spectrogram must have no gaps — by one worker; a screen that falls far behind drops
  // the oldest second rather than answering late.
  const step = async chunk => {
    for (const v of chunk) raw.push(v);
    if (raw.length > 16000) raw.splice(0, raw.length - 16000);
    if (raw.length < 1760) return;
    const m = (await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', Float32Array.from(raw.slice(-1760)), [1, 1760]) }))[mel.outputNames[0]];
    const frames = m.data.length / 32;
    for (let f = 0; f < frames; f++) mels.push(Float32Array.from(m.data.subarray(f * 32, f * 32 + 32), v => v / 10 + 2));
    while (mels.length > 970) mels.shift();
    const last = new Float32Array(76 * 32);
    mels.slice(-76).forEach((r, k) => last.set(r, k * 32));
    const e = (await emb.run({ [emb.inputNames[0]]: new ort.Tensor('float32', last, [1, 76, 32, 1]) }))[emb.outputNames[0]];
    feats.push(Float32Array.from(e.data));
    while (feats.length > 16) feats.shift();
    if (feats.length < 16) return;
    const x = new Float32Array(16 * 96);
    feats.forEach((r, k) => x.set(r, k * 96));
    const score = (await word.run({ [word.inputNames[0]]: new ort.Tensor('float32', x, [1, 16, 96]) }))[word.outputNames[0]].data[0];
    onScore?.(score);
    if (score >= threshold && performance.now() > quietUntil) { quietUntil = performance.now() + 2000; feats.length = 0; onWake?.(score); }
  };
  const work = async () => {
    if (working) return;
    working = true;
    try { while (queue.length && !stopped) { if (queue.length > 12) queue.splice(0, queue.length - 12); await step(queue.shift()); } }
    catch (e) { console.warn('wake model:', e.message); }
    finally { working = false; }
  };
  proc.onaudioprocess = ev => {
    if (stopped) return;
    const input = ev.inputBuffer.getChannelData(0);
    const next = new Float32Array(pending.length + input.length);
    next.set(pending); next.set(input.map(v => Math.max(-1, Math.min(1, v)) * 32767), pending.length);
    pending = next;
    while (pending.length >= 1280) { queue.push(pending.slice(0, 1280)); pending = pending.slice(1280); }
    work();
  };
  src.connect(proc); proc.connect(ctx.destination);
  if (ctx.state === 'suspended') ['pointerdown', 'keydown', 'touchend'].forEach(t => document.addEventListener(t, () => ctx.resume().catch(() => {}), { passive: true }));
  return { ctx, stop() { stopped = true; try { proc.disconnect(); src.disconnect(); } catch { /* gone */ } ctx.close().catch(() => {}); } };
}
