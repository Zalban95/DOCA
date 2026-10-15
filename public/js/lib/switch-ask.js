/* When an action is refused because a switch is off (modules/switch-off.js: the hub's answer carries `needs`), the
   panel asks instead of only telling (asked 2026-10-13): what is off and what switching it on does, then
   · Switch it on — the switch's own call (its password asked by the panel's fetch where it needs one), then the
     action runs again by itself;
   · Open its settings — where it lives, by the header search's own jump (global-search.js settingJump);
   · Not now.
   Something that is set up rather than switched (a model, a service's address: no `route`) offers Set it up alone.
   Someone who may not switch it is told who can, with the settings link only when they may see that page.

   apiFetch (lib/api.js) asks by itself and, switched on, sends the same request again — so every page gets the
   question without code of its own. Declined, the error it throws is marked `asked`, and appAlert does not say it a
   second time. Switching one on that needs another first (an experiment needs developer mode) asks that one too. */

let _switchAsked = null;   // {message, at}: the question just asked, so its error is not alerted after
const _switchAskOpen = new Map();   // the question on screen, by what it is about: asked once however many calls meet it

/** Ask about `err.needs`; resolves true once the switch is on, false when declined or opened elsewhere. */
function switchAskWait(err) {
  const n = err?.needs;
  if (err?.code !== 'switch_off' || !n) return Promise.resolve(false);
  _switchAsked = { message: err.message, at: Date.now() };
  // A cast screen has nobody at it to answer (cast-remote.js): said at its foot, never a dialog in the way.
  if (typeof castViewOn === 'function' && castViewOn()) {
    castRemoteNote(`${n.what} ${n.route === null ? 'is not set up' : 'is off'} here, so part of this page cannot show on this screen.`);
    return Promise.resolve(false);
  }
  // Flow warming pages in the background (flow/warm.js): what they meet is not asked — the page asks when opened.
  if (typeof _flowWarming !== 'undefined' && _flowWarming) return Promise.resolve(false);
  // The same question already on screen — several requests of one page, or of several, meeting one switch — is
  // answered once (2026-10-15: a phone on the Wi-Fi had to close the same message again and again).
  const key = n.setting || n.what;
  if (_switchAskOpen.has(key)) return _switchAskOpen.get(key);
  const asked = _switchAskDraw(err, n);
  _switchAskOpen.set(key, asked);
  asked.finally(() => _switchAskOpen.delete(key));
  return asked;
}

/** This device is on the local network, where the machine is not managed: said plainly, with the way that works. */
function _switchAskLan(back) {
  back.querySelector('.app-confirm-box').innerHTML = `<p class="app-confirm-msg"><b class="switch-ask-title">This device is on the local network.</b>
      <br><span class="desc">From here you read and chat. The machine itself — its settings, terminal and files — is managed over Tailscale or at the machine: open the panel over Tailscale on this device to manage it from here.</span></p>
    <div class="app-confirm-actions"><button type="button" class="btn btn-sm" data-act="no">OK</button></div>`;
}

function _switchAskDraw(err, n) {
  return new Promise(resolve => {
    const back = Object.assign(document.createElement('div'), { className: 'app-confirm-backdrop open switch-ask' });
    back.innerHTML = `<div class="app-confirm-box" role="dialog" aria-modal="true">
        <p class="app-confirm-msg"><b class="switch-ask-title">${escHtml(n.what)} ${n.route ? 'is off' : 'is not set up yet'}.</b>${n.why ? `<br><span class="desc">${escHtml(n.why)}</span>` : ''}
          ${n.mayChange ? '' : `<br><span class="desc">An admin ${n.route ? 'switches it on' : 'sets it up'}.</span>`}</p>
        <div class="app-confirm-actions">
          <button type="button" class="btn btn-sm" data-act="no">Not now</button>
          ${n.page && n.mayChange ? `<button type="button" class="btn btn-sm${n.route ? '' : ' btn-teal'}" data-act="open">${n.route ? 'Open its settings' : 'Set it up'}</button>` : ''}
          ${n.mayChange && n.route ? '<button type="button" class="btn btn-sm btn-teal" data-act="on">Switch it on and go on</button>' : ''}
        </div>
        <p class="desc switch-ask-st" role="status"></p></div>`;
    const done = ok => { back.remove(); _switchAsked = { message: err.message, at: Date.now() }; resolve(ok); };
    back.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (e.target === back || act === 'no') return done(false);
      if (act === 'open') { done(false); if (typeof settingJump === 'function') settingJump({ page: n.page, card: n.card || '', field: n.field || '' }); return; }
      if (act !== 'on') return;
      const btn = e.target.closest('button'), st = back.querySelector('.switch-ask-st');
      btn.disabled = true; st.textContent = 'Switching it on…';
      back.style.visibility = 'hidden';   // a switch it needs first, or the password, asks above this one
      try { await apiFetch(n.route, { method: 'POST', body: n.body || { on: true } }); done(true); }
      catch (x) { back.style.visibility = ''; if (x?.asked) return done(false); btn.disabled = false; st.textContent = `✗ ${x.message}`; }
    });
    if (n.setting === 'network.lanAdmin' && !n.mayChange) _switchAskLan(back);
    document.body.append(back);
    (back.querySelector('[data-act="on"]') || back.querySelector('[data-act="no"]'))?.focus();
  });
}

/**
 * For a caller that wants to go on its own way after the switch (an action not repeated by apiFetch). True when it
 * handled `err` — asked now, or already asked by apiFetch — so the caller says nothing more.
 */
function switchAsk(err, retry) {
  if (err?.asked) return true;
  if (err?.code !== 'switch_off' || !err.needs) return false;
  switchAskWait(err).then(ok => { if (ok && retry) retry(); });
  return true;
}

/** Whether `message` is the error of a question just asked: appAlert leaves it unsaid. */
function switchAskedJust(message) {
  return !!_switchAsked && _switchAsked.message === message && Date.now() - _switchAsked.at < 8000;
}
