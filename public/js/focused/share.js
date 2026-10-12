/* Share a made page. A hub listens on the tailnet (and the home network, when its owner allows) — not on the open
   internet — so today's link opens on the person's own devices and on their network, and the sheet says so plainly.
   Sharing is a list of ways (FOCUSED_SHARE): the hub's own address is the first; a public relay or an app that
   publishes a page registers itself here later ({id, label, reach: 'public', link(media) → url}) and is offered first,
   with no change to the cards that call fcShare. A link is never built from anything but the hub's own answers. */
const FOCUSED_SHARE = [];

/** Another way to share (a relay, a publishing app): tried before the hub's own address. */
function focusedShareRegister(way) { if (way?.id && typeof way.link === 'function') FOCUSED_SHARE.unshift(way); }

/** The hub's own address for a made page: its best name (the Tailscale name, else an address it answers at). */
const _fcShareHub = { id: 'hub', label: 'Your network', reach: 'network', async link(media) {
  const links = await fcGet('/api/hub/links', 600000).catch(() => ({ links: [] }));
  const best = (links.links || [])[0];
  const host = best ? new URL(best.url).hostname : location.hostname;
  const proto = best ? new URL(best.url).protocol : location.protocol;
  if (media.previewId) {
    const i = await apiFetch(`/api/harness/previews/${encodeURIComponent(media.previewId)}`);
    return { url: `${proto}//${host}:${i.canvasPort}${i.path}${media.at && String(media.at).startsWith('/') ? media.at : '/'}`, until: i.preview?.expiresAt || null, label: best?.label || '' };
  }
  const i = await apiFetch(`/api/harness/canvases/${encodeURIComponent(media.canvasId)}`);
  return { url: `${proto}//${host}:${i.port}${i.path}/${media.rev || i.canvas.revisions.at(-1).rev}`, until: null, label: best?.label || '' };
} };

async function fcShare(media) {
  if (!media) return;
  let got = null, way = null;
  for (const w of [...FOCUSED_SHARE, _fcShareHub]) { try { got = await w.link(media); if (got?.url) { way = w; break; } } catch { /* the next way */ } }
  if (!got?.url) return appAlert('This page cannot be shared from here.');
  const reach = way.reach === 'public'
    ? 'Anyone with this link can open it.'
    : `This link opens on your own devices and on your network${got.label ? ` (${got.label})` : ''} — not for people outside it yet.`;
  const until = got.until ? ` It works until ${new Date(got.until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.` : '';
  const sheet = Object.assign(document.createElement('div'), { className: 'fc-sheet-back' });
  sheet.innerHTML = `<div class="fc-sheet fc-card" role="dialog" aria-label="Share a link">
      <div class="fc-head"><span class="fc-lab">Share a link</span><button type="button" class="fc-btn fc-q fc-ib" aria-label="Close" data-x>×</button></div>
      <div class="fc-bright fc-result-t">${escHtml(media.caption || 'A page made for you')}</div>
      <input class="input fc-field fc-mono fc-share-url" readonly value="${escHtml(got.url)}" aria-label="The link">
      <p class="fc-muted fc-small">${escHtml(reach + until)}</p>
      <div class="fc-acts"><button type="button" class="fc-btn fc-p" data-copy>Copy link</button>${navigator.share ? '<button type="button" class="fc-btn" data-send>Send…</button>' : ''}</div></div>`;
  document.getElementById('focused')?.append(sheet);
  const close = () => sheet.remove();
  sheet.onclick = e => { if (e.target === sheet || e.target.closest('[data-x]')) close(); };
  sheet.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(got.url); fcToast('Link copied.'); close(); }
    catch { sheet.querySelector('.fc-share-url').select(); }
  };
  const send = sheet.querySelector('[data-send]');
  if (send) send.onclick = () => navigator.share({ title: media.caption || '', url: got.url }).then(close).catch(() => {});
}
