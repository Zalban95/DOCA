/* ═══════════════════════════════════════════════════════
   Field → Connectors: one way to connect a service, as a row that
   opens (modules/connectors/services.js, ways/) — a calendar's secret
   address, an app password for mail or CalDAV/CardDAV, a key you paste,
   or OAuth with your own app. Each saves, is tested at once, and says
   whether it works; a secret is never shown back, only "saved".
   ═══════════════════════════════════════════════════════ */

const CONN_WAY_LABEL = {
  ics: 'Calendar by its secret address', mail: 'Mail with an app password', dav: 'Calendars and contacts (CalDAV/CardDAV) with an app password',
  key: 'A key you paste', oauth: 'OAuth with your own app',
};
const CONN_WAY_ABOUT = {
  ics: 'Read-only. The address is a secret — whoever has it reads the calendar — so it is kept with the keys and never shown again.',
  mail: 'The agent can search, read and keep drafts; sending is always asked of you first.',
  dav: 'The agent can read calendars and contacts; adding an event is always asked of you first.',
  key: 'The simplest for this service: paste a key, and the agent uses it with api_call — it never sees the key.',
  oauth: 'Make an app in the service\'s developer console, register the callback address above, and paste its id and secret here.',
};
const _connOpen = new Set();   // which rows are open, kept across a redraw
const _connTried = {};          // id → what the last save or test here said, shown under its row

function connLink(url, text) {
  if (!url) return '';
  const m = /^(https:\/\/\S+)(.*)$/.exec(url);
  return m ? `<a href="${escHtml(m[1])}" target="_blank" rel="noopener">${escHtml(text || m[1].replace(/^https:\/\//, ''))}</a>${escHtml(m[2])}` : escHtml(url);
}

/** Its state in a few words, coloured: working, saved but failing, or not set up. */
function connWayStatus(w) {
  const s = w.state || {};
  const chip = (txt, color) => `<span class="conn-chip" style="color:${color}">${txt}</span>`;
  if (w.via === 'oauth') return s.connected ? chip(`● connected${s.account ? ` as ${escHtml(s.account)}` : ''}`, 'var(--green)') : s.configured ? chip('○ app saved, not connected', 'var(--muted)') : chip('○ not set up', 'var(--muted)');
  if (w.via === 'key') return w.state ? chip('● key saved', 'var(--green)') : chip('○ not set up', 'var(--muted)');
  if (s.connected) return chip('● working', 'var(--green)');
  if (s.configured && s.lastError) return chip('▲ not working', 'var(--amber)');
  return chip('○ not set up', 'var(--muted)');
}

const connWho = s => `<select class="input" data-f="who" style="width:auto" title="Whose turns may use it"><option value="host" ${s?.who !== 'everyone' ? 'selected' : ''}>admins' turns</option><option value="everyone" ${s?.who === 'everyone' ? 'selected' : ''}>everyone</option></select>`;
const connSecret = (field, saved, ph, where) => `<input class="input" data-f="${field}" type="password" autocomplete="new-password" placeholder="${saved ? `saved${where ? ` (${escHtml(where)})` : ''} — paste to replace` : escHtml(ph)}" style="flex:1;min-width:180px">`;
const connIn = (field, value, ph, w = 'flex:1;min-width:150px') => `<input class="input" data-f="${field}" value="${escHtml(value ?? '')}" placeholder="${escHtml(ph)}" style="${w}">`;

/** The fields for one way. */
function connWayFields(w) {
  const s = w.state || {}, p = w.preset || {};
  if (w.via === 'ics') return `${connSecret('address', s.configured, 'https://… or webcal://… (the secret iCal address)', s.host)}${connWho(s)}`;
  if (w.via === 'mail') return `${connIn('address', s.address, 'you@example.com', 'flex:1;min-width:170px')}${connSecret('password', s.hasPassword, 'app password')}${connWho(s)}
    <details class="conn-more"><summary>Servers</summary><div class="toolbar" style="gap:6px;flex-wrap:wrap;margin-top:6px">
      ${connIn('imapHost', s.imapHost || p.imapHost, 'IMAP server')}${connIn('imapPort', s.imapPort || p.imapPort, '993', 'width:70px')}
      ${connIn('smtpHost', s.smtpHost || p.smtpHost, 'SMTP server')}${connIn('smtpPort', s.smtpPort || p.smtpPort, '465', 'width:70px')}
      <select class="input" data-f="smtpSecurity" style="width:auto">${['tls', 'starttls'].map(x => `<option value="${x}" ${(s.smtpSecurity || p.smtpSecurity) === x ? 'selected' : ''}>${x === 'tls' ? 'TLS (465)' : 'STARTTLS (587)'}</option>`).join('')}</select>
      ${connIn('user', s.user && s.user !== s.address ? s.user : '', 'user name, if not the address')}</div></details>`;
  if (w.via === 'dav') return `${connIn('user', s.user, 'user name (usually your email)', 'flex:1;min-width:170px')}${connSecret('password', s.hasPassword, 'app password')}${connWho(s)}
    <div class="toolbar" style="gap:6px;flex-wrap:wrap;margin-top:6px;width:100%">${connIn('caldav', s.caldav || p.caldav, 'CalDAV address')}${connIn('carddav', s.carddav || p.carddav, 'CardDAV address')}</div>`;
  if (w.via === 'key') return `${connSecret('key', !!w.state, 'the key')}${connWho(w.state)}`;
  return '';
}

/** One way as a row that opens. */
function connWayRow(w, svcLabel) {
  if (w.via === 'oauth') return connectorsOAuthRow(w);
  const id = w.via === 'key' ? `key-${w.key}` : w.id, s = w.state || {};
  const how = w.how || w.preset?.note || '', where = w.link || w.preset?.passwordAt;
  const tried = _connTried[id];
  const result = tried ? `<div class="conn-result" style="color:${tried.ok ? 'var(--green)' : 'var(--amber)'}">${escHtml(tried.ok ? `Saved — it works: ${tried.summary}.` : `Not working: ${tried.error}`)}</div>`
    : s.lastError ? `<div class="conn-result" style="color:var(--amber)">Last test: ${escHtml(s.lastError)}</div>`
    : s.connected ? `<div class="conn-result">Working${s.calendar ? ` — "${escHtml(s.calendar)}"` : ''}${s.testedAt ? `, tested ${escHtml(new Date(s.testedAt).toLocaleString())}` : ''}.</div>` : '';
  return `<details class="conn-way" data-way="${escHtml(id)}" ${_connOpen.has(id) ? 'open' : ''} ontoggle="connWayToggle(this)">
    <summary><span class="conn-way-label">${escHtml(w.label || CONN_WAY_LABEL[w.via])}</span>${connWayStatus(w)}</summary>
    <div class="conn-way-body">
      <p class="conn-help">${escHtml(CONN_WAY_ABOUT[w.via])}${how ? `<br>${escHtml(how)}` : ''}${where ? `<br>${w.via === 'mail' || w.via === 'dav' ? 'Make the app password at ' : 'Where: '}${connLink(where)}` : ''}</p>
      <div class="toolbar" style="gap:6px;flex-wrap:wrap">${connWayFields(w)}</div>
      <div class="toolbar" style="gap:6px;margin-top:8px;justify-content:flex-start">
        <button class="btn btn-sm btn-blue" onclick="connWaySave(${jsArg(id)}, ${jsArg(w.via)}, ${jsArg(w.provider || '')}, ${jsArg(w.key || '')})">Save and test</button>
        ${w.via !== 'key' && s.configured ? `<button class="btn btn-sm" onclick="connWayTest(${jsArg(id)})">Test again</button>
        <button class="btn btn-sm btn-red" onclick="connWayForget(${jsArg(id)}, ${jsArg(svcLabel)})">Disconnect</button>` : ''}
        ${w.via === 'key' && w.state ? `<button class="btn btn-sm btn-red" onclick="serviceKeysRemove(${jsArg(w.state.name)})">Forget the key</button>` : ''}
      </div>${result}</div></details>`;
}

function connWayToggle(el) { const id = el.dataset.way; if (el.open) _connOpen.add(id); else _connOpen.delete(id); }

/** Save a way, which the hub tests at once; say how it went. */
async function connWaySave(id, via, provider, key) {
  const row = document.querySelector(`#sp-connectors [data-way="${CSS.escape(id)}"]`);
  const body = {};
  for (const el of row.querySelectorAll('[data-f]')) { const v = el.value.trim(); if (v !== '') body[el.dataset.f] = el.type === 'password' ? el.value : v; }
  for (const k of ['imapPort', 'smtpPort']) if (body[k]) body[k] = Number(body[k]);
  _connOpen.add(id);
  let r;
  try {
    r = key ? await apiFetch(`/api/connectors/keys/preset/${encodeURIComponent(key)}`, { method: 'POST', body })
      : await apiFetch(`/api/connectors/${encodeURIComponent(id)}`, { method: 'POST', body: { ...body, via, ...(provider ? { provider } : {}) } });
  } catch (e) { return appAlert(e.message); }
  _connTried[id] = r.test || { ok: false, error: 'no answer' };
  await connectorsLoad();
}

async function connWayTest(id) {
  let r;
  try { r = await apiFetch(`/api/connectors/${encodeURIComponent(id)}/test`, { method: 'POST' }); } catch (e) { return appAlert(e.message); }
  _connTried[id] = r.test;
  await connectorsLoad();
}

function connWayForget(id, label) {
  appConfirm(`Disconnect ${label}? Its address or password is forgotten here (the rest of the setup stays). Revoke the app password at the provider too, to be sure.`, async () => {
    try { await apiFetch(`/api/connectors/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    connectorsLoad();
  });
}

/** Connect something not listed: a calendar address, a mailbox, a CalDAV server, or another OAuth service, by name. */
function connAddOther() {
  const via = document.getElementById('conn-add-via')?.value, name = document.getElementById('conn-add-name')?.value.trim().toLowerCase();
  if (!name) return appAlert('Give it a short name first, like "school-calendar" or "work-mail".');
  if (via === 'oauth') return connectorsAdd(name);
  _connOpen.add(name);
  _connData.others.push({ via, id: name, label: CONN_WAY_LABEL[via], name, state: {}, preset: via === 'mail' ? _connData.presets.mail.other : via === 'dav' ? _connData.presets.dav.other : null,
    how: via === 'ics' ? _connData.presets.ics.how : '' });
  connectorsDraw();
}
