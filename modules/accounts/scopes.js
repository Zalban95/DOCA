'use strict';

/**
 * What a person's own account asks its service for (the owner, 2026-10-12: "YES to the wider scopes … offered as the
 * default for the everyday accounts, with a read-only option kept"). `full` lets the assistant change the calendar,
 * file mail and send what the person decided to send; `read` only reads. Which one an account holds is said beside it
 * in Field → Connectors → Your accounts, and a tool asking for more than it holds is told so in a sentence.
 *
 * The hub's own connectors (connectors/catalog.js) keep their read-only defaults: those are the owner's accounts for
 * the whole hive, a different thing.
 */
const PROVIDERS = {
  google: {
    label: 'Google',
    full: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
    read: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly',
  },
  microsoft: {
    label: 'Microsoft 365',
    full: 'offline_access User.Read Calendars.ReadWrite Mail.ReadWrite Mail.Send',
    read: 'offline_access User.Read Calendars.Read Mail.Read',
  },
};

const ACCESS = ['full', 'read'];

/** The scopes to ask for. */
function of(provider, access = 'full') {
  const p = PROVIDERS[provider];
  if (!p) throw Object.assign(new Error('provider is google or microsoft.'), { status: 400 });
  return p[ACCESS.includes(access) ? access : 'full'];
}

/**
 * What a connected account may do, read from the scopes the service granted (it may grant fewer than asked):
 * { calendarWrite, mailModify, mailSend }.
 */
function can(rec) {
  const s = ` ${String(rec?.scopes || of(rec?.provider || 'google', rec?.access)).replace(/,/g, ' ')} `;
  if (rec?.provider === 'microsoft') {
    return { calendarWrite: / Calendars\.ReadWrite /i.test(s), mailModify: / Mail\.ReadWrite /i.test(s), mailSend: / Mail\.Send /i.test(s) };
  }
  return { calendarWrite: /\/auth\/calendar(\.events)? /.test(s), mailModify: /\/auth\/gmail\.modify |mail\.google\.com\/ /.test(s),
    mailSend: /\/auth\/gmail\.(send|modify|compose) |mail\.google\.com\/ /.test(s) };
}

module.exports = { PROVIDERS, ACCESS, of, can };
