/* When an action is refused because a switch is off (modules/switch-off.js: the hub's answer carries `needs`), the
   panel asks instead of only telling (asked 2026-10-13): what is off and what switching it on does, then
   · Switch it on — the switch's own call (its password asked by the panel's fetch where it needs one), then the
     action runs again by itself;
   · Open its settings — where it lives, by the header search's own jump (global-search.js settingJump);
   · Not now.
   Someone who may not switch it is told who can, with the settings link only when they may see that page.
   Use: `catch (e) { if (switchAsk(e, () => again())) return; … }` — true when it asked. */

function switchAsk(err, retry) {
  const n = err?.needs;
  if (err?.code !== 'switch_off' || !n) return false;
  document.getElementById('switch-ask')?.remove();
  const back = Object.assign(document.createElement('div'), { id: 'switch-ask', className: 'app-confirm-backdrop open switch-ask' });
  back.innerHTML = `<div class="app-confirm-box" role="dialog" aria-modal="true" aria-labelledby="switch-ask-title">
      <p class="app-confirm-msg"><b id="switch-ask-title">${escHtml(n.what)} is off.</b>${n.why ? `<br><span class="desc">${escHtml(n.why)}</span>` : ''}
        ${n.mayChange ? '' : '<br><span class="desc">An admin switches it on.</span>'}</p>
      <div class="app-confirm-actions">
        <button type="button" class="btn btn-sm" data-act="no">Not now</button>
        ${n.page && n.mayChange ? '<button type="button" class="btn btn-sm" data-act="open">Open its settings</button>' : ''}
        ${n.mayChange ? `<button type="button" class="btn btn-sm btn-teal" data-act="on">Switch it on${retry ? ' and go on' : ''}</button>` : ''}
      </div>
      <p class="desc switch-ask-st" role="status"></p></div>`;
  const close = () => back.remove();
  back.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (e.target === back || act === 'no') return close();
    if (act === 'open') { close(); if (typeof settingJump === 'function') settingJump({ page: n.page, card: n.card || '', field: n.field || '' }); return; }
    if (act !== 'on') return;
    const btn = e.target.closest('button'), st = back.querySelector('.switch-ask-st');
    btn.disabled = true; st.textContent = 'Switching it on…';
    try {
      await apiFetch(n.route, { method: 'POST', body: n.body || { on: true } });
      close();
      if (retry) retry();
    } catch (x) { btn.disabled = false; st.textContent = `✗ ${x.message}`; }
  });
  document.body.append(back);
  back.querySelector('[data-act="on"]')?.focus();
  return true;
}
