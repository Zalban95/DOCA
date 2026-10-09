/* ═══════════════════════════════════════════════════════
   Media and documents the agent shows in a transcript.
   Shared by chat.js and harness.js.
   ═══════════════════════════════════════════════════════ */

/**
 * Media in the transcript: a picture drawn, a video or a sound with a player.
 *
 * Built from elements, never innerHTML, and the address is always the panel's
 * own attachment route built from a name — never a URL a model wrote. A chat
 * that draws markdown images fetches whatever address the model was talked into
 * writing, which is how a prompt injection sends a conversation to someone
 * else's server; that is why text stays text here.
 *
 * The same three kinds the Files tab previews, so a file that plays when you
 * click it there plays when the agent sends it here. `kind` comes from the
 * server (`attachments.playableKind`); the extension is only a fallback for
 * rows written before it was recorded.
 *
 * @param {{ name: string, kind?: 'image'|'audio'|'video', mime?: string, caption?: string }} media
 * @param {() => void} [onLoad]  e.g. scroll the transcript once the height is known
 */
function agentImageEl(media, onLoad) {
  const url  = `/api/attachments/${encodeURIComponent(media.name)}`;
  const kind = media.kind || _mediaKindOf(media.mime, media.name) || 'image';

  const fig = document.createElement('figure');
  fig.className = `agent-image agent-media-${kind}`;

  const fail = note => {
    fig.classList.add('missing');
    fig.textContent = `${media.name} ${note}`;
  };

  if (kind === 'canvas') {
    // A page the agent made (agent-ui/canvas.js): a button, opened in its own window.
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'agent-doc';
    open.title = 'Open the canvas';
    open.textContent = media.previewId
      ? `◧ Open preview: ${media.caption || 'Preview'}`
      : `◧ Open canvas: ${media.caption || 'Canvas'}${media.rev > 1 ? ` (rev ${media.rev})` : ''}`;
    open.addEventListener('click', () => (media.previewId ? canvasPreviewOpen(media.previewId, media.at) : canvasOpen(media.canvasId, media.rev)));
    fig.appendChild(open);
    return fig;
  }

  if (kind === 'model') {
    // A 3D model (lib/model3d.js): drawn in the transcript, turning; ⤢ for the whole screen.
    const box = document.createElement('div');
    box.className = 'agent-model';
    const full = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-xs agent-model-full', textContent: '⤢', title: 'Full screen' });
    full.addEventListener('click', () => model3dFull(url, media.caption || media.name));
    fig.append(box, full);
    if (media.caption) fig.append(Object.assign(document.createElement('figcaption'), { textContent: media.caption }));
    requestAnimationFrame(() => model3dInto(box, url, media.name).then(() => onLoad?.()));
    return fig;
  }

  if (kind === 'doc') {
    // A document is a row that opens a window, not something drawn in the
    // transcript: a plan pasted into a conversation scrolls away, and a plan
    // written to a file is never opened. The row stays; the window is a click.
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'agent-doc';
    open.title = 'Open it';
    open.textContent = `📄 ${media.caption || media.name}`;
    open.addEventListener('click', () => agentDocOpen(media));
    fig.appendChild(open);
    _agentPlanArrived(media);
    return fig;
  }

  if (kind === 'audio' || kind === 'video') {
    // Controls and nothing else: no autoplay, because a transcript that starts
    // talking when it is reopened is a transcript nobody reopens.
    const el = document.createElement(kind);
    el.src = url; el.controls = true; el.preload = 'metadata';
    if (onLoad) el.addEventListener('loadedmetadata', onLoad, { once: true });
    el.addEventListener('error', () => fail('cannot be played — it is no longer in the attachments folder'), { once: true });
    fig.appendChild(el);
    // Full screen in the page (agent-ui/media-viewer.js), where Back closes it.
    const big = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-xs agent-media-expand', textContent: '⤢ Full screen' });
    big.addEventListener('click', () => { el.pause?.(); mediaViewerOpen({ src: url, kind, name: media.caption || media.name, download: url }); });
    fig.appendChild(big);
  } else {
    const link = document.createElement('a');
    link.href = url; link.target = '_blank'; link.rel = 'noopener';
    link.title = 'Open full size';
    // Opened in the page, zoomable, and closed by Back — a tab of its own on a phone was a dead end (2026-10-04).
    link.addEventListener('click', e => { e.preventDefault(); mediaViewerOpen({ src: url, kind: 'image', name: media.caption || media.name, download: url }); });
    const img = document.createElement('img');
    img.src = url; img.alt = media.caption || media.name;
    // Not loading="lazy": a lazy image has no size until it loads, a shrink-to-fit
    // chat bubble gives it none, and the browser then never finds it near the
    // viewport — the floating chat drew a 2 px box and never fetched it.
    img.decoding = 'async';
    if (onLoad) img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', () => {
      fig.classList.add('missing');
      img.remove();
      link.textContent = `${media.name} is no longer in the attachments folder`;
    }, { once: true });
    link.appendChild(img);
    fig.appendChild(link);
  }

  if (media.caption) {
    const cap = document.createElement('figcaption');
    cap.textContent = media.caption;
    fig.appendChild(cap);
  }
  return fig;
}

/**
 * What a chat does with this file, or null when it is not media at all.
 *
 * The server says so on anything it sent (`attachments.playableKind`); this is
 * for the other direction — a row that stores only the name, and a reloaded
 * transcript that has to decide whether a file the user attached is a picture
 * to draw or a zip to leave alone. Null is the useful half: it is what keeps a
 * PDF out of an `<img>`.
 */
function _mediaKindOf(mime, name = '') {
  const m = String(mime || '');
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  const ext = String(name).split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'opus', 'flac', 'aac', 'weba'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (m.startsWith('model/') || (typeof model3dIs === 'function' && model3dIs(name))) return 'model';
  return null;
}

/**
 * Open a document the agent showed — a plan, a brief, a report.
 *
 * Rendered as markdown, in a window that stays until it is closed, with the
 * conversation carrying on underneath. It is fetched rather than carried in the
 * transcript, because the transcript is the record of what was said and a plan
 * is a thing that was written.
 */
async function agentDocOpen(media) {
  const overlay = document.getElementById('agent-doc-overlay');
  const title   = document.getElementById('agent-doc-title');
  const body    = document.getElementById('agent-doc-body');
  if (!overlay || !body) return;

  title.textContent = media.caption || media.name;
  body.textContent = 'Opening…';
  overlay.style.display = 'flex';
  // Back closes the window rather than leaving the page (agent-ui/media-viewer.js).
  overlay._release?.();
  overlay._release = overlayBack(() => { overlay._release = null; overlay.style.display = 'none'; });
  overlay.dataset.name = media.name;
  _agentDocActions(media);

  try {
    const res = await fetch(`/api/attachments/${encodeURIComponent(media.name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (overlay.dataset.name !== media.name) return;   // another document opened meanwhile: not this text under its title
    body.textContent = '';
    // The same renderer the transcript uses, so a plan reads the way the agent
    // wrote it — and, like everywhere else, from elements rather than markup.
    mdInto(body, text);
  } catch (e) {
    body.textContent = `Could not open ${media.name}: ${e.message}`;
  }
}

/**
 * A plan the agent has just proposed opens by itself: it is a question to the
 * person, and a question in a row they have to notice is one they miss. Only a
 * fresh one, once per page — a transcript reopened tomorrow draws the row and
 * leaves the window shut.
 */
const _agentPlansOpened = new Set();
async function _agentPlanArrived(media) {
  const at = Date.parse(media.plan?.at || '');
  if (!media.plan || _agentPlansOpened.has(media.name) || !(Date.now() - at < 120000)) return;
  _agentPlansOpened.add(media.name);
  // Still waiting? A plan approved a minute ago reopened, on a reload, asking again (live test 2026-10-04).
  const now = await apiFetch(`/api/harness/sessions/${encodeURIComponent(media.plan.sessionId)}/inbox`).then(r => r.plan).catch(() => null);
  if (now && (now.state !== 'proposed' || now.revision !== media.plan.revision)) return;
  agentDocOpen(media);
}

/**
 * The window's buttons: Close always, and Approve / Reject when the document
 * is a proposed plan. The server decides whether the decision still applies
 * (a newer revision, or one already answered), and its sentence is shown as is.
 */
function _agentDocActions(media) {
  const bar = document.getElementById('agent-doc-actions');
  if (!bar) return;
  bar.textContent = '';
  const button = (label, cls, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `btn btn-xs ${cls}`; b.textContent = label;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };
  if (media.plan) {
    const note = document.createElement('small');
    note.className = 'agent-doc-note';
    note.style.cssText = 'margin-right:auto;opacity:.8';
    const decide = action => async () => {
      bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        const r = await apiFetch(`/api/harness/sessions/${encodeURIComponent(media.plan.sessionId)}/plan`,
          { method: 'POST', body: { action, revision: media.plan.revision } });
        note.textContent = action !== 'approve' ? 'Plan rejected — the chat is told. Say why there, so a next revision fixes it.'
          : r.started?.started ? 'Approved — the agent has started on it.' : `Approved. ${r.started?.reason || ''}`;
        bar.querySelectorAll('.btn-green, .agent-doc-reject').forEach(b => b.remove());
      } catch (e) {
        note.textContent = e.message;
      }
      bar.querySelectorAll('button').forEach(b => { b.disabled = false; });
    };
    bar.appendChild(note);
    button(`Approve revision ${media.plan.revision}`, 'btn-green', decide('approve'));
    button('Reject', 'agent-doc-reject', decide('reject'));
  }
  button('close', '', () => agentDocClose());
}

function agentDocClose(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('agent-doc-overlay');
  if (overlay) { overlay.style.display = 'none'; overlay._release?.(); overlay._release = null; }
}
