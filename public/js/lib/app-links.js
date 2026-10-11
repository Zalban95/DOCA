/* ═══════════════════════════════════════════════════════
   Where a service's set-up happens, as links (asked 2026-10-11: "the links for connectors could be clickable, and
   take us to the right apps in mobile when possible or to the website"). One registry: per service the exact pages a
   person opens while setting it up — a token page, a developer console, a bot — each with its web address and, only
   where the service documents one, the link that opens its phone app (`docs` names where it is documented; nothing
   here is guessed). On a phone (DocaMobile's WebView, whose user agent carries `DocaMobile/`, or a phone's browser)
   "Open in the app" comes first and the website second; on a desk, the website. A link never carries a secret: the
   pages are where a secret is made, never where one is sent.

   appLinkHtml(service, page, {base})      the page's link(s)
   appStepsHtml(service, flow, {base})     a numbered list of the steps, its pages linked
   appLinkify(text)                        escapes text and makes every http(s) address in it a link
   appAskAttr(text)                        data-help-ask="…": the first message ✨ Ask the agent opens the chat with
   ═══════════════════════════════════════════════════════ */

const APP_LINK_ATTRS = 'target="_blank" rel="noopener noreferrer"';

/** A phone: DocaMobile's WebView, or a phone or tablet browser. */
function appLinksPhone() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /DocaMobile\//.test(ua) || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || !!(typeof navigator !== 'undefined' && navigator.userAgentData?.mobile);
}

/** A loopback address means this hub's own machine: on a phone it is the phone's own, so it is not offered there. */
const _alLoopback = base => /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(String(base || ''));
const _alOrigin = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; } };

const APP_LINKS = {
  'home-assistant': {
    name: 'Home Assistant', app: 'the Home Assistant app',
    docs: 'https://companion.home-assistant.io/docs/integrations/url-handler/',   // homeassistant://navigate/<path>
    pages: {
      // At this hub's Home Assistant when its address is known, else My Home Assistant's documented redirect, which asks once.
      token: { label: 'Profile → Security', path: '/profile/security', my: 'https://my.home-assistant.io/redirect/profile_security' },
      mcp: { label: 'the Model Context Protocol Server integration', path: '/config/integrations/dashboard',
        my: 'https://my.home-assistant.io/redirect/config_flow_start?domain=mcp_server' },
    },
    web: (p, base) => (base ? `${base}${p.path}` : p.my),
    appLink: p => `homeassistant://navigate${p.path}`,
    flows: {
      token: ['Open {token} in Home Assistant, signed in as the person whose rights the hub should have.',
        'Under Long-lived access tokens press Create token, and name it after this hub.',
        'Copy the token — Home Assistant shows it once — and paste it as the key below, with Home Assistant\'s address (http://<its address>:8123).'],
      mcp: ['In Home Assistant, add {mcp} (it serves the entities you expose to Assist as tools).',
        'Make a token at {token} (Long-lived access tokens → Create token) and copy it.',
        'Paste it in Field → Connectors → API services as the key home-assistant, with Home Assistant\'s address; then Start the server here.'],
    },
  },
  telegram: {
    name: 'Telegram', app: 'Telegram', docs: 'https://core.telegram.org/api/links',   // tg://resolve?domain=<username>[&start=]
    pages: { botfather: { label: '@BotFather', web: 'https://t.me/BotFather', app: 'tg://resolve?domain=BotFather' } },
    flows: { bot: ['Open {botfather} and send /newbot.', 'Answer its two questions: a name, then a username ending in "bot".',
      'Copy the token it sends (123456:ABC…) and paste it below as the bot token; switch it on and Save.'] },
  },
  slack: {
    name: 'Slack', app: 'Slack', docs: 'https://docs.slack.dev/interactivity/deep-linking/',   // slack://open
    pages: { apps: { label: 'api.slack.com/apps', web: 'https://api.slack.com/apps' },
      open: { label: 'Slack', web: 'https://app.slack.com/client', app: 'slack://open' } },
    flows: { app: ['Create an app at {apps} (From scratch), in your workspace.',
      'Socket Mode: switch it on and make an app-level token with connections:write (xapp-…).',
      'Event Subscriptions: subscribe to the bot event message.im. OAuth & Permissions: give the bot chat:write, im:history, files:read, files:write and users:read.',
      'App Home: allow messages in the Messages tab. Install it, copy the bot token (xoxb-…), paste both tokens below, switch it on and Save.'] },
  },
  matrix: {
    name: 'Matrix', app: 'Element', docs: 'https://spec.matrix.org/latest/appendices/#matrixto-navigation',
    pages: { element: { label: 'Element', web: 'https://app.element.io' } },
    flows: { bot: ['Make an account for the bot on your homeserver (in {element} or your own server\'s sign-up).',
      'Signed in as the bot: Settings → Help & About → Access token; copy it.', 'Paste the homeserver\'s address and the token below, switch it on and Save.'] },
  },
  github: {
    name: 'GitHub', app: 'GitHub',
    pages: { newApp: { label: 'New OAuth App', web: 'https://github.com/settings/applications/new' },
      apps: { label: 'Developer settings', web: 'https://github.com/settings/developers' } },
    flows: { oauth: ['Open {newApp} (under {apps}).', 'Name it, give this panel\'s address as the homepage, and the callback address above as the Authorization callback URL.',
      'Register it, then Generate a new client secret.', 'Paste the Client ID and the secret below, Save, then Connect.'] },
  },
  google: {
    name: 'Google', app: 'Google Cloud console',
    pages: { credentials: { label: 'Google Cloud → Credentials', web: 'https://console.cloud.google.com/apis/credentials' },
      consent: { label: 'the OAuth consent screen', web: 'https://console.cloud.google.com/apis/credentials/consent' },
      library: { label: 'the API library', web: 'https://console.cloud.google.com/apis/library' } },
    flows: { oauth: ['In a Google Cloud project, set up {consent} (External; add yourself as a test user).',
      'Enable the Calendar, Gmail and Drive APIs in {library}.',
      'In {credentials}: Create credentials → OAuth client ID, type Web application, with the callback address above as an authorised redirect URI.',
      'Paste the client id and secret below, Save, then Connect.'] },
  },
  microsoft: {
    name: 'Microsoft 365', app: 'Microsoft Entra',
    pages: { registrations: { label: 'Entra → App registrations', web: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' } },
    flows: { oauth: ['Open {registrations} → New registration.', 'Choose who may sign in, and add a Web redirect URI: the callback address above.',
      'Copy the Application (client) ID from its Overview; under Certificates & secrets make a New client secret and copy its Value.',
      'Paste both below, Save, then Connect.'] },
  },
  gmail: { name: 'Google account', pages: { appPassword: { label: 'Google app passwords', web: 'https://myaccount.google.com/apppasswords' } } },
  outlook: { name: 'Microsoft account', pages: { security: { label: 'Microsoft account security', web: 'https://account.microsoft.com/security' } } },
};

function _alPage(service, page) {
  const s = APP_LINKS[service], p = s?.pages?.[page];
  return p ? { s, p } : null;
}

/** Where the page is, on the web and in the app: {web, app}. `base`: the service's own address, when it has one here. */
function appLinkUrls(service, page, { base = '' } = {}) {
  const hit = _alPage(service, page);
  if (!hit) return null;
  const { s, p } = hit;
  const origin = _alOrigin(base);
  const useBase = origin && !(appLinksPhone() && _alLoopback(origin)) ? origin : '';
  const web = typeof s.web === 'function' ? s.web(p, useBase) : p.web;
  const app = typeof s.appLink === 'function' ? s.appLink(p) : p.app || '';
  return { web, app, label: p.label, appName: s.app || s.name };
}

/** The page's link: on a phone "Open in the app" first and the website second when the service has an app link; else the website. */
function appLinkHtml(service, page, { base = '', label = '' } = {}) {
  const u = appLinkUrls(service, page, { base });
  if (!u) return '';
  const text = escHtml(label || u.label);
  const web = `<a class="app-link" href="${escHtml(u.web)}" ${APP_LINK_ATTRS}>${text} ↗</a>`;
  if (!u.app || !appLinksPhone()) return web;
  return `<a class="app-link app-link-app" href="${escHtml(u.app)}">${text} — open in ${escHtml(u.appName)}</a> <span class="app-link-or">or</span> `
    + `<a class="app-link" href="${escHtml(u.web)}" ${APP_LINK_ATTRS}>the website ↗</a>`;
}

/** A flow's steps as a numbered list, each {page} a link. */
function appStepsHtml(service, flow, { base = '' } = {}) {
  const steps = APP_LINKS[service]?.flows?.[flow];
  if (!steps) return '';
  return `<ol class="app-steps">${steps.map(t => `<li>${escHtml(t).replace(/\{(\w+)\}/g, (m, id) => appLinkHtml(service, id, { base }) || m)}</li>`).join('')}</ol>`;
}

/** Text with every http(s) address in it a link (the rest escaped). */
function appLinkify(text) {
  return String(text ?? '').split(/(https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?])/).map((part, i) =>
    (i % 2 ? `<a class="app-link" href="${escHtml(part)}" ${APP_LINK_ATTRS}>${escHtml(part)}</a>` : escHtml(part))).join('');
}

/** The first message "✨ Ask the agent" puts in the chat for this card (form-help.js reads it; never sent by itself). */
function appAskAttr(text) { return ` data-help-ask="${escHtml(text)}"`; }
