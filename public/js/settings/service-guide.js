/* Field → Connectors → API services: where the key the form asks for is made (lib/app-links.js). Under the form, for a
   service the registry knows — Home Assistant: the key `home-assistant`, or an address on its port 8123 — the steps,
   with "Open in the Home Assistant app" on a phone and the same page at the address typed (or the MCP row's) on the
   web; for any other service, its docs and what its key looks like, linked. "Connect Home Assistant" fills the form
   with its name and the address its MCP server already has, so only the token is left. Redrawn as the form changes
   (service-form.js serviceFormFoot). */

const _svcGuideHa = v => /^home-?assistant$/i.test((v['sk-name'] || '').trim()) || /:8123(\/|$)/.test(v['sk-origin'] || '');

function serviceGuidePaint() {
  const el = document.getElementById('sk-guide');
  if (!el) return;
  const v = _svcForm.values;
  let html = '';
  if (_svcGuideHa(v)) {
    html = `<details class="desc page-about" open><summary>Where the Home Assistant token is made</summary>
      ${appStepsHtml('home-assistant', 'token', { base: v['sk-origin'] })}</details>`;
  } else if (_svcForm.docs || _svcForm.keyHint) {
    html = `<div class="desc">${_svcForm.keyHint ? `The key: ${appLinkify(_svcForm.keyHint)}. ` : ''}${_svcForm.docs ? `Its docs: ${appLinkify(_svcForm.docs)}` : ''}</div>`;
  }
  if (el.innerHTML !== html) el.innerHTML = html;   // typing redraws nothing that did not change (a fold stays as the person left it)
}

/** The form for Home Assistant: its name, and the address its MCP server has here (or the address field asks). */
async function serviceGuideHomeAssistant() {
  let origin = '';
  try {
    const { servers } = await apiFetch('/api/mcp');
    const s = (servers || []).find(x => x.key === 'home-assistant' || x.id === 'home-assistant');
    if (s?.url) origin = new URL(s.url).origin;
  } catch { /* the address is typed instead */ }
  serviceFill({ name: 'home-assistant', server: origin, note: 'Home Assistant: the home\'s lights, climate, covers, sensors and scenes (the Home page and its MCP server).',
    auth: { type: 'bearer' } }, null, { what: 'Home Assistant' });
  serviceAddSay('services', `Home Assistant${origin ? ` at <b>${escHtml(origin)}</b>` : ''}: make its token (the steps under the form) and paste it as the key.`);
  if (!origin) askFor(document.getElementById('sk-origin'), 'Home Assistant\'s address, like http://homeassistant.local:8123');
  else document.getElementById('sk-key')?.focus();
}
