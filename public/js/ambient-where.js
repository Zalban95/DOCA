/* Where the ambient screen is, for the weather (2026-10-08: a fresh Ambient on a phone said "no place set" while the
   phone knew where it was). With no town named, the screen uses its device's own position — the browser's, or DOCA's
   phone app's (its WebView answers for the hub's own pages) — names it through the hub (modules/ambient/weather.js)
   and keeps it as this screen's `ambient.here`, so the hub's `today` for the agent and a later visit that cannot
   locate find it too (modules/ambient/where.js). With no position at all the weather slot offers two choices: use this
   device's location (asked inside the tap, which is when a browser or the app may ask), or type a town. */
const AMB_WHERE = { coords: null, why: '' };
const AMB_WHERE_KEEP_MS = 1800000;     // a position is asked for again after half an hour
const AMB_WHERE_MOVED = 0.02;          // degrees (~2 km): moved far enough to be kept again

/** This device's position now as "lat,lon", or '' (why it is not is kept in AMB_WHERE.why). */
function ambientLocate() {
  if (AMB_WHERE.coords && Date.now() - AMB_WHERE.coords.at < AMB_WHERE_KEEP_MS) return Promise.resolve(AMB_WHERE.coords.q);
  if (!navigator.geolocation) { AMB_WHERE.why = 'this browser gives no location here'; return Promise.resolve(''); }
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(p => {
    const lat = p.coords.latitude, lon = p.coords.longitude;
    AMB_WHERE.coords = { at: Date.now(), lat, lon, q: `${lat.toFixed(3)},${lon.toFixed(3)}` };
    AMB_WHERE.why = '';
    resolve(AMB_WHERE.coords.q);
  }, e => {
    AMB_WHERE.why = e?.code === 1 ? 'location is not allowed for this page' : e?.code === 3 ? 'the location took too long' : 'no location fix';
    resolve('');
  }, { timeout: 8000, maximumAge: AMB_WHERE_KEEP_MS }));
}

/** The place to ask the weather for: the town named, else the position now, else '' (the hub then uses the kept one). */
function ambientWhere(s) {
  if (s.place) return Promise.resolve(s.place);
  if (s.auto === false) return Promise.resolve('');
  return ambientLocate();
}

/** After the weather came back for a fresh position: keep it as this screen's, named, when it is new or moved. */
async function ambientRemember(s, w) {
  const c = AMB_WHERE.coords;
  if (s.place || s.auto === false || !c || !w?.here || !w.place) return s;
  const h = s.here || {};
  const moved = !(Math.abs((h.lat ?? 999) - c.lat) < AMB_WHERE_MOVED && Math.abs((h.lon ?? 999) - c.lon) < AMB_WHERE_MOVED);
  if (!moved && h.name === w.place) return s;
  const next = { ...s, here: { lat: Number(c.lat.toFixed(3)), lon: Number(c.lon.toFixed(3)), name: w.place, at: new Date().toISOString() } };
  try { await screenSave({ ambient: next }); return next; } catch { return s; }
}

/** The weather slot with no place: the two ways to give one. */
function ambientWhereChoices() {
  return `<div class="amb-where">
    <div class="amb-muted">Where is this screen? The weather needs a place.</div>
    <button class="amb-button" onclick="ambientUseLocation(this)">◎ Use this device's location</button>
    <form class="amb-town" onsubmit="ambientTypeTown(event)"><input class="input amb-town-in" name="town" placeholder="Type a town" autocomplete="address-level2" aria-label="Town">
      <button class="amb-button" type="submit">Set</button></form>
    <div class="amb-muted amb-where-why">${AMB_WHERE.why ? `Not now: ${escHtml(AMB_WHERE.why)}${AMB_WHERE.why.includes('not allowed') ? ' — allow it in the browser’s or the app’s settings, or type a town.' : '.'}` : ''}</div>
  </div>`;
}

/** ◎: asked inside the tap. The screen's own setting says to use the device's position from now on. */
async function ambientUseLocation(btn) {
  btn.disabled = true; btn.textContent = 'Locating…';
  AMB_WHERE.coords = null;
  const q = await ambientLocate();
  if (!q) { btn.disabled = false; btn.textContent = '◎ Use this device\'s location'; const why = btn.parentElement.querySelector('.amb-where-why'); if (why) why.textContent = `Not now: ${AMB_WHERE.why}.`; return; }
  if (AMB.s.auto === false) { AMB.s = { ...AMB.s, auto: true }; try { await screenSave({ ambient: AMB.s }); } catch { /* used now all the same */ } }
  _ambLoad();
}

/** A town typed: checked with the hub first, then kept as this screen's place. */
async function ambientTypeTown(e) {
  e.preventDefault();
  const form = e.target, input = form.querySelector('input'), why = form.parentElement.querySelector('.amb-where-why');
  const q = input.value.trim();
  if (!q) return;
  try {
    await apiFetch(`/api/ambient/place?q=${encodeURIComponent(q)}`);
    AMB.s = { ...AMB.s, place: q };   // as typed, once the hub found it: the geocoder reads a town's name, not "Town, Region, CC"
    await screenSave({ ambient: AMB.s });
    _ambLoad();
  } catch (err) { if (why) why.textContent = err.message; }
}
