'use strict';

/**
 * Where a service is set up, as links (public/js/lib/app-links.js): the website on a desk, the app first on a phone —
 * only through schemes the service documents — a hub address on loopback never offered to a phone, and every address
 * in a sentence a real link with the rest escaped.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function load(userAgent) {
  const ctx = { navigator: { userAgent }, URL };
  vm.createContext(ctx);
  vm.runInContext(pub('js/lib/html.js'), ctx);
  vm.runInContext(pub('js/lib/app-links.js'), ctx);
  return ctx;
}
const DESK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 DocaMobile/1.6.0';
// The documented app schemes, and where each is documented (a new one is added here with its documentation).
const SCHEMES = { homeassistant: 'companion.home-assistant.io', tg: 'core.telegram.org', slack: 'docs.slack.dev' };

test('every page has an https web address and only a documented app scheme', () => {
  const { APP_LINKS, appLinkUrls } = vm.runInContext('({ APP_LINKS, appLinkUrls })', load(PHONE));
  for (const [id, s] of Object.entries(APP_LINKS)) {
    for (const page of Object.keys(s.pages)) {
      const u = appLinkUrls(id, page);
      assert.match(u.web, /^https:\/\//, `${id}.${page}`);
      if (!u.app) continue;
      const scheme = u.app.split(':')[0];
      assert.ok(SCHEMES[scheme], `${id}.${page}: ${scheme} is not a documented scheme here`);
      assert.ok(String(s.docs || '').includes(SCHEMES[scheme]), `${id} names where ${scheme}: is documented`);
    }
    for (const steps of Object.values(s.flows || {})) for (const t of steps) for (const [, ref] of t.matchAll(/\{(\w+)\}/g)) assert.ok(s.pages[ref], `${id}: {${ref}}`);
  }
});

test('a desk gets the website; a phone gets the app first and the website second', () => {
  const desk = vm.runInContext('appLinkHtml("telegram", "botfather")', load(DESK));
  assert.match(desk, /href="https:\/\/t\.me\/BotFather" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(desk, /tg:/);
  const phone = vm.runInContext('appLinkHtml("telegram", "botfather")', load(PHONE));
  assert.ok(phone.indexOf('tg://resolve?domain=BotFather') < phone.indexOf('https://t.me/BotFather'), phone);
  assert.match(phone, /open in Telegram/);
  // A page with no app link is the website on a phone too.
  assert.doesNotMatch(vm.runInContext('appLinkHtml("github", "newApp")', load(PHONE)), /open in/);
});

test("Home Assistant's token page: at its own address, else My Home Assistant; the app by navigate", () => {
  const desk = load(DESK);
  assert.equal(vm.runInContext('appLinkUrls("home-assistant", "token", { base: "http://localhost:8123/api/mcp" }).web', desk), 'http://localhost:8123/profile/security');
  assert.equal(vm.runInContext('appLinkUrls("home-assistant", "token").web', desk), 'https://my.home-assistant.io/redirect/profile_security');
  const phone = load(PHONE);
  const u = vm.runInContext('appLinkUrls("home-assistant", "token", { base: "http://localhost:8123" })', phone);
  assert.equal(u.app, 'homeassistant://navigate/profile/security');
  assert.equal(u.web, 'https://my.home-assistant.io/redirect/profile_security', "a phone's localhost is not the hub's");
  assert.equal(vm.runInContext('appLinkUrls("home-assistant", "token", { base: "http://192.168.1.5:8123" }).web', phone), 'http://192.168.1.5:8123/profile/security');
  const steps = vm.runInContext('appStepsHtml("home-assistant", "token")', phone);
  assert.match(steps, /^<ol class="app-steps"><li>/);
  assert.match(steps, /homeassistant:\/\/navigate\/profile\/security/);
  assert.doesNotMatch(steps, /\{token\}/);
});

test('linkify makes addresses links and escapes the rest; a base that is not http is ignored', () => {
  const ctx = load(DESK);
  const out = vm.runInContext('appLinkify("at https://github.com/settings/developers (New OAuth App) <b>")', ctx);
  assert.match(out, /<a class="app-link" href="https:\/\/github\.com\/settings\/developers" target="_blank" rel="noopener noreferrer">/);
  assert.match(out, /\(New OAuth App\) &lt;b&gt;/);
  assert.doesNotMatch(vm.runInContext('appLinkify("javascript:alert(1)")', ctx), /<a/);
  assert.equal(vm.runInContext('appLinkUrls("home-assistant", "token", { base: "javascript:alert(1)" }).web', ctx), 'https://my.home-assistant.io/redirect/profile_security');
});

test('the set-up cards use the registry and hand their steps to the agent', () => {
  assert.match(pub('index.html'), /js\/lib\/app-links\.js/);
  assert.match(pub('index.html'), /js\/settings\/service-guide\.js/);
  for (const [f, needs] of [['js/settings/connectors.js', /appStepsHtml\(c\.id, 'oauth'\)/], ['js/settings/channels.js', /appStepsHtml\('telegram', 'bot'\)/],
    ['js/settings/service-guide.js', /appStepsHtml\('home-assistant', 'token'/], ['js/mcp-catalog.js', /appStepsHtml\(s\.id, 'mcp'\)/]]) assert.match(pub(f), needs, f);
  for (const f of ['js/settings/connectors.js', 'js/settings/channels.js', 'js/mcp-catalog.js', 'js/settings/service-keys.js']) assert.match(pub(f), /helpAsk|appAskAttr/, f);
  assert.match(pub('js/agent-ui/form-help.js'), /box\.dataset\.helpAsk \|\| `Help with/);
});
