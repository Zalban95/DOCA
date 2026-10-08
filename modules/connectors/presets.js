'use strict';

/**
 * Where each provider's mail, calendars and contacts are, for the ways that need no OAuth app (connectors/ways/):
 * IMAP and SMTP hosts and ports, CalDAV and CardDAV addresses, and where a person makes the app password. Read from
 * each provider's own help pages (2026-10-08); a person can change any field on the card, and "other" is blank.
 */
const MAIL = {
  google: { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecurity: 'tls',
    passwordAt: 'https://myaccount.google.com/apppasswords',
    note: 'An app password needs 2-Step Verification on the Google account; work or school accounts and Advanced Protection have none — use Google\'s OAuth below there. Gmail keeps a copy of what is sent in Sent itself.' },
  icloud: { imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecurity: 'starttls',
    passwordAt: 'https://account.apple.com (Sign-In and Security → App-Specific Passwords)',
    note: 'An app-specific password needs two-factor authentication on the Apple Account. Sign in with the iCloud address (if the mailbox refuses it, the part before the @).' },
  fastmail: { imapHost: 'imap.fastmail.com', imapPort: 993, smtpHost: 'smtp.fastmail.com', smtpPort: 465, smtpSecurity: 'tls',
    passwordAt: 'https://www.fastmail.help/hc/en-us/articles/360058752854',
    note: 'Sign in with the full Fastmail address and an app password — the account\'s own password is refused.' },
  other: { imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465, smtpSecurity: 'tls', passwordAt: 'your mail provider\'s security settings',
    note: 'Any mailbox that speaks IMAP and SMTP over TLS: the provider\'s help pages give the two server names.' },
};

const DAV = {
  icloud: { caldav: 'https://caldav.icloud.com/', carddav: 'https://contacts.icloud.com/', passwordAt: MAIL.icloud.passwordAt,
    note: 'Apple offers no OAuth for iCloud data: this, the calendar link and the mail app password are how iCloud connects. Sign in with the Apple Account\'s email.' },
  fastmail: { caldav: 'https://caldav.fastmail.com/', carddav: 'https://carddav.fastmail.com/', passwordAt: MAIL.fastmail.passwordAt,
    note: 'Sign in with the full Fastmail address and an app password with access to calendars and contacts.' },
  nextcloud: { caldav: 'https://YOUR-SERVER/remote.php/dav', carddav: 'https://YOUR-SERVER/remote.php/dav', passwordAt: 'your Nextcloud: Settings → Security → Devices & sessions → Create new app password',
    note: 'Put your server\'s address in both fields.' },
  other: { caldav: '', carddav: '', passwordAt: 'your provider\'s security settings', note: 'Any CalDAV and CardDAV server: its address, a user name and an app password.' },
};

module.exports = { MAIL, DAV };
