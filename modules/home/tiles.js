'use strict';

/**
 * What the Home page draws of one Home Assistant entity: a tile. One copy for the hub and for a home node, so it is
 * kept beside doca-client (clients/node/home-shared.js) and read from there.
 */
const { DOMAINS, tileOf, hiddenByRegistry } = require('../../clients/node/home-shared');

module.exports = { DOMAINS, tileOf, hiddenByRegistry };
