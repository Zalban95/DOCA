'use strict';

// A device's look (modules/look, PROTOCOL §14.1): the panel's palette, ground, fonts and corners for a device's screen
// settings, read from the panel's own theme table — so the server's table is the browser's, and an app's own screens
// can be drawn the panel's way. A change to a device's layer or its person's is announced as settings.changed.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

const PUB = path.join(__dirname, '..', 'public');
const { resolve, groundOf } = require('../modules/look/resolve');

/** The browser's own table, evaluated here apart from the module's: THEMES, SKINS, themeGroundOf. */
function browser() {
  const ctx = { document: { documentElement: { style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, dataset: {} }, getElementById: () => null },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), localStorage: { getItem: () => null, setItem() {} } };
  const js = f => fs.readFileSync(path.join(PUB, 'js', f), 'utf8');
  vm.runInNewContext(`${js('themes.js')}\n${js('look.js')}\n${js('look-points.js')}\nthis.out = { THEMES, SKINS, THEME_CSS_KEYS, themeGroundOf };`, ctx);
  return ctx.out;
}

test('every theme the panel has resolves to its own colours and the browser\'s ground', () => {
  const b = browser();
  const camel = k => k.replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
  for (const [id, t] of Object.entries(b.THEMES)) {
    const look = resolve({ theme: id });
    assert.equal(look.theme, id);
    for (const [k, v] of Object.entries(t.colors)) {
      if (!/^#/.test(v)) continue;   // fonts
      if (k === '--text-muted') continue;   // an alias of muted, not a role
      assert.equal(look.palette[camel(k)], v.toLowerCase(), `${id} ${k}`);
    }
    assert.equal(look.ground, b.themeGroundOf(t.colors['--bg']), `${id}'s ground is the browser's`);
    assert.equal(groundOf(t.colors['--bg']), b.themeGroundOf(t.colors['--bg']));
  }
  assert.deepEqual(Object.keys(resolve({}).palette).length, b.THEME_CSS_KEYS.length - 2, 'every colour key, less the mono font and its alias');
});

test('a role a theme does not name is what variables.css gives it', () => {
  const d = resolve({ theme: 'dracula' });
  assert.equal(d.palette.onAccent, d.palette.bg, '--on-accent is the ground');
  assert.equal(d.palette.stopped, d.palette.faint);
  assert.equal(d.palette.field, d.palette.cyan);
  assert.equal(resolve({ theme: 'points' }).palette.onAccent, '#050507', 'Points names its own');
});

test('the style\'s fonts and corners are its stylesheet\'s', () => {
  const css = f => fs.readFileSync(path.join(PUB, 'css', f), 'utf8');
  const classic = resolve({ skin: 'nonsense' });
  assert.equal(classic.skin, 'classic', 'an unknown style is Classic, as lookApply has it');
  assert.equal(classic.radius.control, Number(/--radius:\s*(\d+)px/.exec(css('variables.css'))[1]));
  assert.equal(classic.fonts.ui[0], 'IBM Plex Mono', 'Classic reads in its mono face');
  const points = resolve({ skin: 'points', theme: 'points' });
  assert.deepEqual([points.radius.control, points.radius.card], [6, 10]);
  assert.match(css('skin-points.css'), /--radius: 6px;\s*--radius-card: 10px;/);
  assert.equal(points.fonts.ui[0], 'IBM Plex Sans');
  assert.equal(points.fonts.mono[0], 'IBM Plex Mono');
  const modern = resolve({ skin: 'modern' });
  assert.equal(modern.radius.control, 10);
  assert.equal(modern.radius.card, 10, 'a card takes the control\'s corner when the style names none');
  assert.equal(modern.fonts.ui[0], 'Inter');
  assert.equal(modern.fonts.display[0], 'Inter', '--font-display follows the style\'s --font-ui');
});

test('a custom theme is the default under the person\'s colours, and only colours', () => {
  const c = resolve({ theme: 'custom', customTheme: { '--accent': '#F0F', '--bg': 'url(https://x)', '--red': 'red' } });
  assert.equal(c.theme, 'custom');
  assert.equal(c.palette.accent, '#ff00ff');
  assert.equal(c.palette.bg, resolve({}).palette.bg, 'a value that is not a hex colour is not drawn');
  assert.equal(c.palette.red, resolve({}).palette.red);
  assert.equal(resolve({ theme: 'nope' }).theme, 'default');
  assert.notEqual(resolve({ theme: 'nord' }).etag, resolve({ theme: 'dracula' }).etag);
});

test('a device reads its look; a change to its layer or its person\'s is announced, a browser is not told', async () => {
  const devices = require('../modules/api-v1/devices'), bus = require('../modules/api-v1/bus'), screens = require('../modules/screens');
  const phone = H.mkDevice('look phone', 'phone', H.PHONE_CAPS);
  devices.update(phone.device.id, { userId: H.owner.user.id });
  const before = await H.api(phone.token, 'GET', '/api/v1/settings/look');
  assert.equal(before.status, 200);
  assert.equal(before.body.deviceId, phone.device.id);
  assert.ok(before.body.look.palette.accent);

  const r = await fetch(`${H.base}/api/screen/settings?device=${phone.device.id}`, { method: 'POST',
    headers: { Cookie: H.owner.cookie, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'pointsDaylight', skin: 'points' }) });
  assert.equal(r.status, 200);
  const told = bus.drain(phone.device.id, 0).events.filter(e => e.type === 'settings.changed').at(-1);
  assert.deepEqual(told.payload, { layer: 'device', keys: ['theme', 'skin'], look: true, url: '/api/v1/settings/effective', lookUrl: '/api/v1/settings/look' });
  const after = (await H.api(phone.token, 'GET', '/api/v1/settings/look')).body.look;
  assert.equal(after.ground, 'light');
  assert.equal(after.skin, 'points');
  assert.deepEqual(after.from, { theme: 'device', customTheme: 'default', skin: 'device' });
  assert.notEqual(after.etag, before.body.look.etag);

  const n = () => bus.drain(phone.device.id, 0).events.filter(e => e.type === 'settings.changed').length;
  const was = n();
  screens.setPerson(H.owner.user.id, { hiddenTabs: ['docker'] });
  const last = bus.drain(phone.device.id, 0).events.filter(e => e.type === 'settings.changed').at(-1);
  assert.equal(n(), was + 1, 'the person\'s layer reaches each of their devices');
  assert.equal(last.payload.layer, 'person');
  assert.equal(last.payload.look, false, 'not a change of look');
  screens.setPerson(H.owner.user.id, { hiddenTabs: null });

  const browserScreen = await fetch(`${H.base}/api/screen`, { headers: { Cookie: H.owner.cookie } }).then(x => x.json());
  screens.set(browserScreen.id, { theme: 'nord' });
  assert.equal(bus.drain(browserScreen.id, 0).events.filter(e => e.type === 'settings.changed').length, 0, 'a browser has no event stream to tell');
  assert.equal((await H.api('', 'GET', '/api/v1/settings/look')).status, 401);
});
