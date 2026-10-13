/* Meeting notes (modules/meetings/notes.js; docs/design/meeting-notes.md): "📝 Notes" asks everyone in the room; each
   answers Allow or Not me for themselves. Only a page whose person allowed sends its own microphone — an utterance at a
   time, found by its loudness, never while muted — to the hub's speech-to-text, and every line is that person's. The
   notes window: what was said, your own shorthand (kept as you type), "Write it up" (each line made a sentence from
   the transcript by your model, marked as written), and Stop for whoever started. The record is kept when the meeting
   ends (Meetings → the meeting → Notes). */
const NOTES = { on: false, consent: null, lines: [], mine: '', written: [], by: null, agreed: 0, asked: 0, open: false, ear: null, saveT: null };

async function meetNotesLoad() {
  if (!MEET.id) return;
  try { Object.assign(NOTES, await apiFetch(`/api/meetings/${MEET.id}/notes`)); } catch { return; }
  _notesEar();
  _notesDraw();
}

/** The button in the room's controls (meet/draw.js). */
function meetNotesBtn() {
  const label = NOTES.on ? `📝 Notes · ${NOTES.agreed} of ${NOTES.asked}` : '📝 Notes';
  return `<button type="button" class="btn${NOTES.on ? ' meet-on' : ''}" onclick="meetNotesOpen()" title="Notes of this meeting: asked of everyone, only who agrees is transcribed">${escHtml(label)}</button>`;
}

async function meetNotesOpen() {
  if (!NOTES.on) {
    appConfirm('Take notes of this meeting? Everyone in it is asked first; only who says yes is transcribed, on this hub, and a record is kept for the meeting\'s people when it ends.', async () => {
      try { Object.assign(NOTES, await _meetPost('notes/start')); NOTES.open = true; _notesEar(); _notesDraw(); meetDraw(); } catch (e) { appAlert(e.message); }
    });
    return;
  }
  NOTES.open = true; _notesDraw();
}

/** The live feed: notes started (ask), someone answered, a line was heard. */
function meetNotesHeard(c) {
  if (c.what === 'notes-line') { NOTES.lines.push(c.line); _notesDraw(); return; }
  if (c.what !== 'notes') return;
  meetNotesLoad().then(() => { if (NOTES.on && !NOTES.consent) _notesAsk(); if (typeof meetDraw === 'function') meetDraw(); });
}

function _notesAsk() {
  if (document.getElementById('notes-ask')) return;
  const ov = Object.assign(document.createElement('div'), { id: 'notes-ask', className: 'model3d-full hub-links' });
  ov.innerHTML = `<div class="hub-links-body" style="max-width:520px;margin:15vh auto">
    <p><b>${escHtml(NOTES.by || 'Someone')}</b> wants to keep notes of this meeting: what you say is transcribed on this hub, under your name, and kept with the meeting for its people.</p>
    <p class="desc">Not me: nothing you say is sent or transcribed in this meeting. You can leave the notes on for the others.</p>
    <div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="btn btn-teal" data-a="yes">Allow</button><button type="button" class="btn" data-a="no">Not me</button></div></div>`;
  ov.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    ov.remove();
    try { Object.assign(NOTES, await _meetPost('notes/consent', { answer: a })); } catch (err) { appAlert(err.message); }
    _notesEar(); _notesDraw(); meetDraw();
  });
  document.body.append(ov);
}

/** This page's ear: on while notes are on, its person said yes and the microphone is on; an utterance at a time. */
function _notesEar() {
  const want = NOTES.on && NOTES.consent === 'yes' && MEET.local?.getAudioTracks().length;
  if (!want) { NOTES.ear?.stop(); NOTES.ear = null; return; }
  if (NOTES.ear) return;
  const stream = new MediaStream(MEET.local.getAudioTracks());
  const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
  an.fftSize = 1024; src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let rec = null, parts = [], quietSince = 0, startedAt = 0, timer = null;
  const level = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
  const send = blob => {
    if (blob.size < 3000 || !MEET.id) return;
    const fd = new FormData(); fd.append('audio', blob, 'utterance.webm'); fd.append('screen', MEET.me);
    apiFetch(`/api/meetings/${MEET.id}/notes/heard`, { method: 'POST', body: fd }).catch(() => {});
  };
  const tick = () => {
    const loud = MEET.mic && level() > 0.02, now = Date.now();
    if (loud && !rec) {
      parts = []; rec = new MediaRecorder(stream); rec.ondataavailable = e => parts.push(e.data);
      rec.onstop = () => send(new Blob(parts, { type: rec?.mimeType || 'audio/webm' })); rec.start(); startedAt = now; quietSince = 0;
    } else if (rec) {
      if (loud) quietSince = 0; else if (!quietSince) quietSince = now;
      if ((quietSince && now - quietSince > 900) || now - startedAt > 15000) { const r = rec; rec = null; r.stop(); }
    }
  };
  timer = setInterval(tick, 100);
  NOTES.ear = { stop() { clearInterval(timer); if (rec) { rec.onstop = null; rec.stop(); } ctx.close().catch(() => {}); } };
}

function _notesDraw() {
  let ov = document.getElementById('notes-win');
  if (!NOTES.open || !MEET.id) { ov?.remove(); return; }
  if (!ov) {
    ov = Object.assign(document.createElement('div'), { id: 'notes-win', className: 'model3d-full hub-links' });
    document.body.append(ov);
    NOTES.back = typeof overlayBack === 'function' ? overlayBack(() => { NOTES.back = null; NOTES.open = false; document.getElementById('notes-win')?.remove(); }) : null;   // a phone's Back closes it
  }
  const ta = ov.querySelector('textarea'), focused = document.activeElement === ta, pos = ta?.selectionStart;
  ov.innerHTML = `<div class="model3d-bar"><b>Notes</b><span class="desc" style="margin-left:8px">${NOTES.on ? `${NOTES.agreed} of ${NOTES.asked} agreed to be noted` : 'stopped'}</span>
      <span style="flex:1"></span>
      ${NOTES.on ? '<button class="btn btn-xs" type="button" data-stop>Stop notes</button>' : ''}<button class="btn btn-xs" type="button" data-close>✕</button></div>
    <div class="hub-links-body"><div style="display:flex;flex-direction:column;gap:6px;width:100%">
      <div class="input-label">Your notes — a few words a line; Write it up makes each a sentence from what was said</div>
      <textarea class="input" rows="6" style="width:100%;box-sizing:border-box" placeholder="budget q4 → ask Marco&#10;deadline 30th?">${escHtml(NOTES.mine || '')}</textarea>
      <div style="display:flex;gap:8px;align-items:center;margin:6px 0"><button class="btn btn-sm btn-teal" type="button" data-write>Write it up</button><span class="status-line" id="notes-status"></span></div>
      ${NOTES.written.length ? `<div class="input-label">Written up from the transcript (by your model)</div>${NOTES.written.map(w => `<div class="desc" style="margin:4px 0"><b>${escHtml(w.line)}</b> → ${escHtml(w.text)}</div>`).join('')}` : ''}
      <div class="input-label" style="margin-top:10px">What was said${NOTES.consent === 'no' ? ' — you chose Not me: nothing you say is transcribed' : ''}</div>
      <div class="notes-lines" style="max-height:40vh;overflow:auto">${NOTES.lines.map(l => `<div class="desc"><b>${escHtml(l.name)}</b> ${escHtml(l.text)}</div>`).join('') || '<div class="desc">Nothing yet.</div>'}</div>
    </div></div>`;
  const t = ov.querySelector('textarea');
  if (focused) { t.focus(); if (pos != null) t.setSelectionRange(pos, pos); }
  t.oninput = () => { NOTES.mine = t.value; clearTimeout(NOTES.saveT); NOTES.saveT = setTimeout(() => _meetPost('notes/mine', { text: NOTES.mine }).catch(() => {}), 700); };
  ov.querySelector('[data-close]').onclick = () => { NOTES.open = false; const b = NOTES.back; NOTES.back = null; b?.(); _notesDraw(); };
  ov.querySelector('[data-stop]')?.addEventListener('click', async () => { try { Object.assign(NOTES, await _meetPost('notes/stop')); } catch (e) { appAlert(e.message); } _notesEar(); _notesDraw(); meetDraw(); });
  ov.querySelector('[data-write]').onclick = async () => {
    const st = document.getElementById('notes-status');
    setStatus(st, 'writing…', '');
    try { await _meetPost('notes/mine', { text: NOTES.mine }); Object.assign(NOTES, await _meetPost('notes/write')); setStatus(st, '✓', 'ok'); _notesDraw(); }
    catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
  };
  const lines = ov.querySelector('.notes-lines'); if (lines) lines.scrollTop = lines.scrollHeight;
}

/** Leaving the room ends this page's part: the ear stops, the window closes. */
function meetNotesReset() { NOTES.ear?.stop(); Object.assign(NOTES, { on: false, consent: null, lines: [], mine: '', written: [], open: false, ear: null }); document.getElementById('notes-win')?.remove(); document.getElementById('notes-ask')?.remove(); }
