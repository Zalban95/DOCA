/* Controls → Home (modules/home; TODO H10.10): the home drawn in the panel's own layout from Home Assistant, which
   stays the device layer. Each area is a card in the theme with a tile per light, switch, fan, cover, thermostat, lock,
   player, scene, sensor and camera; a tap acts (the hub sends HA a short list of services), and every change arrives on
   the live feed (`home`) while the page is shown — the page holds the hub's one connection to HA open, and leaving it
   lets go. Unlocking a door or disarming an alarm asks for the password. Best alone on a wall tablet: /?view=home.
   Its page is made here (index.html is at its line ceiling). */
const HOME = { on: false, off: null, tiles: new Map(), cams: null, busy: null };

/** Shown or left (nav.js). */
async function homeTab(shown) {
  if (!shown) {
    if (!HOME.on) return;
    HOME.on = false;
    clearInterval(HOME.cams); HOME.cams = null;
    return _homeHold(false);
  }
  if (HOME.on) return;
  HOME.on = true;
  if (!HOME.off && typeof liveOn === 'function') HOME.off = liveOn('home', _homeChange);
  await homeLoad();
  _homeHold(true);
  HOME.cams = setInterval(_homeCams, 10000);
}

async function _homeHold(on) {
  for (let i = 0; i < 40 && !_liveScreen; i++) await new Promise(r => setTimeout(r, 100));
  if (_liveScreen) apiFetch('/api/home/hold', { method: 'POST', body: { screen: _liveScreen, on } }).catch(() => { /* reconnecting */ });
}

async function homeLoad() {
  const page = document.getElementById('tab-home');
  if (!page) return;
  let d;
  try { d = await apiFetch('/api/home'); } catch (e) { d = { connected: false, error: e.message }; }
  HOME.tiles = new Map();
  const bar = `<div class="home-bar"><span class="home-title">Home</span><span class="home-place">${escHtml(d.place || '')}</span>
    <span class="home-dot ${d.connected ? 'on' : ''}" title="${d.connected ? 'Connected to Home Assistant' : 'Not connected'}"></span>
    <button class="btn btn-xs" onclick="homeLoad()" title="Read it all again">⟳</button>
    <button class="btn btn-xs" onclick="soloOpen('home')" title="In a window of its own — a wall tablet">⧉</button></div>`;
  if (d.setup) { page.innerHTML = bar + _homeSetup(); return; }
  if (!d.connected) {
    page.innerHTML = bar + `<div class="home-empty"><h3>Home Assistant did not answer</h3><p>${escHtml(d.error || 'No connection.')}</p>
      <p class="home-hint">The address and token are the key <b>home-assistant</b> in Field → Connectors → Keys for services.</p>
      <button class="btn btn-sm" onclick="homeLoad()">Try again</button> <button class="btn btn-sm" onclick="nav('connectors')">Keys for services</button></div>`;
    return;
  }
  if (!d.areas.length) { page.innerHTML = bar + '<div class="home-empty"><h3>Nothing to show</h3><p>Home Assistant has no lights, switches, climate, covers, locks, sensors or cameras this account may see.</p></div>'; return; }
  for (const a of d.areas) for (const t of a.tiles) HOME.tiles.set(t.id, t);
  page.innerHTML = bar + `<div class="home-areas">${d.areas.map(a => `<section class="home-area"><h3>${escHtml(a.name)}</h3>
    <div class="home-tiles">${a.tiles.map(_homeTile).join('')}</div></section>`).join('')}</div>`;
}

function _homeSetup() {
  return `<div class="home-empty"><h3>Connect Home Assistant</h3>
    <p>DOCA draws your home from Home Assistant, which keeps talking to the devices themselves.</p>
    <ol><li>In Home Assistant, open your profile → Security → <b>Long-lived access tokens</b> and create one.</li>
      <li>In <b>Field → Connectors → Keys for services</b>, add a key named <b>home-assistant</b> with Home Assistant's address
        (for example http://homeassistant.local:8123) and paste the token.</li>
      <li>Come back here. The token stays on the hub; this page never sees it.</li></ol>
    <button class="btn btn-sm btn-blue" onclick="nav('connectors')">Keys for services</button></div>`;
}

const _homeOn = t => ['on', 'open', 'opening', 'unlocked', 'playing', 'heat', 'cool', 'heat_cool', 'auto'].includes(t.state);
const _homeAttr = (k, v) => `data-${k}="${escHtml(String(v))}"`;
const _homeBtn = (t, service, label, data = null, cls = '') =>
  `<button class="home-act ${cls}" onclick="event.stopPropagation();homeCall('${t.id}','${service}'${data ? `,${escHtml(JSON.stringify(data))}` : ''})">${label}</button>`;

/** One tile: its name, its state in words, and what can be done with it here. */
function _homeTile(t) {
  const a = t.attrs || {};
  const unit = a.unit_of_measurement ? ` ${escHtml(a.unit_of_measurement)}` : '';
  const off = ['unavailable', 'unknown'].includes(t.state);
  let body = '', tap = '';
  switch (t.domain) {
    case 'light': case 'switch': case 'fan':
      if (!off) tap = `onclick="homeCall('${t.id}','toggle')"`;
      body = `<div class="home-state">${escHtml(t.state)}${t.domain === 'light' && a.brightness && t.state === 'on' ? ` · ${Math.round(a.brightness / 2.55)}%` : ''}</div>`;
      if (t.domain === 'light' && (a.supported_color_modes || []).some(m => m !== 'onoff'))
        body += `<input type="range" class="home-range" min="1" max="100" value="${a.brightness ? Math.round(a.brightness / 2.55) : 0}" aria-label="Brightness"
          onclick="event.stopPropagation()" onpointerdown="HOME.busy='${t.id}'" onchange="HOME.busy=null;homeCall('${t.id}','turn_on',{brightness_pct:+this.value})">`;
      if (t.domain === 'fan' && a.percentage !== undefined)
        body += `<input type="range" class="home-range" min="0" max="100" step="10" value="${+a.percentage || 0}" aria-label="Speed"
          onclick="event.stopPropagation()" onpointerdown="HOME.busy='${t.id}'" onchange="HOME.busy=null;homeCall('${t.id}','set_percentage',{percentage:+this.value})">`;
      break;
    case 'cover':
      body = `<div class="home-state">${escHtml(t.state)}${a.current_position !== undefined ? ` · ${+a.current_position}%` : ''}</div>
        <div class="home-acts">${_homeBtn(t, 'open_cover', '▲')}${_homeBtn(t, 'stop_cover', '■')}${_homeBtn(t, 'close_cover', '▼')}</div>`;
      break;
    case 'climate': {
      const step = +a.target_temp_step || 0.5, to = a.temperature === null || a.temperature === undefined ? null : +a.temperature;
      body = `<div class="home-value">${escHtml(String(a.current_temperature ?? '—'))}<small>°</small></div>
        <div class="home-state">${escHtml(a.hvac_action || t.state)}${to !== null ? ` → ${to}°` : ''}</div>
        ${to !== null ? `<div class="home-acts">${_homeBtn(t, 'set_temperature', '−', { temperature: +(to - step).toFixed(1) })}${_homeBtn(t, 'set_temperature', '+', { temperature: +(to + step).toFixed(1) })}</div>` : ''}`;
      break;
    }
    case 'lock':
      body = `<div class="home-state">${escHtml(t.state)}</div><div class="home-acts">${t.state === 'locked' ? _homeBtn(t, 'unlock', 'Unlock', null, 'warn') : _homeBtn(t, 'lock', 'Lock')}</div>`;
      break;
    case 'alarm_control_panel':
      body = `<div class="home-state">${escHtml(t.state.replace(/_/g, ' '))}</div><div class="home-acts">${t.state === 'disarmed'
        ? _homeBtn(t, 'alarm_arm_home', 'Arm home') + _homeBtn(t, 'alarm_arm_away', 'Away') : _homeBtn(t, 'alarm_disarm', 'Disarm', null, 'warn')}</div>`;
      break;
    case 'media_player':
      body = `<div class="home-state">${escHtml(a.media_title ? `${a.media_title}${a.media_artist ? ` — ${a.media_artist}` : ''}` : t.state)}</div>
        <div class="home-acts">${_homeBtn(t, 'media_previous_track', '⏮')}${_homeBtn(t, 'media_play_pause', t.state === 'playing' ? '⏸' : '▶')}${_homeBtn(t, 'media_next_track', '⏭')}</div>`;
      break;
    case 'scene': case 'script':
      tap = `onclick="homeCall('${t.id}','turn_on')"`;
      body = `<div class="home-state">${t.domain === 'scene' ? 'scene' : t.state === 'on' ? 'running' : 'script'}</div>`;
      break;
    case 'camera':
      body = `<img class="home-cam" alt="${escHtml(t.name)}" loading="eager" src="/api/home/camera/${encodeURIComponent(t.id)}?t=${Date.now()}" onerror="this.classList.add('gone')">`;
      break;
    default:   // sensor, binary_sensor
      body = `<div class="home-value">${escHtml(t.domain === 'binary_sensor' ? _homeBinary(t) : t.state)}<small>${unit}</small></div>${a.device_class ? `<div class="home-state">${escHtml(String(a.device_class).replace(/_/g, ' '))}</div>` : ''}`;
  }
  return `<div class="home-tile home-${t.domain}${_homeOn(t) ? ' on' : ''}${off ? ' off' : ''}${tap ? ' tap' : ''}" ${_homeAttr('entity', t.id)} ${tap}
    title="${escHtml(t.id)}"><div class="home-name">${escHtml(t.name)}</div>${body}</div>`;
}

// A binary sensor in words its kind uses: a door is open or closed, motion detected or clear.
const _HOME_BINARY = { door: ['open', 'closed'], window: ['open', 'closed'], opening: ['open', 'closed'], garage_door: ['open', 'closed'],
  motion: ['detected', 'clear'], occupancy: ['detected', 'clear'], presence: ['home', 'away'], moisture: ['wet', 'dry'], smoke: ['smoke', 'clear'], lock: ['unlocked', 'locked'] };
const _homeBinary = t => (_HOME_BINARY[t.attrs?.device_class] || [])[t.state === 'on' ? 0 : t.state === 'off' ? 1 : 2] || t.state;

/** Asks the hub to do one thing; the change itself comes back on the live feed. */
async function homeCall(id, service, data = {}) {
  const el = document.querySelector(`.home-tile[data-entity="${CSS.escape(id)}"]`);
  el?.classList.add('busy');
  try { await apiFetch('/api/home/call', { method: 'POST', body: { domain: id.split('.')[0], service, entity_id: id, data } }); }
  catch (e) { if (el) { el.classList.add('failed'); el.title = e.message; } }
  finally { setTimeout(() => el?.classList.remove('busy', 'failed'), 1500); }
}

function _homeChange(c) {
  if (!HOME.on) return;
  if (c.what === 'state' && c.tile) {
    HOME.tiles.set(c.id, c.tile);
    const el = document.querySelector(`.home-tile[data-entity="${CSS.escape(c.id)}"]`);
    if (el && HOME.busy !== c.id && c.tile.domain !== 'camera') el.outerHTML = _homeTile(c.tile);
    return;
  }
  if (c.what === 'resync') { _homeHold(true); }
  if (['resync', 'layout', 'status', 'removed'].includes(c.what)) homeLoad();
}

/** Cameras redraw their still while the page is shown and looked at; the hub keeps one a few seconds for every screen. */
function _homeCams() {
  if (!HOME.on || document.hidden) return;
  for (const img of document.querySelectorAll('#tab-home .home-cam:not(.gone)')) img.src = img.src.replace(/t=\d+/, `t=${Date.now()}`);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-home' });
  document.getElementById('tab-settings')?.before(page);
});
