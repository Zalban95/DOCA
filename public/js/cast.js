/* Cast (modules/cast; docs/design/cast-and-devices.md, phase 1): from a phone — or any screen — put a page on another
   screen of yours, shaped for that screen (it shows the page alone, in its own layout: a monitor gets the desk's), and
   keep it there with 🔒 when the phone goes. A screen that cannot sign in (a TV's browser, a mini PC on a monitor) opens
   a view link instead: one page, read-only, as you. Casting to a TV on the phone's own Wi-Fi through the phone comes
   with DocaMobile (phase 2). */
const CAST = { page: null };

async function castOpen(page = (typeof currentTab !== 'undefined' ? currentTab : null)) {
  let d;
  try { d = await apiFetch('/api/cast/targets'); } catch (e) { return appAlert(e.message); }
  CAST.page = d.pages[page] ? page : 'live';
  const ov = Object.assign(document.createElement('div'), { className: 'model3d-full hub-links cast-sheet' });
  const others = d.targets.filter(t => !t.here);
  ov.innerHTML = `<div class="model3d-bar"><b>Cast</b><span style="flex:1"></span><button class="btn btn-xs" type="button">✕</button></div>
    <div class="hub-links-body">
      <label class="input-label">Show <select class="input" id="cast-page" style="width:auto">${Object.entries(d.pages).map(([id, l]) => `<option value="${id}"${id === CAST.page ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select></label>
      <label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="cast-keep" checked> 🔒 Keep it there when ${matchMedia('(pointer: coarse)').matches ? 'this phone' : 'this screen'} goes</label>
      <div id="cast-things"></div>
      <div class="input-label">On a screen of yours</div>
      ${others.length ? others.map(t => `<div class="cast-target"><div><b>${escHtml(t.name)}</b>${t.mine ? '' : ' <span class="desc">(someone else\'s)</span>'}<br>
          <span class="desc">${t.cast?.keep ? `🔒 showing ${escHtml(d.pages[t.cast.page] || t.cast.page)}` : t.shows ? `shows ${escHtml(t.shows)}` : 'not open now: it shows the page when it next opens the panel'}</span></div>
          <span style="display:flex;gap:6px"><button class="btn btn-sm btn-teal" type="button" onclick="castTo('${escHtml(t.id)}', this)">Cast</button>
          ${t.cast ? `<button class="btn btn-sm" type="button" onclick="castStop('${escHtml(t.id)}', this)">Stop</button>` : ''}</span></div>`).join('')
        : '<p class="desc">No other screen of yours yet. Any browser becomes one when you sign in on it — or give it a link below.</p>'}
      <div class="input-label" style="margin-top:14px">A screen that cannot sign in</div>
      <p class="desc">A TV's browser or a computer on a monitor: open this link on it once. It shows the page read-only, as you, until you stop it.</p>
      <button class="btn btn-sm" type="button" onclick="castLink(this)">Make a link</button><div id="cast-link"></div>
    </div>`;
  document.body.append(ov);
  if (typeof castThingsHtml === 'function') castThingsHtml().then(html => { const box = ov.querySelector('#cast-things'); if (box) box.innerHTML = html; });
  const release = overlayBack(() => ov.remove());
  ov.querySelector('.model3d-bar button').onclick = () => { release(); ov.remove(); };
}

async function castTo(screen, btn) {
  const page = document.getElementById('cast-page').value, keep = document.getElementById('cast-keep').checked;
  try {
    await apiFetch('/api/cast/show', { method: 'POST', body: { screen, page, keep } });
    btn.textContent = '✓ Cast'; btn.disabled = true;
  } catch (e) { appAlert(e.message); }
}

async function castStop(screen, btn) {
  try {
    const r = await apiFetch('/api/cast/stop', { method: 'POST', body: { screen } });
    btn.textContent = r.signedOut ? 'Stopped — signed out' : 'Stopped'; btn.disabled = true;
  } catch (e) { appAlert(e.message); }
}

async function castLink(btn) {
  const page = document.getElementById('cast-page').value, box = document.getElementById('cast-link');
  try {
    const l = await apiFetch('/api/cast/links', { method: 'POST', body: { page } });
    box.innerHTML = l.urls.map(u => `<div class="hub-link"><div class="hub-qr">${u.qr || ''}</div><div><b>${escHtml(u.label)}</b><br><code>${escHtml(u.url)}</code></div></div>`).join('')
      + `<p class="desc">Good once, until ${escHtml(new Date(l.until).toLocaleTimeString())}. Or type the code <code style="font-size:18px">${escHtml(l.code)}</code> after <code>/api/cast/open/</code>.</p>`;
    btn.textContent = 'Make another';
  } catch (e) { appAlert(e.message); }
}

// ⎘ in the header beside ⧉ and 📱 — on a phone too (asked 2026-10-12: "I don't see the casting button on mobile"):
// its own class, which the phone's header keeps where it hides ⧉ and 📱 (css/system.css).
if (typeof document !== 'undefined' && typeof window !== 'undefined') window.addEventListener('load', () => {
  if (!document.getElementById('chat-fab')) return;   // the panel only, not a page served alone
  const btn = Object.assign(document.createElement('button'), { className: 'btn btn-xs cast-open', textContent: '⎘', title: 'Cast: put this page on another screen of yours' });
  btn.setAttribute('aria-label', 'Cast this page to another screen');
  btn.onclick = () => castOpen();
  document.getElementById('header-search')?.before(btn);
});
