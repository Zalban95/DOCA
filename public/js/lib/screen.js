/* ═══════════════════════════════════════════════════════
   This screen's settings (modules/screens; TODO H2.2–H2.3): a browser is a
   device, and how it shows the panel — theme, style, tabs, sidebar sections —
   is its own, layered over the hive's. screenPrefs() is prefs with this
   screen's values over them; screenSave() changes this screen only.
   ═══════════════════════════════════════════════════════ */

let _screen = null;

async function screenLoad(force) {
  if (_screen && !force) return _screen;
  try { _screen = await apiFetch('/api/screen'); } catch { _screen = { settings: {}, from: {}, keys: [] }; }
  return _screen;
}

/** The prefs this screen goes by: the hive's, with this screen's (and its person's) over them. */
async function screenPrefs() {
  const [prefs, s] = await Promise.all([apiFetch('/api/prefs').catch(() => ({})), screenLoad()]);
  return { ...prefs, ...s.settings };
}

/** Change how this screen shows the panel; null puts a key back to the hive's. */
async function screenSave(patch) {
  _screen = { ...(_screen || {}), ...(await apiFetch('/api/screen/settings', { method: 'POST', body: patch })) };
  return _screen;
}

/** Settings → General: which screen these are, and the way back to the hive's. */
async function screenSettingsNote() {
  const status = document.getElementById('theme-status');
  if (!status || document.getElementById('screen-note')) return;
  const s = await screenLoad(true);
  const own = Object.entries(s.from || {}).filter(([, f]) => f === 'device').map(([k]) => k);
  const note = Object.assign(document.createElement('div'), { id: 'screen-note' });
  note.style.cssText = 'font-size:11px;color:var(--muted);margin-top:10px';
  note.innerHTML = `Style, colours, tabs and sidebar sections are this screen's own — <b>${escHtml(s.name || 'this browser')}</b> — so a phone and a desk can differ.
    ${own.length ? `<a href="#" onclick="screenReset();return false">Use the hive's again</a> (${escHtml(own.join(', '))})` : 'It follows the hive\'s for now.'}`;
  status.before(note);
}

async function screenReset() {
  const own = Object.entries((await screenLoad(true)).from || {}).filter(([, f]) => f === 'device').map(([k]) => k);
  await screenSave(Object.fromEntries(own.map(k => [k, null])));
  location.reload();
}
