'use strict';

/**
 * The services a connector can reach (TODO H9.3): where each one's OAuth 2.0 pages are, which API hosts its token
 * may call, and the scopes asked for unless the owner chooses others. Every connector uses the owner's own OAuth app
 * (client id and secret from that service's developer console): DOCA ships no app of its own, so no third party sits
 * between a hive and its accounts. `custom` is any other OAuth 2.0 service, its addresses typed in.
 */
const CATALOG = {
  github: {
    label: 'GitHub', authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token',
    api: ['https://api.github.com'], scopes: 'repo read:user', whoami: '/user', account: j => j.login,
    console: 'https://github.com/settings/developers (New OAuth App; the callback URL below)',
  },
  google: {
    label: 'Google (Calendar, Gmail, Drive)', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    api: ['https://www.googleapis.com', 'https://gmail.googleapis.com'], whoami: 'https://www.googleapis.com/oauth2/v3/userinfo', account: j => j.email,
    scopes: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly',
    extra: { access_type: 'offline', prompt: 'consent' },   // a refresh token, so the connection outlives the hour
    console: 'https://console.cloud.google.com/apis/credentials (OAuth client ID, type Web application; the callback URL below as an authorised redirect URI)',
  },
  microsoft: {
    label: 'Microsoft 365 (Outlook, Calendar, OneDrive)', authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', api: ['https://graph.microsoft.com'], whoami: 'https://graph.microsoft.com/v1.0/me',
    account: j => j.userPrincipalName || j.mail, scopes: 'offline_access User.Read Mail.Read Calendars.Read Files.Read',
    console: 'https://entra.microsoft.com (App registrations → New; Web redirect URI: the callback URL below)',
  },
  custom: { label: 'Another OAuth 2.0 service', custom: true, scopes: '', console: 'that service\'s developer settings' },
};

const ID = /^[a-z][a-z0-9-]{1,30}$/;

module.exports = { CATALOG, ID };
