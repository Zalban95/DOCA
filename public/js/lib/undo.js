/* Nothing goes without a way back (asked 2026-10-10: "Any delete anywhere in the UI needs a confirmation or a restore.
   I just deleted a project, it didn't ask"). Two shapes, chosen by whether the thing can be kept:
     undoToast(text, undo, opts)          what was put away rather than deleted (archived, back from the Archive): it
                                          goes at once, and a toast offers Undo for ten seconds — `undo()` brings it back
     confirmRemove(what, effect, go, opts) what really goes: asked first, naming what goes and what it affects; `go()`
                                          runs only on yes
   test/delete-safety.test.js reads every delete in the panel and fails on one that uses neither (or is not on its
   allowlist with a reason). */

const UNDO_MS = 10000;

/** A toast that says what happened and offers Undo; `opts.link` {label, onclick} adds a second action ("Archive"). */
function undoToast(text, undo, { ms = UNDO_MS, link = null } = {}) {
  if (typeof document === 'undefined' || !document.body) return null;
  let host = document.getElementById('undo-toasts');
  if (!host) {
    host = Object.assign(document.createElement('div'), { id: 'undo-toasts', className: 'undo-toasts' });
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const t = Object.assign(document.createElement('div'), { className: 'undo-toast' });
  const said = Object.assign(document.createElement('span'), { className: 'undo-text', textContent: text });
  t.appendChild(said);
  let timer = null;
  const close = () => { clearTimeout(timer); t.classList.add('going'); setTimeout(() => t.remove(), 180); };
  if (typeof undo === 'function') {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm undo-btn', textContent: 'Undo' });
    b.onclick = async () => {
      b.disabled = true;
      try { await undo(); said.textContent = 'Brought back.'; b.remove(); timer = setTimeout(close, 1800); }
      catch (e) { said.textContent = `Could not bring it back: ${e.message}`; b.disabled = false; }
    };
    t.appendChild(b);
  }
  if (link) {
    const a = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm undo-link', textContent: link.label });
    a.onclick = () => { close(); link.onclick(); };
    t.appendChild(a);
  }
  const x = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn undo-x', textContent: '✕', title: 'Close' });
  x.setAttribute('aria-label', 'Close');
  x.onclick = close;
  t.appendChild(x);
  host.appendChild(t);
  // A toast being read (pointer on it, or focus inside) does not go under the reader's hand.
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, ms); };
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', arm);
  t.addEventListener('focusin', () => clearTimeout(timer));
  t.addEventListener('focusout', arm);
  arm();
  return { close };
}

/**
 * Ask before something goes for good. `what`: the thing, by its name ("the key “openai”"); `effect`: what it affects
 * or how to get it back ("Agents using it stop working until it is pasted again."). `opts.verb` (default Delete) is
 * the question's first word.
 */
function confirmRemove(what, effect, go, { verb = 'Delete', onCancel } = {}) {
  const ask = [`${verb} ${what}?`, effect].filter(Boolean).join('\n\n');
  appConfirm(ask, go, onCancel);
}

/** Put one away with Undo — the Archive's own route both ways (modules/archive.js). */
function archiveWithUndo(kind, id, label, after) {
  const route = on => apiFetch(`/api/archive/${kind}/${encodeURIComponent(id)}`, { method: 'POST', body: { on } });
  return route(true).then(() => {
    after?.(false);
    undoToast(label, async () => { await route(false); after?.(true); },
      { link: { label: 'Archive', onclick: () => (typeof nav === 'function' ? nav('archive') : null) } });
  });
}
