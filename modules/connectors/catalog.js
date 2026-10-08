'use strict';

/**
 * The services a connector can reach (TODO H9.3): where each one's OAuth 2.0 pages are, which API hosts its token
 * may call, and the scopes asked for unless the owner chooses others. Every connector uses the owner's own OAuth app
 * (client id and secret from that service's developer console): DOCA ships no app of its own, so no third party sits
 * between a hive and its accounts. `custom` is any other OAuth 2.0 service, its addresses typed in.
 *
 * Each entry was read from the service's own developer documentation (2026-10-08; links in the entry's `docs`), with
 * read-only scopes by default. Where a service differs from plain OAuth 2.0, the entry says how (oauth.js reads it):
 * `tokenAuth: 'basic'` sends the app's id and secret as HTTP Basic, `tokenBody: 'json'` posts the token request as
 * JSON, `scopeParam` names the parameter scopes go in (Slack's user scopes), `tokenPath` where the token is in the
 * answer (Slack's user token under authed_user), `whoamiMethod` POST for an RPC-style "who am I" (Dropbox),
 * `accountFromToken` the account's name when the token answer carries it (Notion), `headers` what every API call
 * sends (Notion-Version), and `hint` one sentence for the tool's description on how the API is laid out.
 */
const CATALOG = {
  github: {
    label: 'GitHub', authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token',
    api: ['https://api.github.com'], scopes: 'repo read:user', whoami: '/user', account: j => j.login,
    console: 'https://github.com/settings/developers (New OAuth App; the callback URL below) — or, simpler, a personal access token above',
    docs: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps',
  },
  google: {
    label: 'Google (Calendar, Gmail, Drive)', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    api: ['https://www.googleapis.com', 'https://gmail.googleapis.com'], whoami: 'https://www.googleapis.com/oauth2/v3/userinfo', account: j => j.email,
    scopes: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly',
    extra: { access_type: 'offline', prompt: 'consent' },   // a refresh token, so the connection outlives the hour
    console: 'https://console.cloud.google.com/apis/credentials (OAuth client ID, type Web application; the callback URL below as an authorised redirect URI)',
    docs: 'https://developers.google.com/identity/protocols/oauth2/web-server',
  },
  microsoft: {
    label: 'Microsoft 365 (Outlook, Calendar, OneDrive)', authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', api: ['https://graph.microsoft.com'], whoami: 'https://graph.microsoft.com/v1.0/me',
    account: j => j.userPrincipalName || j.mail, scopes: 'offline_access User.Read Mail.Read Calendars.Read Files.Read',
    console: 'https://entra.microsoft.com (App registrations → New; Web redirect URI: the callback URL below)',
    docs: 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow',
  },
  dropbox: {
    label: 'Dropbox', authorize: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token',
    api: ['https://api.dropboxapi.com', 'https://content.dropboxapi.com'], scopes: 'account_info.read files.metadata.read files.content.read',
    extra: { token_access_type: 'offline' }, whoami: 'https://api.dropboxapi.com/2/users/get_current_account', whoamiMethod: 'POST', account: j => j.email,
    hint: 'Its API is RPC-style: POST with a JSON body, e.g. POST /2/files/list_folder {"path": ""}; downloads are POST https://content.dropboxapi.com/2/files/download.',
    console: 'https://www.dropbox.com/developers/apps (Create app → Scoped access; Permissions: the scopes below; Settings → OAuth 2 → Redirect URIs: the callback URL below)',
    docs: 'https://docs.dropboxapi.com/dropbox-api/docs/oauth',
  },
  box: {
    label: 'Box', authorize: 'https://account.box.com/api/oauth2/authorize', token: 'https://api.box.com/oauth2/token',
    api: ['https://api.box.com', 'https://upload.box.com'], scopes: 'root_readonly', whoami: 'https://api.box.com/2.0/users/me', account: j => j.login,
    hint: 'Paths are under /2.0, e.g. GET /2.0/folders/0/items for the top folder.',
    console: 'https://app.box.com/developers/console (Create Platform App → User Authentication (OAuth 2.0); Redirect URI: the callback URL below)',
    docs: 'https://developer.box.com/guides/authentication/oauth2/without-sdk/',
  },
  notion: {
    label: 'Notion', authorize: 'https://api.notion.com/v1/oauth/authorize', token: 'https://api.notion.com/v1/oauth/token', tokenAuth: 'basic', tokenBody: 'json',
    api: ['https://api.notion.com'], scopes: '', extra: { owner: 'user' }, headers: { 'Notion-Version': '2026-03-11' }, accountFromToken: j => j.workspace_name,
    hint: 'Paths are under /v1, e.g. POST /v1/search {"query": "…"}; only the pages the person chose when connecting are reachable.',
    console: 'https://www.notion.so/developers (New integration → Public; Redirect URI: the callback URL below) — or, simpler, an internal integration\'s key above',
    docs: 'https://developers.notion.com/docs/authorization',
  },
  slack: {
    label: 'Slack', authorize: 'https://slack.com/oauth/v2/authorize', token: 'https://slack.com/api/oauth.v2.access', scopeParam: 'user_scope', tokenPath: 'authed_user',
    api: ['https://slack.com'], scopes: 'search:read channels:read channels:history users:read', whoami: 'https://slack.com/api/auth.test', account: j => j.user,
    hint: 'Methods are under /api, e.g. GET /api/search.messages?query=…; it acts as the person who connected (a user token).',
    console: 'https://api.slack.com/apps (Create New App → OAuth & Permissions: User Token Scopes, the scopes below; Redirect URLs: the callback URL below) — or, simpler, its User OAuth Token above',
    docs: 'https://docs.slack.dev/authentication/installing-with-oauth',
  },
  spotify: {
    label: 'Spotify', authorize: 'https://accounts.spotify.com/authorize', token: 'https://accounts.spotify.com/api/token',
    api: ['https://api.spotify.com'], scopes: 'user-read-private user-read-email playlist-read-private user-library-read user-read-playback-state user-read-recently-played',
    whoami: 'https://api.spotify.com/v1/me', account: j => j.display_name || j.id, hint: 'Paths are under /v1, e.g. GET /v1/me/player.',
    console: 'https://developer.spotify.com/dashboard (Create app; Redirect URI: the callback URL below — Spotify takes https, or a loopback address such as 127.0.0.1)',
    docs: 'https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow',
  },
  todoist: {
    label: 'Todoist', authorize: 'https://app.todoist.com/oauth/authorize', token: 'https://api.todoist.com/oauth/access_token',
    api: ['https://api.todoist.com'], scopes: 'data:read', hint: 'Paths are under /api/v1, e.g. GET /api/v1/tasks.',
    console: 'https://developer.todoist.com (App Management → Create a new app; OAuth redirect URL: the callback URL below) — or, simpler, the API token above',
    docs: 'https://developer.todoist.com/guides/#oauth',
  },
  linear: {
    label: 'Linear', authorize: 'https://linear.app/oauth/authorize', token: 'https://api.linear.app/oauth/token',
    api: ['https://api.linear.app'], scopes: 'read', hint: 'Its API is GraphQL: POST /graphql {"query": "{ viewer { name } }"}.',
    console: 'https://linear.app/settings/api/applications/new (Callback URL: the callback URL below) — or, simpler, a personal API key above',
    docs: 'https://linear.app/developers/oauth-2-0-authentication',
  },
  atlassian: {
    label: 'Atlassian (Jira, Confluence)', authorize: 'https://auth.atlassian.com/authorize', token: 'https://auth.atlassian.com/oauth/token',
    api: ['https://api.atlassian.com'], extra: { audience: 'api.atlassian.com', prompt: 'consent' }, whoami: 'https://api.atlassian.com/me', account: j => j.email,
    scopes: 'read:me read:jira-work read:jira-user read:confluence-content.all read:confluence-space.summary offline_access',
    hint: 'First GET /oauth/token/accessible-resources for the site\'s id, then /ex/jira/<id>/rest/api/3/… or /ex/confluence/<id>/wiki/rest/api/….',
    console: 'https://developer.atlassian.com/console/myapps/ (Create → OAuth 2.0 integration; Permissions: the scopes below; Authorization → Callback URL: the callback URL below)',
    docs: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/',
  },
  zoom: {
    label: 'Zoom', authorize: 'https://zoom.us/oauth/authorize', token: 'https://zoom.us/oauth/token', tokenAuth: 'basic',
    api: ['https://api.zoom.us'], scopes: 'user:read:user meeting:read:list_meetings', whoami: 'https://api.zoom.us/v2/users/me', account: j => j.email,
    hint: 'Paths are under /v2, e.g. GET /v2/users/me/meetings.',
    console: 'https://marketplace.zoom.us (Develop → Build App → General App, user-managed; Redirect URL: the callback URL below; the scopes below)',
    docs: 'https://developers.zoom.us/docs/integrations/oauth/',
  },
  discord: {
    label: 'Discord', authorize: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token',
    api: ['https://discord.com'], scopes: 'identify email guilds', whoami: 'https://discord.com/api/v10/users/@me', account: j => j.username,
    hint: 'Paths are under /api/v10, e.g. GET /api/v10/users/@me/guilds. A user\'s token reads who they are and their servers, not messages.',
    console: 'https://discord.com/developers/applications (New Application → OAuth2 → Redirects: the callback URL below)',
    docs: 'https://docs.discord.com/developers/topics/oauth2',
  },
  custom: { label: 'Another OAuth 2.0 service', custom: true, scopes: '', console: 'that service\'s developer settings' },
};

const ID = /^[a-z][a-z0-9-]{1,30}$/;

module.exports = { CATALOG, ID };
