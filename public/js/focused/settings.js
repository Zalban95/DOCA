/* Settings in the Focused view: the few a person sets, each kept where it already lives — the account (Extended's
   Settings → Account has the password and sessions), how it looks (Focused or Extended, light or dark: this screen's
   settings), the voice (this screen's), connected accounts (Field → Connectors, an admin's), and where notices reach
   them (each device's own page, /d/<id>/). Anything more opens in Extended. On a phone it reads as a sheet. */
async function fcSettingsRender(el) {
  const me = await fcMe();
  const host = fcIsHost(me), mode = document.documentElement.dataset.mode, ground = fcGroundChoice(), product = fcProduct();
  const seg = (attr, items, cur) => `<div class="fc-seg" role="group">${items.map(([id, label]) => `<button type="button" data-${attr}="${id}" class="${id === cur ? 'on' : ''}" aria-pressed="${id === cur}">${label}</button>`).join('')}</div>`;
  el.innerHTML = `
    <div class="fc-set">
      <nav class="fc-set-nav" aria-label="Settings"><h1 class="fc-h1">Settings</h1>
        ${[['account', 'Account'], ['look', 'How it looks'], ['voice', 'Voice'], ['accounts', 'Connected accounts'], ['notices', 'Notifications']].map(([id, l]) => `<a href="#fc-set-${id}" class="fc-set-link">${l}</a>`).join('')}</nav>
      <div class="fc-set-body">
        <section class="fc-card fc-pad" id="fc-set-account"><div class="fc-set-who"><span class="fc-avatar fc-avatar-l">${escHtml((fcFirstName(me)[0] || '·').toUpperCase())}</span>
          <div class="fc-row-b"><div class="fc-bright fc-strong">${escHtml(me.name || fcFirstName(me) || 'You')}</div><div class="fc-muted fc-small">${escHtml([me.email, me.levelName].filter(Boolean).join(' · '))}</div></div>
          <button type="button" class="fc-btn fc-sm" onclick="fcSignOut()">Sign out</button></div>
          <button type="button" class="fc-link fc-set-more" onclick="fcPeekSettings('account')">Password and where you are signed in</button></section>
        <section class="fc-card fc-pad" id="fc-set-look"><div class="fc-set-h">How ${escHtml(product)} looks</div>
          <div class="fc-set-line">${seg('mode-pick', [['focused', 'Focused'], ['extended', 'Extended']], mode)}${seg('ground-pick', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']], ground)}</div>
          <label class="fc-check"><input type="checkbox" id="fc-mode-all"> On all my screens</label>
          <p class="fc-muted fc-small">Focused shows what you use each day. Extended has every tool, machine and setting — and a “Focused” button at its top to come back. This screen only, unless you tick “On all my screens”.</p>
          <div class="fc-ext-pic" aria-label="Extended's header, with the way back"><span class="fc-pt"></span><span class="fc-bright fc-strong">${escHtml(product)}</span>
            <span>Controls</span><span>Agents</span><span>Machines</span><span>Hub</span><span>Field</span><span>Settings</span><span class="fc-ext-pill"><span class="fc-pt"></span>Focused</span></div></section>
        <section class="fc-card fc-pad" id="fc-set-voice"><div class="fc-set-h">Voice</div><div id="fc-set-voice-b"><div class="fc-muted fc-small">…</div></div></section>
        <section class="fc-card fc-pad" id="fc-set-accounts"><div class="fc-set-h">Connected accounts</div><div id="fc-set-accounts-b"><div class="fc-muted fc-small">…</div></div></section>
        <section class="fc-card fc-pad" id="fc-set-notices"><div class="fc-set-h">Notifications</div><div id="fc-set-notices-b"><div class="fc-muted fc-small">…</div></div></section>
      </div>
    </div>`;
  el.querySelectorAll('[data-mode-pick]').forEach(b => { b.onclick = () => focusedSwitch(b.dataset.modePick, { everywhere: document.getElementById('fc-mode-all')?.checked }); });
  el.querySelectorAll('[data-ground-pick]').forEach(b => { b.onclick = () => fcGroundSet(b.dataset.groundPick); });
  el.querySelectorAll('.fc-set-link').forEach(a => { a.onclick = e => { e.preventDefault(); document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
  _fcSetVoice(document.getElementById('fc-set-voice-b'));
  _fcSetAccounts(document.getElementById('fc-set-accounts-b'), host);
  _fcSetNotices(document.getElementById('fc-set-notices-b'));
}

/** A page of Extended's Settings, for this moment (the "Focused" pill comes back). */
function fcPeekSettings(section) {
  fcPeek('settings');
  if (typeof settingsSubNav === 'function') setTimeout(() => settingsSubNav(section), 0);
}

async function _fcSetVoice(box) {
  const s = await screenLoad(true).catch(() => ({}));
  const v = s.settings?.voice || {}, call = s.settings?.call || {};
  const name = v.quick?.voice || v.ttsVoice || '';
  box.innerHTML = `<div class="fc-row"><div class="fc-row-b"><div class="fc-bright">${escHtml(name ? `${name}` : 'The hub\'s voice')}</div>
      <div class="fc-muted fc-small">${escHtml(v.ttsSpeed ? `speed ${v.ttsSpeed}` : 'normal speed')}</div></div><button type="button" class="fc-btn fc-sm" onclick="fcPeekSettings('voice')">Change</button></div>
    ${s.experiments?.wakeWord ? `<div class="fc-row"><span class="fc-row-b">Answer when I say its name</span><button type="button" class="fc-switch" role="switch" aria-checked="${!!call.listenWithFace}" aria-label="Answer when I say its name" onclick="fcSetWake(this)"></button></div>` : ''}`;
}

/** The wake word on this screen (call.listenWithFace), as Extended's Appearance switches it. */
async function fcSetWake(btn) {
  const on = btn.getAttribute('aria-checked') !== 'true';
  btn.setAttribute('aria-checked', String(on));
  try { const cur = (await screenLoad()).settings?.call || {}; await screenSave({ call: { ...cur, listenWithFace: on } }); if (typeof wakeWordApply === 'function') wakeWordApply(); }
  catch (e) { btn.setAttribute('aria-checked', String(!on)); appAlert(`Not kept: ${e.message}`); }
}

/** Your accounts (modules/accounts): the person's own Google and Microsoft 365, each as it stands, and Connect —
 *  the same route as Field → Connectors → Your accounts, which "More" opens for reading times, rules and the log. */
async function _fcSetAccounts(box, host) {
  const d = await apiFetch('/api/accounts').catch(() => ({ accounts: [], providers: [] }));
  const mark = { google: 'G', microsoft: 'M' };
  const ready = (d.providers || []).filter(p => p.ready && p.allowed);
  box.innerHTML = `${(d.accounts || []).map(a => `<div class="fc-row">
      <span class="fc-acct" aria-hidden="true">${escHtml(mark[a.provider] || String(a.providerLabel || a.provider)[0].toUpperCase())}</span>
      <div class="fc-row-b"><div class="fc-bright">${escHtml(a.label || a.providerLabel)}</div><div class="fc-muted fc-small">${escHtml([a.account, a.access === 'read' ? 'read only' : 'calendar and mail'].filter(Boolean).join(' · '))}</div></div>
      ${a.connected ? '<span class="fc-pt" aria-hidden="true"></span><span class="fc-small fc-accent">Connected</span>' : '<span class="fc-pt a" aria-hidden="true"></span><span class="fc-small">Sign in again</span>'}</div>`).join('')
    || '<p class="fc-muted fc-small">Connect your own calendar and mail: what needs you shows first, and every change the assistant makes has an Undo.</p>'}
    <div class="fc-acts">${ready.map(p => `<button type="button" class="fc-btn fc-sm" data-connect="${escHtml(p.id)}">Connect ${escHtml(p.label)}</button>`).join('')}
      <button type="button" class="fc-btn fc-sm fc-q" onclick="fcPeekAccounts()">More: reading times, rules, what was changed</button></div>
    ${ready.length ? '' : `<p class="fc-muted fc-small">${host ? 'Set up Google or Microsoft 365 once for this hub first (Field → Connectors), then connect your account here.' : 'Whoever runs this hub sets up Google or Microsoft 365 first; then you connect your own account here.'}</p>`}`;
  box.querySelectorAll('[data-connect]').forEach(b => { b.onclick = async () => {
    try { const r = await apiFetch('/api/accounts/connect', { method: 'POST', body: { provider: b.dataset.connect, access: 'full' } }); window.open(r.url, '_blank', 'noopener'); }
    catch (e) { appAlert(`Could not start: ${e.message}`); }
  }; });
}

/** Field → Connectors → Your accounts, for this moment (the "Focused" pill comes back). */
function fcPeekAccounts() {
  fcPeek('connectors');
  setTimeout(() => document.getElementById('accounts-card')?.scrollIntoView({ block: 'start' }), 600);
}

async function _fcSetNotices(box) {
  const list = await apiFetch('/api/devices').then(r => (r.devices || []).filter(d => d.mine && !d.revokedAt && !['browser', 'agent'].includes(d.kind))).catch(() => []);
  box.innerHTML = list.length
    ? `<p class="fc-muted fc-small">Reminders, mail that needs you and things that are ready reach these. Each one keeps its own quiet hours.</p>${list.map(d => `<div class="fc-row">
        <div class="fc-row-b"><div class="fc-bright">${escHtml(d.name || d.id)}</div><div class="fc-muted fc-small">${escHtml(d.kind)}</div></div>
        <a class="fc-btn fc-sm" href="/d/${encodeURIComponent(d.id)}/">Quiet hours</a></div>`).join('')}`
    : '<p class="fc-muted fc-small">Reminders and notes show here on this screen. Pair your phone or watch (in Extended: Field → API keys) and they reach you there too.</p>';
}
