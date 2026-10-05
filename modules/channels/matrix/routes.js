'use strict';

// Settings → Channels → Matrix (../routes.js): the homeserver and the bot account's access token.
const { mount: channel, secret, bad } = require('../routes');

const mount = app => channel(app, { name: 'matrix', label: 'Matrix', mod: require('./index'), settings(b, next) {
  if (typeof b.homeserver === 'string') {
    const hs = b.homeserver.trim().replace(/\/+$/, '');
    if (hs && !/^https?:\/\/[^\s/]+/.test(hs)) throw bad('The homeserver is an address like https://matrix.example.org.');
    next.homeserver = hs;
  }
  secret(b, 'accessToken', next);
} });

module.exports = { mount };
