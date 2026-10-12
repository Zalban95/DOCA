/* Made for you — "make me an app or a website": the person's sentence as the title, the plan's steps as plain lines
   with points (done, working, still to do), a live preview of what was made (a canvas or a served page through its
   preview, at computer or phone width) with Open and Share, a field to change it or ask for something new, and what
   was made before. Nothing new underneath: the work is a work chat with its living plan (harness/background.js), the
   page is the agent's `canvas` (open or preview), and a change is said to the person's conversation, which hands it on. */
let _fcMakeId = null;   // the work chat shown

/** Show one piece of work (a work chat's id), from the strip or the list. */
function fcMakeOpen(id) { _fcMakeId = id || null; fcGo('made'); }

async function fcMakeRender(el) {
  el.innerHTML = `
    <div class="fc-make">
      <section class="fc-make-side">
        <h1 class="fc-make-title" id="fc-make-title">Make me an app or a website</h1>
        <div class="fc-card fc-pad fc-steps" id="fc-make-steps" hidden></div>
        <div class="fc-card fc-pad" id="fc-make-before-card"><span class="fc-lab">Made before</span><div id="fc-make-before"><div class="fc-muted fc-small fc-row-empty">…</div></div></div>
        <form class="fc-compose fc-make-ask" onsubmit="event.preventDefault();fcMakeAsk()">
          <label for="fc-make-in" class="fc-sr">Make something new, or change this one</label>
          <input id="fc-make-in" class="input fc-field" autocomplete="off" placeholder="Describe it — “a sign-up page for Saturday, with shifts”">
          <button class="fc-btn fc-p fc-go">Go</button>
        </form>
      </section>
      <section class="fc-card fc-make-prev" id="fc-make-prev" hidden>
        <div class="fc-head"><span class="fc-lab">Preview</span>
          <div class="fc-seg" role="group" aria-label="Preview size"><button type="button" class="on" aria-pressed="true" onclick="fcMakeSize(this,'')">Computer</button><button type="button" aria-pressed="false" onclick="fcMakeSize(this,'phone')">Phone</button></div></div>
        <div class="fc-browser"><div class="fc-browser-bar"><i></i><i></i><i></i><span class="fc-mono fc-muted fc-small" id="fc-make-url"></span></div>
          <div class="fc-browser-body"><iframe id="fc-make-frame" title="Preview" referrerpolicy="no-referrer"></iframe></div></div>
        <div class="fc-acts" id="fc-make-acts"></div>
      </section>
    </div>`;
  const hist = await fcHistory().catch(() => ({}));
  const jobs = await fcBackground(hist.sessionId);
  const made = _fcMadeIn(hist.messages || []);
  if (!document.getElementById('fc-make-before')) return;
  const id = _fcMakeId || jobs.find(j => j.running)?.id || jobs[0]?.id || null;
  _fcMakeBefore(jobs.filter(j => j.id !== id), made);
  if (id) _fcMakeShow(id);
  else if (made[0]) _fcMakePreview(made[0]);
}

/** The canvases and previews the agent showed in a list of rows, newest first. */
function _fcMadeIn(rows) {
  const out = [];
  for (const m of rows) for (const img of m.images || []) if (img?.kind === 'canvas') out.push({ ...img, when: m.time || m.at || null });
  return out.reverse();
}

function _fcMakeBefore(jobs, made) {
  const box = document.getElementById('fc-make-before');
  const rows = [
    ...jobs.map(j => `<button type="button" class="fc-made" onclick="fcMakeOpen(${jsArg(j.id)})"><span class="fc-thumb fc-thumb-s" aria-hidden="true"><b></b></span><span class="fc-bright fc-made-t">${escHtml(j.title || 'Work')}</span><span class="fc-mono fc-muted fc-small">${j.running ? 'working' : escHtml(j.state || '')}</span></button>`),
    ...made.slice(0, 8).map((m, i) => `<button type="button" class="fc-made" data-made="${i}"><span class="fc-thumb fc-thumb-s" aria-hidden="true"><b></b></span><span class="fc-bright fc-made-t">${escHtml(m.caption || 'A page')}</span><span class="fc-mono fc-muted fc-small">${m.when ? escHtml(fcAgo(m.when)) : ''}</span></button>`),
  ];
  box.innerHTML = rows.join('') || `<div class="fc-row-empty fc-muted fc-small">Nothing made yet. Say what you would like — a page for an event, a small app for the family — and ${escHtml(fcProduct())} makes it and shows it here.</div>`;
  box.querySelectorAll('[data-made]').forEach(b => { b.onclick = () => _fcMakePreview(made[Number(b.dataset.made)]); });
}

/** One work chat: its request, its plan's steps, and the newest page it showed. */
async function _fcMakeShow(id) {
  let data;
  try { data = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}`); } catch { return; }
  if (!document.getElementById('fc-make-title')) return;
  const s = data.session || {}, msgs = data.messages || [];
  // A work chat handed on from the main chat starts with the hand-off (harness/fork.js): the person's words follow "Their request:".
  const first = String(msgs.find(m => m.role === 'user')?.content || '');
  const asked = ((/Their request:\n([^\n]+)/.exec(first) || [])[1] || first.split('\n')[0]).trim();
  const title = asked && asked.length < 160 && !/^\[/.test(asked) ? `“${asked}”` : (s.title || 'Work');
  fcText('fc-make-title', title);
  const steps = s.plan?.steps || [], prog = s.plan?.progress || {};
  const box = document.getElementById('fc-make-steps');
  if (steps.length) {
    box.hidden = false;
    box.innerHTML = steps.map((t, i) => { const st = prog[i + 1] || 'queued'; if (st === 'cancelled') return '';
      return `<div class="fc-step ${st}"><span class="fc-step-mark">${st === 'done' ? fcIcon('check', 16) : `<span class="fc-pt${st === 'running' ? ' run' : ' q'}"></span>`}</span><span class="${st === 'running' ? 'fc-bright' : ''}">${escHtml(t)}</span></div>`; }).join('');
  } else box.hidden = true;
  const page = _fcMadeIn(msgs)[0];
  if (page) _fcMakePreview(page);
}

/** Show a made page in the preview, with Open and Share. */
async function _fcMakePreview(media) {
  const card = document.getElementById('fc-make-prev'), frame = document.getElementById('fc-make-frame');
  if (!card || !media) return;
  let url = '';
  try {
    if (media.previewId) {
      const i = await apiFetch(`/api/harness/previews/${encodeURIComponent(media.previewId)}`);
      url = `${location.protocol}//${location.hostname}:${i.canvasPort}${i.path}${media.at && String(media.at).startsWith('/') ? media.at : '/'}`;
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin');
    } else if (media.canvasId) {
      const i = await apiFetch(`/api/harness/canvases/${encodeURIComponent(media.canvasId)}`);
      url = `${location.protocol}//${location.hostname}:${i.port}${i.path}/${media.rev || i.canvas.revisions.at(-1).rev}`;
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-downloads');
    }
  } catch (e) { url = ''; fcText('fc-make-url', `Not shown: ${e.message}`); }
  card.hidden = false;
  if (url) { frame.src = url; fcText('fc-make-url', media.caption || 'Preview'); }
  const acts = document.getElementById('fc-make-acts');
  acts.replaceChildren();
  const add = (label, fn, kind) => { const b = Object.assign(document.createElement('button'), { type: 'button', className: `fc-btn${kind ? ` fc-${kind}` : ''}`, textContent: label }); b.onclick = fn; acts.append(b); };
  add('Open', () => (media.previewId ? canvasPreviewOpen(media.previewId, media.at || '/') : canvasOpen(media.canvasId, media.rev)));
  add('Share link', () => fcShare(media));
  add('Ask about it', () => fcComposeFill(`About “${media.caption || 'the page'}”: `), 'q');
}

function fcMakeSize(btn, size) {
  btn.parentElement.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
  document.getElementById('fc-make-prev')?.classList.toggle('fc-phone-size', size === 'phone');
}

/** Make something new, or change the one shown: said to the person's conversation, which hands the work on. */
function fcMakeAsk() {
  const i = document.getElementById('fc-make-in');
  const t = i?.value.trim();
  if (!t) return i?.focus();
  i.value = '';
  const about = _fcMakeId && document.getElementById('fc-make-title')?.textContent;
  fcAskAgent(about && !/^Make me/.test(about) ? `About ${about}: ${t}` : t);
}
