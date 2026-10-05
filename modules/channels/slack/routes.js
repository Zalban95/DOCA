'use strict';

// Settings → Channels → Slack (../routes.js): the app-level token (Socket Mode) and the bot token.
const { mount: channel, secret, bad } = require('../routes');

const mount = app => channel(app, { name: 'slack', label: 'Slack', mod: require('./index'), settings(b, next) {
  if (typeof b.appToken === 'string' && b.appToken && b.appToken !== require('../../secrets-mask').MASK && !/^xapp-/.test(b.appToken.trim()))
    throw bad('The app-level token starts with xapp- (Basic Information → App-Level Tokens, scope connections:write).');
  if (typeof b.botToken === 'string' && b.botToken && b.botToken !== require('../../secrets-mask').MASK && !/^xoxb-/.test(b.botToken.trim()))
    throw bad('The bot token starts with xoxb- (OAuth & Permissions → Bot User OAuth Token).');
  secret(b, 'appToken', next);
  secret(b, 'botToken', next);
} });

module.exports = { mount };
