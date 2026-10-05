/* ═══════════════════════════════════════════════════════
   Settings → Channels (modules/channels; TODO H14, H9.1): talking to the hive
   from Telegram, Matrix, Slack or mail. A host gives each bot's token and switches it on;
   anyone who may chat links their own chat with a one-time code, and sees and
   unlinks their own chats (a host sees every one).
   ═══════════════════════════════════════════════════════ */

async function channelsLoad() {
  const panel = document.getElementById('sp-channels');
  if (!panel) return;
  let t, mx, sl, ml;
  try { [t, mx, sl, ml] = await Promise.all(['telegram', 'matrix', 'slack', 'mail'].map(c => apiFetch(`/api/channels/${c}`))); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  const host = !document.body.classList.contains('no-host');
  const chats = (t.chats || []).map(c => `<div class="disk-row">
      <span class="disk-label">${escHtml(c.name)}${c.username ? ` <span style="color:var(--muted)">@${escHtml(c.username)}</span>` : ''}</span>
      <span class="disk-path">speaks as ${escHtml(c.person || '?')} · linked ${escHtml(String(c.linkedAt || '').slice(0, 10))}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="channelsUnlink(${jsArg(c.chatId)})">Unlink</button></span></div>`).join('');
  const state = s => s.running ? `<span style="color:var(--green)">● running</span> as <b>${escHtml(s.bot?.username || '?')}</b>`
    : s.enabled ? `<span style="color:var(--amber)">○ not running</span>` : '<span style="color:var(--muted)">○ off</span>';
  panel.innerHTML = `<div class="card">
    <div class="card-title">Telegram</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Write to the hive from Telegram: a message there is a turn in a conversation of its own,
      the answer comes back there, a voice note is transcribed, photos and files arrive as attachments, and the agent's questions and approvals
      come as buttons. The bot is polled from here, so no public address is needed. A chat speaks as the person who linked it, with their level.</p>
    <div style="margin-bottom:10px">${state({ ...t, bot: t.bot && { username: `@${t.bot.username}` } })}${t.error ? ` — <span style="color:var(--red)">${escHtml(t.error)}</span>` : ''}${t.lastPollAt ? ` <span style="color:var(--muted);font-size:11px">· last poll ${escHtml(new Date(t.lastPollAt).toLocaleTimeString())}</span>` : ''}</div>
    ${host ? `<div class="input-label">Bot token — make a bot with <b>@BotFather</b> in Telegram (/newbot) and paste the token it gives</div>
      <div class="toolbar" style="gap:6px;margin-bottom:10px">
        <input class="input" id="tg-token" type="password" autocomplete="off" placeholder="${t.hasToken ? 'saved — paste a new one to replace it' : '123456:ABC…'}" style="flex:1;min-width:200px">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px"><input type="checkbox" id="tg-on" ${t.enabled ? 'checked' : ''}> on</label>
        <button class="btn btn-sm btn-blue" onclick="channelsSave()">Save</button></div>` : ''}
    <div class="card-title" style="font-size:12px;margin-top:6px">${host ? 'Linked chats' : 'Your linked chats'}</div>
    ${chats || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="margin-top:10px;gap:6px">
      <button class="btn btn-sm" onclick="channelsLink()" ${t.running ? '' : 'disabled title="The bot is not running"'}>Link a Telegram chat</button>
      <span id="tg-code" style="font-size:12px"></span></div></div>${channelsMatrixCard(mx, host, state)}${channelsSlackCard(sl, host, state)}${channelsMailCard(ml, host, state)}`;
}

/* Matrix (modules/channels/matrix): a bot account on any homeserver, synced from here; direct rooms only, unencrypted. */
function channelsMatrixCard(m, host, state) {
  const rooms = (m.chats || []).map(c => `<div class="disk-row">
      <span class="disk-label">${escHtml(c.name)}</span>
      <span class="disk-path">speaks as ${escHtml(c.person || '?')} · linked ${escHtml(String(c.linkedAt || '').slice(0, 10))}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="channelsUnlink(${jsArg(c.chatId)}, 'matrix')">Unlink</button></span></div>`).join('');
  return `<div class="card">
    <div class="card-title">Matrix</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">The same from Matrix (Element or any client): a bot account on any homeserver — matrix.org, or your own on the tailnet —
      synced from here. It accepts invitations to direct chats; a question comes as a numbered list, answered with the number. Encrypted rooms cannot be read: start the chat with encryption off.</p>
    <div style="margin-bottom:10px">${state(m)}${m.error ? ` — <span style="color:var(--red)">${escHtml(m.error)}</span>` : ''}</div>
    ${host ? `<div class="input-label">Homeserver and the bot account's access token (Element: Settings → Help &amp; About → Access token, signed in as the bot)</div>
      <div class="toolbar" style="gap:6px;margin-bottom:10px">
        <input class="input" id="mx-hs" placeholder="https://matrix.org" value="${escHtml(m.homeserver || '')}" style="flex:1;min-width:160px">
        <input class="input" id="mx-token" type="password" autocomplete="off" placeholder="${m.hasToken ? 'saved — paste a new one to replace it' : 'syt_…'}" style="flex:1;min-width:160px">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px"><input type="checkbox" id="mx-on" ${m.enabled ? 'checked' : ''}> on</label>
        <button class="btn btn-sm btn-blue" onclick="channelsMatrixSave()">Save</button></div>` : ''}
    <div class="card-title" style="font-size:12px;margin-top:6px">${host ? 'Linked rooms' : 'Your linked rooms'}</div>
    ${rooms || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="margin-top:10px;gap:6px">
      <button class="btn btn-sm" onclick="channelsMatrixLink()" ${m.running ? '' : 'disabled title="The bot is not running"'}>Link a Matrix chat</button>
      <span id="mx-code" style="font-size:12px"></span></div></div>`;
}

/* Slack (modules/channels/slack): an app in Socket Mode, so no request URL; direct messages only. */
function channelsSlackCard(m, host, state) {
  const dms = (m.chats || []).map(c => `<div class="disk-row">
      <span class="disk-label">${escHtml(c.name)}</span>
      <span class="disk-path">speaks as ${escHtml(c.person || '?')} · linked ${escHtml(String(c.linkedAt || '').slice(0, 10))}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="channelsUnlink(${jsArg(c.chatId)}, 'slack')">Unlink</button></span></div>`).join('');
  return `<div class="card">
    <div class="card-title">Slack</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">The same from a Slack workspace, in direct messages with the app (never in shared channels). Make an app at api.slack.com/apps:
      switch on Socket Mode (an app-level token with <code>connections:write</code>), subscribe to the bot event <code>message.im</code>, give the bot
      <code>chat:write</code>, <code>im:history</code>, <code>files:read</code>, <code>files:write</code> and <code>users:read</code>, allow messages in the App Home, and install it.</p>
    <div style="margin-bottom:10px">${state(m)}${m.bot?.team ? ` <span style="color:var(--muted);font-size:11px">· ${escHtml(m.bot.team)}</span>` : ''}${m.error ? ` — <span style="color:var(--red)">${escHtml(m.error)}</span>` : ''}</div>
    ${host ? `<div class="input-label">App-level token (xapp-…) and bot token (xoxb-…)</div>
      <div class="toolbar" style="gap:6px;margin-bottom:10px">
        <input class="input" id="sl-app" type="password" autocomplete="off" placeholder="${m.hasAppToken ? 'saved — paste to replace' : 'xapp-…'}" style="flex:1;min-width:160px">
        <input class="input" id="sl-bot" type="password" autocomplete="off" placeholder="${m.hasBotToken ? 'saved — paste to replace' : 'xoxb-…'}" style="flex:1;min-width:160px">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px"><input type="checkbox" id="sl-on" ${m.enabled ? 'checked' : ''}> on</label>
        <button class="btn btn-sm btn-blue" onclick="channelsSlackSave()">Save</button></div>` : ''}
    <div class="card-title" style="font-size:12px;margin-top:6px">${host ? 'Linked direct messages' : 'Your linked direct messages'}</div>
    ${dms || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="margin-top:10px;gap:6px">
      <button class="btn btn-sm" onclick="channelsSlackLink()" ${m.running ? '' : 'disabled title="The app is not connected"'}>Link a Slack chat</button>
      <span id="sl-code" style="font-size:12px"></span></div></div>`;
}

/* Mail (modules/channels/mail): a mailbox read over IMAP and answered over SMTP; a mail counts only when its
   receiving server vouched for the sender (DMARC, or DKIM for the From domain). */
function channelsMailCard(m, host, state) {
  const rows = (m.chats || []).map(c => `<div class="disk-row"><span class="disk-label">${escHtml(c.username || c.name)}</span>
      <span class="disk-path">speaks as ${escHtml(c.person || '?')} · linked ${escHtml(String(c.linkedAt || '').slice(0, 10))}</span>
      <span class="disk-free"><button class="btn btn-xs btn-red" onclick="channelsUnlink(${jsArg(c.chatId)}, 'mail')">Unlink</button></span></div>`).join('');
  const v = k => escHtml(m[k] || '');
  return `<div class="card">
    <div class="card-title">Mail</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Write to the hive by mail and get the answer as a reply in the thread. Use a mailbox of its own (an app password, IMAP on 993 and SMTP on 465).
      A From line is only a claim, so a mail counts only when the receiving server vouched for its sender — name that server (e.g. <code>mx.google.com</code>) to read only its verdict.</p>
    <div style="margin-bottom:10px">${state(m)}${m.error ? ` — <span style="color:var(--red)">${escHtml(m.error)}</span>` : ''}</div>
    ${host ? `<div class="toolbar" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <input class="input" id="ml-imap" placeholder="IMAP host (imap.gmail.com)" value="${v('imapHost')}" style="flex:1;min-width:170px">
        <input class="input" id="ml-smtp" placeholder="SMTP host (smtp.gmail.com)" value="${v('smtpHost')}" style="flex:1;min-width:170px">
        <input class="input" id="ml-auth" placeholder="its receiving server (mx.google.com)" value="${v('authservId')}" style="flex:1;min-width:170px"></div>
      <div class="toolbar" style="gap:6px;margin-bottom:10px;flex-wrap:wrap">
        <input class="input" id="ml-user" placeholder="mailbox (doca@example.com)" value="${v('user')}" style="flex:1;min-width:170px">
        <input class="input" id="ml-pass" type="password" autocomplete="off" placeholder="${m.hasPassword ? 'saved — paste to replace' : 'app password'}" style="flex:1;min-width:150px">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px"><input type="checkbox" id="ml-on" ${m.enabled ? 'checked' : ''}> on</label>
        <button class="btn btn-sm btn-blue" onclick="channelsMailSave()">Save</button></div>` : ''}
    <div class="card-title" style="font-size:12px;margin-top:6px">${host ? 'Linked addresses' : 'Your linked addresses'}</div>
    ${rows || '<div class="placeholder">None yet.</div>'}
    <div class="toolbar" style="margin-top:10px;gap:6px">
      <button class="btn btn-sm" onclick="channelsMailLink()" ${m.running ? '' : 'disabled title="The mailbox is not being read"'}>Link my address</button>
      <span id="ml-code" style="font-size:12px"></span></div></div>`;
}

async function channelsMailSave() {
  const v = id => document.getElementById(id).value.trim();
  try {
    await apiFetch('/api/channels/mail', { method: 'POST', body: { enabled: document.getElementById('ml-on').checked, imapHost: v('ml-imap'), smtpHost: v('ml-smtp') || v('ml-imap'),
      authservId: v('ml-auth'), user: v('ml-user'), address: v('ml-user'), ...(v('ml-pass') ? { password: v('ml-pass') } : {}) } });
  } catch (e) { appAlert(e.message); }
  channelsLoad();
}

async function channelsMailLink() {
  const out = document.getElementById('ml-code');
  try {
    const r = await apiFetch('/api/channels/mail/link', { method: 'POST' });
    out.innerHTML = `Send a mail to <b>${escHtml(r.bot || 'the mailbox')}</b> from your own address with the subject <code>link ${escHtml(r.code)}</code> — within 15 minutes.`;
  } catch (e) { out.textContent = e.message; }
}

async function channelsSlackSave() {
  const app = document.getElementById('sl-app').value.trim(), bot = document.getElementById('sl-bot').value.trim();
  try {
    await apiFetch('/api/channels/slack', { method: 'POST', body: { enabled: document.getElementById('sl-on').checked, ...(app ? { appToken: app } : {}), ...(bot ? { botToken: bot } : {}) } });
  } catch (e) { appAlert(e.message); }
  channelsLoad();
}

async function channelsSlackLink() {
  const out = document.getElementById('sl-code');
  try {
    const r = await apiFetch('/api/channels/slack/link', { method: 'POST' });
    out.innerHTML = `Open the app's Messages tab in Slack and send <code>!link ${escHtml(r.code)}</code> — within 15 minutes.`;
  } catch (e) { out.textContent = e.message; }
}

async function channelsMatrixSave() {
  const token = document.getElementById('mx-token').value.trim();
  try {
    await apiFetch('/api/channels/matrix', { method: 'POST', body: { enabled: document.getElementById('mx-on').checked,
      homeserver: document.getElementById('mx-hs').value.trim(), ...(token ? { accessToken: token } : {}) } });
  } catch (e) { appAlert(e.message); }
  channelsLoad();
}

async function channelsMatrixLink() {
  const out = document.getElementById('mx-code');
  try {
    const r = await apiFetch('/api/channels/matrix/link', { method: 'POST' });
    out.innerHTML = `Start a direct chat with <b>${escHtml(r.bot || 'the bot')}</b> (encryption off) and send <code>!link ${escHtml(r.code)}</code> — within 15 minutes.`;
  } catch (e) { out.textContent = e.message; }
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

function channelsUnlink(chatId, channel = 'telegram') {
  appConfirm('Unlink this chat? It stops reaching the hive at once.', async () => {
    try { await apiFetch(`/api/channels/${channel}/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    channelsLoad();
  });
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-channels' })));
