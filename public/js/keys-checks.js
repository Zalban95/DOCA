/* Field → API keys → External providers: what is wrong with the providers kept, with the fix one click away
   (modules/provider-checks.js). The same provider twice at one address ("Mistral" with the key, "mistral" without):
   merged into the one holding the key, the settings pointed at it. An OpenAI-compatible server kept without its /v1:
   asked at both, and the fix offered only when /v1 answers. Read after the list is drawn; nothing changes unclicked. */
async function keysChecksLoad() {
  const box = document.getElementById('providers-checks');
  if (!box) return;
  let c;
  try { c = await apiFetch('/api/keys/checks'); } catch { box.innerHTML = ''; return; }
  box.innerHTML = (c.duplicates || []).map(g => `<div class="svc-draft-line keys-check">
      <span class="pt pt-ask"></span> <b>${[g.keep, ...g.drop].map(escHtml).join('</b> and <b>')}</b> are the same provider (${escHtml(g.address)}).
      <button class="btn btn-xs btn-primary" onclick="keysMerge(${jsArg(g.keep)}, ${escHtml(JSON.stringify(g.drop))})">Merge into ${escHtml(g.keep)}${g.keep !== g.drop[0] ? ' (keeps its key)' : ''}</button></div>`).join('');
  for (const v of c.versions || []) {
    const st = document.getElementById(`key-status-${v.name}`);
    if (!st) continue;
    st.innerHTML = `<span class="pt pt-ask"></span> ${escHtml(v.said)}${v.fix ? ` <button class="btn btn-xs" onclick="keysUseV1(${jsArg(v.name)}, ${jsArg(v.fix)})">Use ${escHtml(v.fix)}</button>` : ''}`;
    st.classList.add('keys-check');
  }
}

async function keysMerge(keep, drop) {
  try {
    const r = await apiFetch('/api/keys/merge', { method: 'POST', body: { keep, drop } });
    appAlert(`Merged ${r.merged.join(', ')} into ${r.kept}${r.repointed ? ` — ${r.repointed} setting${r.repointed === 1 ? '' : 's'} now point at ${r.kept}` : ''}. The old name still finds it.`);
  } catch (e) { appAlert(e.message); }
  keysLoadProviders();
}

async function keysUseV1(name, url) {
  try { await apiFetch('/api/keys', { method: 'POST', body: { provider: name, baseUrl: url } }); } catch (e) { return appAlert(e.message); }
  keysLoadProviders();
}
