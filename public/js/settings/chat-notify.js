/* ═══════════════════════════════════════════════════════
   Settings → General → Hive chat on your devices (modules/people/forward.js; asked 2026-10-10): which hive-chat
   messages reach your phone and watch, and your linked chats (Telegram, Matrix, Slack, mail) — every message, direct
   messages and mentions (the default), or none — and per device, its own choice and whether it gets the words or only
   "New message from Ada in #ops". Yours alone, on every device of yours. A muted conversation and a device's quiet
   hours always hold. Saved at once, like a switch.
   ═══════════════════════════════════════════════════════ */

const _CN_WHEN = { all: 'Every message', mentions: 'Direct messages and mentions', off: 'Nothing' };

async function chatNotifyCard() {
  if (typeof licenceFeatureOn === 'function' && !licenceFeatureOn('hive-chat-notify')) return;
  const anchor = document.getElementById('your-panel-card') || document.getElementById('settings-tabs-list')?.closest('.card');
  if (!anchor) return;
  let card = document.getElementById('chat-notify-card');
  if (!card) { card = Object.assign(document.createElement('div'), { id: 'chat-notify-card', className: 'card' }); anchor.after(card); }
  let r;
  try { r = await apiFetch('/api/people/notify'); } catch (e) { card.innerHTML = `<div class="card-title">Hive chat on your devices</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const sel = (key, cur, extra = '', def = null) => `<select class="input" style="width:auto" ${extra}${def != null ? ` data-default="${escHtml(def)}"` : ''}>
    ${def === '' ? `<option value="">As its kind (${escHtml(_CN_WHEN[key] || key)})</option>` : ''}${Object.entries(_CN_WHEN).map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`;
  const quiet = q => (q?.from && q?.to ? `<span class="desc" title="This device's quiet hours: nothing reaches it then">quiet ${escHtml(q.from)}–${escHtml(q.to)}</span>` : '');
  const rows = r.list.map(d => `<div class="form-row cn-row" style="align-items:center;gap:8px;flex-wrap:wrap">
      <span style="min-width:150px;flex:1">${escHtml(d.name)} <small class="desc">${escHtml(d.kind === 'chat' ? 'linked chat' : d.kind)}</small> ${quiet(d.quietHours)}</span>
      ${sel(d.kind === 'chat' ? r.chats : r.devices, d.when, `aria-label="What reaches ${escHtml(d.name)}" onchange="chatNotifySave({each: {[${jsArg(d.id)}]: {when: this.value, content: ${jsArg(d.content)}}}})"`, '')}
      <select class="input" style="width:auto" data-default="full" aria-label="How much ${escHtml(d.name)} is told" onchange="chatNotifySave({each: {[${jsArg(d.id)}]: {when: ${jsArg(d.when)}, content: this.value}}})">
        <option value="full" ${d.content === 'full' ? 'selected' : ''}>With the words</option>
        <option value="notice" ${d.content === 'notice' ? 'selected' : ''}>Only "New message from …"</option></select>
    </div>`).join('');
  card.innerHTML = `<div class="card-title">Hive chat on your devices</div>
    <p class="desc">Which messages from the hive chat reach you away from the panel. Yours alone. A conversation you muted, your own messages and a device's quiet hours never notify.</p>
    <div class="form-row" style="align-items:center;gap:8px"><label style="min-width:150px">Phone and watch</label>${sel('devices', r.devices, 'aria-label="Phone and watch" onchange="chatNotifySave({devices: this.value})"', 'mentions')}</div>
    <div class="form-row" style="align-items:center;gap:8px"><label style="min-width:150px">Linked chats</label>${sel('chats', r.chats, 'aria-label="Linked chats" onchange="chatNotifySave({chats: this.value})"', 'mentions')}</div>
    ${r.list.length ? advancedFold(rows, { label: 'Each device', id: 'chat-notify-each', changed: r.list.filter(d => d.when || d.content !== 'full').length })
      : '<p class="desc">No phone, watch or linked chat of yours yet: pair one under Field → API keys, or link a chat under Settings → Channels.</p>'}
    <div id="chat-notify-status" class="desc" role="status"></div>`;
}

async function chatNotifySave(patch) {
  const st = document.getElementById('chat-notify-status');
  try { await apiFetch('/api/people/notify', { method: 'POST', body: patch }); if (st) st.textContent = 'Saved.'; }
  catch (e) { if (st) st.textContent = e.message; }
  chatNotifyCard();
}
