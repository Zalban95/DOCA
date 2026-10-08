/* The ambient screen's settings (asked 2026-10-06: "a setting page for this assistant format that allows us to move
   the margins and eventually decide what to show"): Settings → Ambient, and the same form behind ✎ on the page itself.
   They are this screen's own (`ambient`, settings-schema.js), so a kitchen tablet and a desk monitor differ. */
const AMB_SHOW = [['clock', 'Time and date'], ['weather', 'Weather'], ['plan', 'Today’s plan'], ['notices', 'For you'],
  ['buttons', 'Quick buttons'], ['apps', 'This device’s apps (in DOCA’s phone app)']];
const ambShown = (s, k) => (s.show || {})[k] !== false;

/** The form, for the settings page and the ✎ overlay alike. */
function ambientFormHtml(s = {}) {
  const lines = (s.buttons || []).map(b => `${b.label} | ${b.say}`).join('\n');
  const range = (id, label, v, d) => `<label>${label} <span id="${id}-v">${v ?? d}%</span>
    <input type="range" id="${id}" min="0" max="25" data-default="${d}" data-label="${label}" value="${v ?? d}" oninput="document.getElementById('${id}-v').textContent=this.value+'%'"></label>`;
  return `<label>Where it is, for the weather<input class="input" id="amb-f-place" value="${escHtml(s.place || '')}" placeholder="empty: this device's own location"></label>
    <div class="amb-f-show">${AMB_SHOW.map(([k, l]) => `<label class="amb-check"><input type="checkbox" data-show="${k}" ${ambShown(s, k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <label>Quick buttons — one per line: <i>label | what it says to the agent</i>
      <textarea class="input" id="amb-f-buttons" rows="4" placeholder="Good night | Turn off the lights downstairs and set the heating to 18°">${escHtml(lines)}</textarea></label>
    ${advancedFold(`<div class="amb-arrange-adv">
    <label class="amb-check"><input type="checkbox" id="amb-f-auto" data-default="true" data-label="Use this device's location" ${s.auto === false ? '' : 'checked'}> With no town named, use this device's location (asks once)</label>
    <label>Units <select class="input" id="amb-f-units" data-default="metric" data-label="Units"><option value="metric">°C, km/h</option><option value="imperial" ${s.units === 'imperial' ? 'selected' : ''}>°F, mph</option></select></label>
    <div class="amb-f-row">${range('amb-f-mx', 'Side margins', s.margin, 7)}${range('amb-f-my', 'Top and bottom', s.marginY, 6)}</div>
    <label class="amb-check"><input type="checkbox" id="amb-f-listen" data-default="true" data-label="Listen for the wake word" ${s.listen === false ? '' : 'checked'}> Listen for the wake word while resting (the wake word experiment)</label>
    <label class="amb-check"><input type="checkbox" id="amb-f-24" data-default="true" data-label="24-hour clock" ${s.clock24 === false ? '' : 'checked'}> 24-hour clock</label></div>`,
      { id: 'ambient', label: 'Advanced — location, units, margins, listening, clock' })}`;
}

/** What the form holds, over what was saved (keys the form does not show are kept). */
function ambientFormRead(root, s = {}) {
  const q = sel => root.querySelector(sel);
  const buttons = q('#amb-f-buttons').value.split('\n').map(l => l.split('|')).filter(p => p.length >= 2 && p[0].trim() && p.slice(1).join('|').trim())
    .slice(0, 12).map(p => ({ label: p[0].trim().slice(0, 30), say: p.slice(1).join('|').trim().slice(0, 500) }));
  const show = Object.fromEntries([...root.querySelectorAll('[data-show]')].map(c => [c.dataset.show, c.checked]));
  return { ...s, place: q('#amb-f-place').value.trim(), auto: q('#amb-f-auto').checked, units: q('#amb-f-units').value,
    margin: Number(q('#amb-f-mx').value), marginY: Number(q('#amb-f-my').value), show, buttons,
    listen: q('#amb-f-listen').checked, clock24: q('#amb-f-24').checked };
}

/** Settings → Ambient. */
async function ambientSettingsInit() {
  const panel = document.getElementById('sp-ambient');
  if (!panel) return;
  let s = {};
  try { s = (await screenLoad(true)).settings?.ambient || {}; } catch { /* the defaults */ }
  panel.innerHTML = `<div class="card amb-settings"><div class="card-title">Ambient screen — this screen's</div>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px">The resting screen with the galaxy (Controls → Ambient, or by itself at
      <a href="/?view=ambient" target="_blank" rel="noopener">/?view=ambient</a>). Hold the galaxy, tap ◉ or say the wake word to talk.</p>
    <div class="amb-arrange-card">${ambientFormHtml(s)}</div>
    <div class="toolbar" style="margin-top:10px"><button class="btn btn-sm btn-blue" onclick="ambientSettingsSave(this)">Save</button>
      <span class="status-line" id="amb-settings-status"></span></div></div>`;
}

async function ambientSettingsSave(btn) {
  const root = btn.closest('.card');
  let s = {};
  try { s = (await screenLoad()).settings?.ambient || {}; } catch { /* the defaults */ }
  try { await screenSave({ ambient: ambientFormRead(root, s) }); setStatus(document.getElementById('amb-settings-status'), '✓ Saved', 'ok'); }
  catch (e) { setStatus(document.getElementById('amb-settings-status'), e.message, 'err'); }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  // Its panel is made here: index.html is at its line ceiling.
  if (document.getElementById('sp-ambient')) return;
  const panel = Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-ambient' });
  document.getElementById('sp-voice')?.after(panel);
});
