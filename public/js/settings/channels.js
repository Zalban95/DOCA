/* ═══════════════════════════════════════════════════════
   Settings → Channels (modules/channels/telegram; TODO H14): talking to the
   hive from Telegram. A host gives the bot's token and switches it on; anyone
   who may chat links their own Telegram chat with a one-time code, and sees
   and unlinks their own chats (a host sees every one).
   ═══════════════════════════════════════════════════════ */

async function channelsLoad() {
  const panel = document.getElementById('sp-channels');
  if (!panel) return;
  let t;
  try { t = await apiFetch('/api/channels/telegram'); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const host = !document.body.classList.contains('no-host');
  const state = t.running ? `<span style="color:var(--green)">● running</span> as <b>@${escHtml(t.bot?.username || '?')}</b>`
    : t.enabled ? `<span style="color:var(--amber)">○ not running</span>` : '<span style="color:var(--muted)">○ off</span>';
  const chats = (t.chats || []).map(c => `<div class="disk-row">
      <span class="disk-label">${escHtml(c.name)}${c.username ? ` <span style="color:var(--muted)">@${escHtml(c.username)}</span>` : ''}</span>
      <span class="disk-path">speaks as ${escHtml(c.person || '?')} · linked ${escHtml(String(c.linkedAt || '').slice(0, 10))}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="channelsUnlink(${jsArg(c.chatId)})">Unlink</button></span></div>`).join('');
  panel.innerHTML = `<div class="card">
    <div class="card-title">Telegram</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Write to the hive from Telegram: a message there is a turn in a conversation of its own,
      the answer comes back there, a voice note is transcribed, photos and files arrive as attachments, and the agent's questions and approvals
      come as buttons. The bot is polled from here, so no public address is needed. A chat speaks as the person who linked it, with their level.</p>
    <div style="margin-bottom:10px">${state}${t.error ? ` — <span style="color:var(--red)">${escHtml(t.error)}</span>` : ''}${t.lastPollAt ? ` <span style="color:var(--muted);font-size:11px">· last poll ${escHtml(new Date(t.lastPollAt).toLocaleTimeString())}</span>` : ''}</div>
    ${host ? `<div class="input-label">Bot token — make a bot with <b>@BotFather</b> in Telegram (/newbot) and paste the token it gives</div>
      <div class="toolbar" style="gap:6px;margin-bottom:10px">
        <input class="input" id="tg-token" type="password" autocomplete="off" placeholder="${t.hasToken ? 'saved — paste a new one to replace it' : '123456:ABC…'}" style="flex:1;min-width:200px">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px"><input type="checkbox" id="tg-on" ${t.enabled ? 'checked' : ''}> on</label>
        <button class="btn btn-sm btn-blue" onclick="channelsSave()">Save</button></div>` : ''}
    <div class="card-title" style="font-size:12px;margin-top:6px">${host ? 'Linked chats' : 'Your linked chats'}</div>
    ${chats || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="margin-top:10px;gap:6px">
      <button class="btn btn-sm" onclick="channelsLink()" ${t.running ? '' : 'disabled title="The bot is not running"'}>Link a Telegram chat</button>
      <span id="tg-code" style="font-size:12px"></span></div></div>`;
}

async function channelsSave() {
  const token = document.getElementById('tg-token').value.trim();
  try {
    await apiFetch('/api/channels/telegram', { method: 'POST', body: { enabled: document.getElementById('tg-on').checked, ...(token ? { botToken: token } : {}) } });
  } catch (e) { appAlert(e.message); }
  channelsLoad();
}

async function channelsLink() {
  const out = document.getElementById('tg-code');
  try {
    const r = await apiFetch('/api/channels/telegram/link', { method: 'POST' });
    out.innerHTML = `${r.link ? `<a href="${escHtml(r.link)}" target="_blank" rel="noopener">Open @${escHtml(r.bot)} in Telegram</a>, or send` : 'Send'}
      <code>/link ${escHtml(r.code)}</code> to the bot — within 15 minutes, from your own chat.`;
  } catch (e) { out.textContent = e.message; }
}

function channelsUnlink(chatId) {
  appConfirm('Unlink this chat? It stops reaching the hive at once.', async () => {
    try { await apiFetch(`/api/channels/telegram/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    channelsLoad();
  });
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-channels' })));
