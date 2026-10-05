'use strict';

// Settings → Channels → Mail (../routes.js): the mailbox (IMAP and SMTP), its password, and whose word counts.
const { mount: channel, secret, bad } = require('../routes');

const HOST = /^[a-z0-9.-]{1,253}$/i;

const mount = app => channel(app, { name: 'mail', label: 'Mail', mod: require('./index'), settings(b, next) {
  for (const k of ['imapHost', 'smtpHost']) if (typeof b[k] === 'string') {
    if (b[k] && !HOST.test(b[k].trim())) throw bad(`${k} is a host name, like imap.gmail.com.`);
    next[k] = b[k].trim();
  }
  for (const k of ['imapPort', 'smtpPort']) if (b[k] !== undefined && b[k] !== '') {
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw bad(`${k} is a port number.`);
    next[k] = n;
  }
  for (const k of ['user', 'address', 'authservId']) if (typeof b[k] === 'string') next[k] = b[k].trim().slice(0, 200);
  if (typeof b.tls === 'boolean') next.tls = b.tls;
  secret(b, 'password', next);
} });

module.exports = { mount };
