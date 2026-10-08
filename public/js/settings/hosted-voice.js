/* Settings → Voice → Voice (voice-card.js): a voice from a service (modules/hosted-voices — ElevenLabs, OpenAI, Cartesia,
   Google), set up when asked and never pushed. Two parts drawn into the screen voice card:
   - while a service's voice is the chosen engine, its fields: the model (its voice is the card's own box, typed or
     picked by name), and the rest folded under Advanced (a direction in words, stability, the language);
   - folded at the bottom, "A voice from a service": each service, whether its key is kept, the page that makes one and,
     for an admin, a box to paste it — saved as a key for services (protected, the hub's; it never comes back here). */

/** The fields for a chosen service voice (engine `hosted:<id>`): its model, and Advanced folded. */
function hostedVoiceFields(list, v) {
  const h = (list.hosted || []).find(x => x.id === list.engine);
  if (!h) return '';
  const o = (v.engine === h.id && v.hosted) || {};
  const adv = h.advanced || [];
  const field = (id, label, input) => `<label class="input-label" style="display:block;margin-top:6px">${label}</label>${input}`;
  return `<div id="hv-fields" style="margin-top:8px">
    <div class="toolbar" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">
      <select class="input" id="hv-model" style="width:auto" title="Which of ${escHtml(h.label)}'s models">${h.models.map(m =>
        `<option value="${escHtml(m.id)}" ${m.id === (o.model || h.model) ? 'selected' : ''}>${escHtml(m.label)}</option>`).join('')}</select>
      ${list.voices.length ? '' : '<span style="font-size:11px;color:var(--muted)">No voices listed — is the key right?</span>'}
    </div>
    ${adv.length ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px">Advanced</summary>
      ${adv.includes('style') ? field('hv-style', 'A direction in words, for every sentence', `<input class="input" id="hv-style" value="${escHtml(o.style || '')}" placeholder="warm and unhurried, a little playful" style="width:100%">`) : ''}
      ${adv.includes('stability') ? field('hv-stability', 'Stability (0 more varied — 1 steadier)', `<input class="input" id="hv-stability" type="number" min="0" max="1" step="0.1" value="${escHtml(o.stability ?? '')}" style="width:100px">`) : ''}
      ${adv.includes('language') ? field('hv-language', 'Language (empty: found from what it says)', `<input class="input" id="hv-language" value="${escHtml(o.language || '')}" placeholder="it, en-US…" style="width:120px">`) : ''}
    </details>` : ''}</div>`;
}

/** What the fields hold, for the screen's `voice.hosted`. */
function hostedVoiceValue() {
  const val = id => document.getElementById(id)?.value?.trim() ?? '';
  if (!document.getElementById('hv-model')) return null;
  const out = { model: val('hv-model') };
  if (val('hv-style')) out.style = val('hv-style').slice(0, 500);
  if (val('hv-stability') !== '') out.stability = Math.min(1, Math.max(0, parseFloat(val('hv-stability')) || 0));
  if (val('hv-language')) out.language = val('hv-language').slice(0, 12);
  return out;
}

/** "A voice from a service", folded: each provider with its key's state; an admin pastes a key here, once. */
function hostedVoiceSetup(list) {
  const all = list.hosted || [];
  if (!all.length) return '';
  const row = h => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:12px">
        <b>${escHtml(h.label)}</b><span class="badge ${h.usable ? 'badge-green' : 'badge-grey'}" style="font-size:9px">${h.hasKey ? (h.usable ? 'key kept' : 'key kept, for admins') : 'no key yet'}</span></div>
      <div style="font-size:11px;color:var(--muted);margin:2px 0 4px">${escHtml(h.about)}</div>
      ${list.host ? `<div class="toolbar" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">
        <a href="${escHtml(h.keyPage)}" target="_blank" rel="noopener" class="btn btn-xs">Get a key ↗</a>
        <input class="input" type="password" autocomplete="off" id="hv-key-${escHtml(h.provider)}" placeholder="${h.hasKey ? 'a new key replaces it' : 'paste the key'}" style="width:200px;max-width:100%">
        <button class="btn btn-xs btn-blue" onclick="hostedVoiceKeySave('${escHtml(h.provider)}')">Save the key</button>
        <label style="font-size:11px"><input type="checkbox" id="hv-who-${escHtml(h.provider)}" ${h.who === 'everyone' ? 'checked' : ''}> everyone's screens may use it</label></div>` : ''}
    </div>`;
  return `<details id="hv-setup" style="margin-top:10px"><summary style="cursor:pointer;font-size:12px">A voice from a service — ElevenLabs, OpenAI, Cartesia, Google</summary>
    <p style="font-size:11px;color:var(--muted);margin:6px 0">The service speaks the answers instead of this machine: it costs what the service charges, and what is said goes to it.
      ${list.host ? 'The key is kept by the hub with the keys for services (Field → Connectors) and never shown again; the hub makes the calls.' : 'An admin keeps the key; ask them to open it to everyone.'}</p>
    ${all.map(row).join('')}</details>`;
}

/** Keep a provider's key as a key for services (its own address and header), then choose it for this screen. */
async function hostedVoiceKeySave(provider) {
  const h = (window._hvList?.hosted || []).find(x => x.provider === provider);
  const input = document.getElementById(`hv-key-${provider}`);
  if (!h || !input?.value.trim()) return appAlert('Paste the key first.');
  try {
    await apiFetch('/api/connectors/keys/all', { method: 'POST', body: { ...h.key, key: input.value.trim(),
      who: document.getElementById(`hv-who-${provider}`)?.checked ? 'everyone' : 'host', note: `${h.label} voices (Settings → Voice)` } });
  } catch (e) { return appAlert(`Could not keep the key: ${e.message}`); }
  input.value = '';
  voiceCardRender({ scope: _vc.scope, engine: h.id });
}
