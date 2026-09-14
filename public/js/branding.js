/* ═══════════════════════════════════════════════════════
   PANEL — PRODUCT NAMES

   Every name a person reads comes from modules/branding.js, so a private
   label is a settings change rather than a rebuild. Mark an element with
   data-brand="agent" and it is filled at boot; data-brand-title does the
   same for the tooltip, and data-brand-text takes a template so a whole
   sentence can carry the name without being cut into three spans.

   The HTML ships with the default name already in it. That is deliberate:
   if this fetch never lands the panel reads correctly instead of showing
   empty boxes where the product should be.
   ═══════════════════════════════════════════════════════ */

let BRAND = null;

async function brandingLoad() {
  try {
    BRAND = await apiFetch('/api/branding');
  } catch {
    return;                       // the markup already says the right thing
  }
  brandingApply();
}

function brandingApply() {
  if (!BRAND) return;
  const of = key => BRAND[key] || BRAND.product || '';

  for (const el of document.querySelectorAll('[data-brand]')) {
    const v = of(el.dataset.brand);
    if (v) el.textContent = v;
  }
  for (const el of document.querySelectorAll('[data-brand-title]')) {
    const v = of(el.dataset.brandTitle);
    if (v) el.title = el.dataset.brandTitleTemplate
      ? el.dataset.brandTitleTemplate.replace('{}', v)
      : v;
  }
  // A sentence with the name inside it: data-brand-text names the key,
  // and the element's own text is the template with {} where it goes.
  for (const el of document.querySelectorAll('[data-brand-text]')) {
    const tpl = el.dataset.brandTemplate || el.textContent;
    el.dataset.brandTemplate = tpl;                 // keep it for a re-apply
    el.textContent = tpl.replace('{}', of(el.dataset.brandText));
  }

  if (BRAND.panel) document.title = BRAND.panel;
}
