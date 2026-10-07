/* DOCA in this browser — what runs inside a page (TODO H5.5). Injected into a tab of a site the person allowed, in the
   extension's isolated world, and called by background.js through chrome.scripting. The same rules as an agent's
   computer (clients/computer/tools.js): a password or card field is never typed into and its value never read back,
   and a control that pays, buys, signs in, confirms or submits a form holding a secret needs `confirm: true` — which
   the hub always asks a person about. Plain functions, so the tests can run them against a fake page. */
(function (root) {
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const autocomplete = el => String(el.getAttribute && el.getAttribute('autocomplete') || '').toLowerCase();
  // A field a sealed secret was filled into stays a secret until the page goes (navigation drops this isolated world's
  // set): its value is never read back, even when the page later turns it into a text field (security review 2026-10-07).
  const filled = root.__docaFilled = root.__docaFilled || new WeakSet();
  const isSecret = el => filled.has(el) || el.type === 'password' || /cc-|one-time-code|current-password|new-password/.test(autocomplete(el));
  /** Where a sealed secret may go: a password field, or one whose autocomplete names a credential. */
  const takesCredential = el => String(el.tagName || '').toUpperCase() === 'INPUT'
    && (String(el.type || '').toLowerCase() === 'password' || /\b(current-password|new-password|one-time-code)\b/.test(autocomplete(el)));

  /** What a control is before it is used: 'secret', 'decision' (with its label), or null. */
  function sensitive(el) {
    if (!el) return null;
    if (isSecret(el)) return { kind: 'secret' };
    const label = String((el.getAttribute && el.getAttribute('aria-label')) || el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const form = el.form || (el.closest && el.closest('form'));
    const holdsSecret = !!(form && form.querySelector && form.querySelector('input[type=password],[autocomplete^="cc-"]'));
    const submits = el.type === 'submit' || el.tagName === 'BUTTON';
    if (/\b(pay|buy|purchase|order|checkout|subscribe|donate|transfer|send money|sign in|log ?in|confirm|delete)\b/i.test(label) || (submits && holdsSecret))
      return { kind: 'decision', label: label || el.tagName.toLowerCase() };
    return null;
  }

  /** The page read for the agent: title, address, every visible control numbered [n], and its text. */
  function snapshot(doc) {
    doc = doc || document;
    const els = [...doc.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link],[role=checkbox],[onclick],[contenteditable=true]')].filter(visible);
    const label = el => (el.getAttribute('aria-label') || el.innerText || (isSecret(el) ? (el.value ? '(filled)' : '') : el.value) || el.placeholder || el.title || el.name || el.alt || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const lines = els.slice(0, 300).map((el, i) => {
      el.setAttribute('data-doca-ref', String(i + 1));
      const t = el.tagName.toLowerCase() + (el.type ? `:${el.type}` : '') + (el.getAttribute('role') ? `[${el.getAttribute('role')}]` : '');
      return `[${i + 1}] ${t} "${label(el)}"${el.href ? ` -> ${el.href}` : ''}`;
    });
    return `title: ${doc.title}\nurl: ${doc.location ? doc.location.href : ''}\n\n${lines.join('\n')}\n\n--- text ---\n${(doc.body ? doc.body.innerText : '').slice(0, 12000)}`;
  }

  const find = (ref, doc) => (doc || document).querySelector(`[data-doca-ref="${Number(ref)}"]`);
  const NO_REF = ref => ({ ok: false, error: `No element [${ref}] — take a browser_snapshot first; the numbers change when the page does.` });
  const ASK_CONFIRM = (ref, s) => ({ ok: false, error: `[${ref}] is "${s.label}" — it pays, buys, signs in, confirms or submits. A person decides this one: call again with confirm: true and they will be asked.` });

  /** Click [ref]. */
  function click(ref, confirm, doc) {
    const el = find(ref, doc);
    if (!el) return NO_REF(ref);
    const s = sensitive(el);
    if (s && s.kind === 'decision' && confirm !== true) return ASK_CONFIRM(ref, s);
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    el.click();
    return { ok: true, text: `Clicked [${ref}].` };
  }

  /** Type into [ref] the way a person would, so the page's own handlers see it; Enter when `submit`. */
  function type(ref, text, submit, confirm, doc) {
    const el = find(ref, doc);
    if (!el) return NO_REF(ref);
    const s = sensitive(el);
    if (s && s.kind === 'secret') return { ok: false, error: `[${ref}] is a password or card field. A person types credentials: ask them to sign in on this page themselves, then carry on.` };
    const form = el.form || (el.closest && el.closest('form'));
    if (submit && confirm !== true && form && form.querySelector('input[type=password],[autocomplete^="cc-"]')) return ASK_CONFIRM(ref, { label: 'a form with a password or card field' });
    if (el.focus) el.focus();
    if (el.isContentEditable) el.textContent = String(text);
    else {
      const proto = Object.getPrototypeOf(el), setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, String(text)); else el.value = String(text);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (submit) {
      for (const t of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      if (form && form.requestSubmit) form.requestSubmit();
    }
    return { ok: true, text: `Typed into [${ref}]${submit ? ' and submitted' : ''}.` };
  }

  /**
   * Fill [ref] with a secret the hub sealed for this browser (mcp.js secret_fill; the tab is on the secret's own site,
   * and a person approved it). A password field is the point here, unlike `type` — and only a credential field: a secret
   * put in a plain text field would be read back by the next snapshot. Nothing is read back, and the answer never holds
   * the value; the field stays a secret (never labelled with its value) until the page goes.
   */
  function fillSecret(ref, value, doc) {
    const el = find(ref, doc);
    if (!el) return NO_REF(ref);
    if (!takesCredential(el))
      return { ok: false, error: `[${ref}] is not a password field (or one marked for a password or a one-time code), so a secret does not go into it.` };
    filled.add(el);
    if (el.focus) el.focus();
    const proto = Object.getPrototypeOf(el), setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, text: `Filled [${ref}].` };
  }

  /** A strip at the top of the page while the agent uses it, so the person always sees it. */
  function mark(what) {
    let bar = document.getElementById('doca-agent-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'doca-agent-bar';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:4px 10px;font:12px system-ui,sans-serif;'
        + 'background:#57c9c2;color:#050507;box-shadow:0 1px 6px rgba(0,0,0,.3);pointer-events:none';
      document.documentElement.appendChild(bar);
    }
    bar.textContent = `DOCA is using this page: ${what}`;
    clearTimeout(root.__docaMarkTimer);
    root.__docaMarkTimer = setTimeout(() => bar.remove(), 4000);
    return true;
  }

  const api = { sensitive, snapshot, click, type, fillSecret, mark };
  root.__docaPage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
