/* Field → API keys → DOCA apps (modules/client-apps): the newest DocaMobile and DocaWear APKs this hub keeps — to
   download, to upload, or to build right here from their repositories — and the key they are signed with. A phone's
   DocaMobile checks /api/v1/clients/android/docamobile and offers (or installs) what is newer than itself. */
async function clientAppsRender() {
  const panel = document.querySelector('#sp-keys .scroll-y') || document.getElementById('sp-keys');
  if (!panel) return;
  let card = document.getElementById('client-apps-card');
  if (!card) { card = Object.assign(document.createElement('div'), { className: 'card', id: 'client-apps-card' }); panel.prepend(card); }
  let s;
  try { s = await apiFetch('/api/clients/apps'); } catch (e) { card.innerHTML = `<div class="card-title">DOCA apps</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const host = typeof authHasRight === 'function' ? authHasRight('host') : true;
  const row = (id, a) => {
    const l = a.latest;
    return `<div class="tool-row" style="grid-template-columns:auto 1fr auto;align-items:center">
      <span class="tool-label">${escHtml(a.label)}</span>
      <span class="tool-note" style="white-space:normal">${l ? `<b>${escHtml(l.versionName)}</b> (${l.versionCode}) · ${(l.bytes / 1e6).toFixed(1)} MB · ${l.from === 'build' ? 'built here' : 'uploaded'} ${escHtml(new Date(l.at).toLocaleString())}` : 'No build kept yet.'}
        ${host ? `<br>Source: <input class="input" id="ca-repo-${id}" value="${escHtml(a.repo)}" placeholder="the repository folder on this machine" style="width:min(360px,60vw);margin-top:4px">
          <button class="btn btn-xs" onclick="clientAppsRepo('${id}')">Save</button>` : ''}</span>
      <span class="tool-actions" style="flex-wrap:wrap;gap:4px">
        ${l ? `<a class="btn btn-xs btn-teal" href="/api/clients/apps/${id}/apk" download>⬇ APK</a>` : ''}
        ${l && host ? `<button class="btn btn-xs" onclick="clientAppsLink('${id}')" title="A link that needs no sign-in, for 10 minutes — to open on a phone">🔗 Link</button>` : ''}
        ${host ? `<button class="btn btn-xs" ${a.repo ? '' : 'disabled title="Say where its repository is"'} onclick="clientAppsBuild('${id}', true)" title="git pull, build, keep">⟳ Pull &amp; build</button>
          <label class="btn btn-xs" title="Keep an APK built elsewhere">⬆ Upload<input type="file" accept=".apk" hidden onchange="clientAppsUpload('${id}', this.files[0])"></label>` : ''}
      </span></div>`;
  };
  card.innerHTML = `<div class="card-title">DOCA apps</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">The newest DocaMobile and DocaWear this hub hands out. DocaMobile checks here and
      offers the update itself (Settings → Updates in the app). Build them here from their repositories, or upload an APK built elsewhere.
      An update installs only over an app signed with the same key: ${s.signing.kept ? `the hub signs with its key (${escHtml(s.signing.alias || '')}, ${escHtml(s.signing.sha256 || '')}).`
        : '<b>the hub holds no signing key yet</b> — builds here use this machine\'s debug key.'}</p>
    ${Object.entries(s.apps).map(([id, a]) => row(id, a)).join('')}
    <pre id="client-apps-out" class="terminal" style="display:none;margin-top:8px;max-height:min(45vh,360px)"></pre>`;
}

async function clientAppsRepo(id) {
  try { await apiFetch(`/api/clients/apps/${id}/repo`, { method: 'POST', body: { repo: document.getElementById(`ca-repo-${id}`).value } }); }
  catch (e) { return appAlert(e.message); }
  clientAppsRender();
}

async function clientAppsBuild(id, pull) {
  const out = document.getElementById('client-apps-out');
  showStream(out, '');
  await sseStream(`/api/clients/apps/${id}/build`, { pull }, {
    onStatus: text => appendStream(out, text),
    onError: e => appendStream(out, `\nError: ${e.message}`),
  });
  clientAppsRender().then(() => { const o = document.getElementById('client-apps-out'); if (o && out) { o.style.display = 'block'; o.textContent = out.textContent; } });
}

async function clientAppsUpload(id, file) {
  if (!file) return;
  try {
    const r = await fetch(`/api/clients/apps/${id}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'Sec-Fetch-Site': 'same-origin' } });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  } catch (e) { return appAlert(e.message); }
  clientAppsRender();
}

/** A ten-minute link that needs no sign-in, to open in a phone's browser (or send it). */
async function clientAppsLink(id) {
  let l;
  try { l = await apiFetch(`/api/clients/apps/${id}/link`, { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
  try { await navigator.clipboard.writeText(l.url); } catch { /* not allowed here */ }
  appAlert(`For 10 minutes, this opens the download without signing in (copied if the browser allowed it):\n\n${l.url}`);
}
