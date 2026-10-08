/* Settings → Voice → Assistant mode (a call from the face): what is this screen's — how long it stays quiet before
   waiting for its name, and whether it listens for the name — and what is the hive's: how it speaks, how hard it
   thinks, a quicker model (turn/effort.js, turn/client.js, /api/assistant; the owner's). */
async function liveCallAssistantCard(panel, s) {
  const c = s.settings?.call || {};
  const word = c.wakeWord || (typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA';
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'assistant-card' });
  card.innerHTML = `<div class="card-title">Live call — when you talk to the face (and Ambient’s assistant)</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Tap the face (or say its name): it fills the screen and talks — the same conversation as the chat,
      answered quicker and shorter. "Think harder" or "quick answers" changes the effort for the conversation.</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-size:11px;font-weight:600">On this screen</div>
      ${liveCallRow('Quiet before resting', `<input class="input" id="lc-idle" type="number" min="5" max="600" value="${c.assistantIdleSec || 12}" style="width:80px"> s`,
        'After this long with no words heard and nothing being said, it rests and waits for its name (when it listens for one); otherwise it keeps listening.')}
      ${s.experiments?.wakeWord ? liveCallRow('Call by name', `<label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="lc-listen" ${c.listenWithFace ? 'checked' : ''}>
          while the face shows, listen for</label>${choiceInput({ id: 'lc-word', value: c.wakeWord || '', placeholder: word, width: '160px', source: 'this hub', load: liveCallWakeWords })}`,
        `"${escHtml(word)}, what's on today?" starts it and sends the rest. 
         While it listens, what is said near this screen goes to your speech-to-text.`) : ''}
      <div class="toolbar"><button class="btn btn-sm btn-blue" onclick="liveCallAssistantScreenSave()">Save for this screen</button></div>
      ${await liveCallAssistantHtml()}
    </div>`;
  panel.append(card);
}

/** The names a screen can listen for: the product's, and each word a wake-word model was trained for here (an admin's list). */
async function liveCallWakeWords() {
  const product = (typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA';
  const items = [{ value: product, where: 'its name' }];
  try {
    for (const m of (await apiFetch('/api/wakeword')).models || []) if (m.word && !items.some(i => i.value.toLowerCase() === m.word.toLowerCase())) items.push({ value: m.word, where: 'a model trained here' });
  } catch { /* not an admin: the product's name, or what is typed */ }
  return items;
}

async function liveCallAssistantScreenSave() {
  const idle = parseInt(document.getElementById('lc-idle').value, 10);
  const cur = (await screenLoad(true)).settings?.call || {};
  try {
    const listen = document.getElementById('lc-listen'), word = document.getElementById('lc-word');   // absent while the experiment is off
    await screenSave({ call: { ...cur, ...(listen ? { listenWithFace: listen.checked, wakeWord: word.value.trim() } : {}), ...(idle >= 5 ? { assistantIdleSec: idle } : {}) } });
  } catch (e) { return appAlert(e.message); }
  await screenLoad(true);
  if (typeof wakeWordApply === 'function') wakeWordApply();
  liveCallRender();
}

/** Assistant mode (a call from the face): how it speaks, how hard it thinks, and an optional quicker model. The owner's. */
async function liveCallAssistantHtml() {
  let a;
  try { a = await apiFetch('/api/assistant'); } catch { return ''; }
  const owner = typeof authHasRight !== 'function' || authHasRight('host');
  const lv = ['off', 'low', 'medium', 'high', 'default'];
  return `<div style="border-top:1px solid var(--border2);padding-top:10px;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:11px;font-weight:600">For every screen${owner ? '' : ' (an admin sets these)'}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:11px;color:var(--muted);width:150px">Thinking effort</label>
      <select class="input" id="as-effort" data-default="low" data-label="Thinking effort" style="width:auto" ${owner ? '' : 'disabled'}>${lv.map(x => `<option value="${x}" ${a.effort === x ? 'selected' : ''}>${x === 'default' ? 'the model\'s default' : x}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:11px;color:var(--muted);width:150px">When it just acts</label>
      <select class="input" id="as-reply" style="width:auto" ${owner ? '' : 'disabled'}>${[['act', 'Do it — no answer (✓ on the face)'], ['brief', 'Do it — two or three words'], ['always', 'Do it — say what was done']]
        .map(([v, l]) => `<option value="${v}" ${a.reply === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span style="font-size:11px;color:var(--muted)">Questions, failures and anything you cannot see are always answered.</span></div>
    ${advancedFold(`<div style="display:flex;flex-direction:column;gap:8px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:11px;color:var(--muted);width:150px">A quicker model (optional)</label>
      <input class="input" id="as-provider" data-default="" data-label="Quicker model's provider" value="${escHtml(a.provider || '')}" placeholder="provider" style="width:120px" ${owner ? '' : 'disabled'}>
      <input class="input" id="as-model" data-default="" data-label="Quicker model" value="${escHtml(a.model || '')}" placeholder="model — empty: the chat's" style="width:200px" ${owner ? '' : 'disabled'}></div>
    <label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="as-calls" data-default="false" data-label="For the Deep call too" ${a.calls ? 'checked' : ''} ${owner ? '' : 'disabled'}>
      Use this effort and model for the Deep call (the chat's 🎙) too — its answers are always spoken-length</label>
    <label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" id="as-front" data-default="true" data-label="Answer at once" ${a.front !== false ? 'checked' : ''} ${owner ? '' : 'disabled'}>
      Answer at once: quick actions in the call, anything bigger (or "think harder") to a work chat, its outcome said in the call</label>
    <label style="font-size:11px;color:var(--muted)">How it speaks<textarea class="input" id="as-style" rows="4" style="width:100%;margin-top:4px" data-label="How it speaks"${a.defaults?.style != null ? ` data-default="${escHtml(a.defaults.style)}"` : ''} ${owner ? '' : 'disabled'}>${escHtml(a.style || '')}</textarea></label>
    </div>`, { id: 'assistant-hive', label: 'Advanced — a quicker model, the Deep call, how it speaks' })}
    ${owner ? `<div class="toolbar"><button class="btn btn-sm btn-blue" onclick="liveCallAssistantSave()">Save the Live call</button>
      <button class="btn btn-sm" onclick="liveCallAssistantSave(true)">Default style</button></div>` : ''}
  </div>`;
}

async function liveCallAssistantSave(resetStyle) {
  const g = id => document.getElementById(id).value;
  try { await apiFetch('/api/assistant', { method: 'POST', body: { reply: g('as-reply'), calls: document.getElementById('as-calls').checked, front: document.getElementById('as-front').checked, effort: g('as-effort'), provider: g('as-provider').trim(), model: g('as-model').trim(), style: resetStyle ? null : g('as-style') } }); }
  catch (e) { return appAlert(e.message); }
  liveCallRender();
}
