'use strict';

/**
 * Field → Connectors as a person sees it: services, each with its ways to connect, simplest first — a calendar's
 * secret address, an app password (mail, CalDAV/CardDAV), a key you paste (a key for services, service-keys.js), then
 * OAuth with your own app (catalog.js). Every way but the key is a connector of its own (vault id below) and so the
 * tool connector_<id>; a key is used with api_call. The how-to lines and links were read from each provider's help
 * pages on 2026-10-08.
 */
const KEYS = {
  github: { name: 'github', origin: 'https://api.github.com', note: 'GitHub personal access token', test: { path: '/user' },
    how: 'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained: give it read access to what DOCA may see.', link: 'https://github.com/settings/personal-access-tokens' },
  notion: { name: 'notion', origin: 'https://api.notion.com', note: 'Notion internal integration — send the header Notion-Version: 2026-03-11', test: { path: '/v1/users/me', headers: { 'Notion-Version': '2026-03-11' } },
    how: 'Notion → Developers → New integration (Internal): copy its secret, then share each page it may read with it (the page\'s ••• → Connections).', link: 'https://www.notion.so/developers' },
  todoist: { name: 'todoist', origin: 'https://api.todoist.com', note: 'Todoist API token (paths under /api/v1)', test: { path: '/api/v1/projects' },
    how: 'Todoist → Settings → Integrations → Developer → API token.', link: 'https://app.todoist.com/app/settings/integrations/developer' },
  linear: { name: 'linear', origin: 'https://api.linear.app', prefix: '', note: 'Linear personal API key — GraphQL at POST /graphql', test: { method: 'POST', path: '/graphql', body: { query: '{ viewer { name } }' }, expect: '"viewer"' },
    how: 'Linear → Settings → Security & access → Personal API keys → New API key (it starts lin_api_; Linear wants it without "Bearer").', link: 'https://linear.app/settings/account/security' },
  slack: { name: 'slack', origin: 'https://slack.com', note: 'Slack user token (xoxp-) — methods under /api', test: { path: '/api/auth.test', expect: '"ok":true' },
    how: 'Make an app at api.slack.com/apps, add User Token Scopes under OAuth & Permissions (search:read, channels:history…), Install to Workspace, and copy the User OAuth Token (xoxp-…). No callback address is needed.', link: 'https://api.slack.com/apps' },
};

const ICS = {
  google: { how: 'Google Calendar → Settings → your calendar under "Settings for my calendars" → Integrate calendar → "Secret address in iCal format". A work or school account\'s admin may have turned it off.', link: 'https://support.google.com/calendar/answer/37648' },
  icloud: { how: 'icloud.com/calendar → hold the pointer over the calendar → Public Calendar → Copy. Anyone with the link can read it.', link: 'https://support.apple.com/guide/icloud/share-a-calendar-mm6b1a9479/icloud' },
  microsoft: { how: 'Outlook.com → Settings → Calendar → Shared calendars → Publish a calendar → choose it and "Can view all details" → Publish → copy the ICS link.', link: 'https://support.microsoft.com/en-US/Outlook/share-your-calendar-in-outlook-com' },
  fastmail: { how: 'Fastmail → Settings → Calendars → the calendar\'s Edit & share → Publish → Full event details → copy the address.', link: 'https://www.fastmail.help/hc/en-us/articles/360060590793' },
  other: { how: 'Any calendar\'s iCal (ICS) or webcal:// address, as the calendar app gives it.', link: null },
};

const w = (via, id, extra = {}) => ({ via, id, ...extra });
const SERVICES = [
  { id: 'google', label: 'Google', note: 'Google\'s CalDAV takes OAuth only, so calendars and contacts beyond the secret address go through OAuth.',
    ways: [w('ics', 'google-calendar', ICS.google), w('mail', 'google-mail', { provider: 'google' }), w('oauth', 'google')] },
  { id: 'icloud', label: 'Apple iCloud', note: 'Apple has no OAuth for iCloud data: a calendar link, an app-specific password for mail, and CalDAV/CardDAV are how iCloud connects.',
    ways: [w('ics', 'icloud-calendar', ICS.icloud), w('mail', 'icloud-mail', { provider: 'icloud' }), w('dav', 'icloud-dav', { provider: 'icloud' })] },
  { id: 'microsoft', label: 'Microsoft (Outlook.com, Microsoft 365)', note: 'Outlook.com stopped taking app passwords for mail on 16 September 2024: mail goes through OAuth.',
    link: 'https://support.microsoft.com/en-us/office/f4202ebf-89c6-4a8a-bec3-3d60cf7deaef', ways: [w('ics', 'microsoft-calendar', ICS.microsoft), w('oauth', 'microsoft')] },
  { id: 'fastmail', label: 'Fastmail', ways: [w('ics', 'fastmail-calendar', ICS.fastmail), w('mail', 'fastmail-mail', { provider: 'fastmail' }), w('dav', 'fastmail-dav', { provider: 'fastmail' })] },
  { id: 'nextcloud', label: 'Nextcloud', ways: [w('dav', 'nextcloud-dav', { provider: 'nextcloud' })] },
  { id: 'github', label: 'GitHub', ways: [w('key', null, { key: 'github' }), w('oauth', 'github')] },
  { id: 'notion', label: 'Notion', ways: [w('key', null, { key: 'notion' }), w('oauth', 'notion')] },
  { id: 'todoist', label: 'Todoist', ways: [w('key', null, { key: 'todoist' }), w('oauth', 'todoist')] },
  { id: 'linear', label: 'Linear', ways: [w('key', null, { key: 'linear' }), w('oauth', 'linear')] },
  { id: 'slack', label: 'Slack', ways: [w('key', null, { key: 'slack' }), w('oauth', 'slack')] },
  { id: 'dropbox', label: 'Dropbox', ways: [w('oauth', 'dropbox')] },
  { id: 'box', label: 'Box', ways: [w('oauth', 'box')] },
  { id: 'atlassian', label: 'Atlassian (Jira, Confluence)', note: 'Atlassian\'s API tokens are tied to one site and sent with your email as Basic auth, which a key for services does not do: OAuth is the way here.', ways: [w('oauth', 'atlassian')] },
  { id: 'zoom', label: 'Zoom', ways: [w('oauth', 'zoom')] },
  { id: 'spotify', label: 'Spotify', ways: [w('oauth', 'spotify')] },
  { id: 'discord', label: 'Discord', ways: [w('oauth', 'discord')] },
];

const WAY_LABEL = { ics: 'calendar', mail: 'mail', dav: 'calendars and contacts' };

/** The way a vault id is, or null for one a person added. */
function wayOf(id) {
  for (const s of SERVICES) for (const x of s.ways) if (x.id === id) return { service: s, way: x };
  return null;
}

/** What to call a connection in a tool's description: "Apple iCloud mail". */
function labelOf(id, rec) {
  const f = wayOf(id);
  if (f) return `${f.service.label} ${WAY_LABEL[f.way.via] || ''}`.trim();
  return rec?.label || null;
}

module.exports = { SERVICES, KEYS, ICS, wayOf, labelOf };
