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
    <p class="desc" style="margin-bottom:6px">Talk to the hive from Telegram, through a bot of your own.</p>
    <details class="desc page-about" style="margin-bottom:10px"><summary>What this is</summary>A message there is a turn in a conversation of its own,
      the answer comes back there, a voice note is transcribed, photos and files arrive as attachments, and the agent's questions and approvals
      come as buttons. The bot is polled from here, so no public address is needed. A chat speaks as the person who linked it, with their level.</details>
    <div style="margin-bottom:10px">${state({ ...t, bot: t.bot && { username: `@${t.bot.username}` } })}${t.error ? ` — <span style="color:var(--red)">${escHtml(t.error)}</span>` : ''}${t.lastPollAt ? ` <span style="color:var(--muted);font-size:11px">· last poll ${escHtml(new Date(t.lastPollAt).toLocaleTimeString())}</span>` : ''}</div>
    ${host ? `${_chField('tg-token', 'Bot token', 'In Telegram, write /newbot to @BotFather, follow its questions, and paste the token it gives (it looks like 123456:ABC…). Kept on this machine and never shown again; leave empty to keep the saved one.',
        `<input class="input" id="tg-token" type="password" autocomplete="off" placeholder="${_chPh(t, 'TELEGRAM_BOT_TOKEN', t.hasToken ? 'saved — paste a new one to replace it' : '123456:ABC…')}">`)}
      ${_chOn('tg-on', t.enabled, 'Telegram')}
      <div style="margin-bottom:10px"><button class="btn btn-sm btn-blue" onclick="channelsSave()">Save</button></div>` : ''}
    <div class="card-subtitle" style="margin-top:6px">${host ? 'Linked chats' : 'Your linked chats'}</div>
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
    <p class="desc" style="margin-bottom:6px">Talk to the hive from Matrix (Element or any client), through a bot account.</p>
    <details class="desc page-about" style="margin-bottom:10px"><summary>What this is</summary>A bot account on any homeserver — matrix.org, or your own on the tailnet —
      synced from here. It accepts invitations to direct chats; a question comes as a numbered list, answered with the number. Encrypted rooms cannot be read: start the chat with encryption off.</details>
    <div style="margin-bottom:10px">${state(m)}${m.error ? ` — <span style="color:var(--red)">${escHtml(m.error)}</span>` : ''}</div>
    ${host ? `<div class="form-row" style="margin-bottom:8px">
        ${_chField('mx-hs', 'Homeserver', 'The address of the Matrix server the bot account lives on, e.g. https://matrix.org or your own server.',
          `<input class="input" id="mx-hs" placeholder="https://matrix.org" value="${escHtml(m.homeserver || '')}">`)}
        ${_chField('mx-token', 'Access token', 'The bot account\'s access token. In Element, signed in as the bot: Settings → Help & About → Access token. Kept on this machine and never shown again; leave empty to keep the saved one.',
          `<input class="input" id="mx-token" type="password" autocomplete="off" placeholder="${_chPh(m, 'MATRIX_ACCESS_TOKEN', m.hasToken ? 'saved — paste a new one to replace it' : 'syt_…')}">`)}</div>
      ${_chOn('mx-on', m.enabled, 'Matrix')}
      <div style="margin-bottom:10px"><button class="btn btn-sm btn-blue" onclick="channelsMatrixSave()">Save</button></div>` : ''}
    <div class="card-subtitle" style="margin-top:6px">${host ? 'Linked rooms' : 'Your linked rooms'}</div>
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
    <p class="desc" style="margin-bottom:6px">Talk to the hive from Slack, in direct messages with an app of your own (never in shared channels).</p>
    <details class="desc page-about" style="margin-bottom:10px"><summary>How to make the app</summary>Make an app at api.slack.com/apps:
      switch on Socket Mode (an app-level token with <code>connections:write</code>), subscribe to the bot event <code>message.im</code>, give the bot
      <code>chat:write</code>, <code>im:history</code>, <code>files:read</code>, <code>files:write</code> and <code>users:read</code>, allow messages in the App Home, and install it.
      Socket Mode means the hub connects out to Slack, so no public address is needed.</details>
    <div style="margin-bottom:10px">${state(m)}${m.bot?.team ? ` <span style="color:var(--muted);font-size:11px">· ${escHtml(m.bot.team)}</span>` : ''}${m.error ? ` — <span style="color:var(--red)">${escHtml(m.error)}</span>` : ''}</div>
    ${host ? `<div class="form-row" style="margin-bottom:8px">
        ${_chField('sl-app', 'App-level token', 'Starts with xapp-. Made under your app\'s Basic Information → App-Level Tokens, with the connections:write scope; it lets the hub open the Socket Mode connection. Leave empty to keep the saved one.',
          `<input class="input" id="sl-app" type="password" autocomplete="off" placeholder="${_chPh(m, 'SLACK_APP_TOKEN', m.hasAppToken ? 'saved — paste to replace' : 'xapp-…')}">`)}
        ${_chField('sl-bot', 'Bot token', 'Starts with xoxb-. Shown under OAuth & Permissions once the app is installed in your workspace; the hub reads and sends messages with it. Leave empty to keep the saved one.',
          `<input class="input" id="sl-bot" type="password" autocomplete="off" placeholder="${_chPh(m, 'SLACK_BOT_TOKEN', m.hasBotToken ? 'saved — paste to replace' : 'xoxb-…')}">`)}</div>
      ${_chOn('sl-on', m.enabled, 'Slack')}
      <div style="margin-bottom:10px"><button class="btn btn-sm btn-blue" onclick="channelsSlackSave()">Save</button></div>` : ''}
    <div class="card-subtitle" style="margin-top:6px">${host ? 'Linked direct messages' : 'Your linked direct messages'}</div>
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
    <p class="desc" style="margin-bottom:6px">Write to the hive by mail and get the answer as a reply in the thread.</p>
    <details class="desc page-about" style="margin-bottom:10px"><summary>What this is</summary>Use a mailbox of its own (an app password, IMAP on 993 and SMTP on 465); it is read every minute.
      A From line is only a claim, so a mail counts only when the receiving server vouched for its sender (DMARC, or DKIM for the sender's domain) — under Advanced you can name that server (e.g. <code>mx.google.com</code>) to read only its verdict.</details>
    <div style="margin-bottom:10px">${state(m)}${m.error ? ` — <span style="color:var(--red)">${escHtml(m.error)}</span>` : ''}</div>
    ${host ? `<div class="form-row" style="margin-bottom:8px">
        ${_chField('ml-user', 'Mailbox', 'The address of the mailbox the hive reads and answers from, e.g. doca@example.com. It is also the user name it signs in with. Best a mailbox of its own.',
          `<input class="input" id="ml-user" placeholder="doca@example.com" value="${v('user')}">`)}
        ${_chField('ml-pass', 'Password', 'The mailbox\'s password — with Gmail or Outlook an app password made in the account\'s security settings. Kept on this machine and never shown again; leave empty to keep the saved one.',
          `<input class="input" id="ml-pass" type="password" autocomplete="off" placeholder="${_chPh(m, 'DOCA_MAIL_PASSWORD', m.hasPassword ? 'saved — paste to replace' : 'app password')}">`)}</div>
      <div class="form-row" style="margin-bottom:8px">
        ${_chField('ml-imap', 'Incoming server (IMAP)', 'The server mail is read from, over IMAP with TLS on port 993 — e.g. imap.gmail.com. Your mail provider lists it.',
          `<input class="input" id="ml-imap" placeholder="imap.gmail.com" value="${v('imapHost')}">`)}
        ${_chField('ml-smtp', 'Outgoing server (SMTP)', 'The server answers are sent through, over SMTP with TLS on port 465 — e.g. smtp.gmail.com. Empty: the incoming server is used.',
          `<input class="input" id="ml-smtp" placeholder="smtp.gmail.com" value="${v('smtpHost')}">`)}</div>
      ${advancedFold(_chField('ml-auth', 'The receiving server whose verdict counts', 'Empty (the default): the topmost Authentication-Results header in a mail is read. Name your provider\'s receiving server (e.g. mx.google.com) to read only its verdict, since a sender can add a header of its own.',
          `<input class="input" id="ml-auth" data-default="" data-label="Its receiving server" placeholder="mx.google.com" value="${v('authservId')}" style="max-width:360px">`),
        { id: 'mail-channel', label: 'Advanced — the server whose verdict counts' })}
      ${_chOn('ml-on', m.enabled, 'mail')}
      <div style="margin-bottom:10px"><button class="btn btn-sm btn-blue" onclick="channelsMailSave()">Save</button></div>` : ''}
    <div class="card-subtitle" style="margin-top:6px">${host ? 'Linked addresses' : 'Your linked addresses'}</div>
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

/** A field: its label with an ⓘ, then the input. */
const _chField = (id, label, info, input) => `<div class="field"><label class="input-label" for="${id}">${label}${infoBtn(info)}</label>${input}</div>`;
/** The switch that starts or stops a channel's bot (saved with Save). */
const _chOn = (id, on, what) => `<div class="settings-tab-row" style="margin:4px 0 8px"><label class="skill-toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} aria-label="Switched on"><span class="skill-toggle-track"></span></label>
  <span class="settings-tab-label">Switched on${infoBtn(`When on and saved, the hub keeps listening on ${what} and answers there. Off (the default) stops it; linked chats stay linked.`)}</span></div>`;

/** A secret field's placeholder: set in the environment, the environment's wins over anything saved here (one rule, C3). */
const _chPh = (st, name, otherwise) => ((st?.env || []).includes(name) ? `overridden by ENV (${name}) — the environment wins` : otherwise);
