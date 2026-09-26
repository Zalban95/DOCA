'use strict';

/**
 * The harness's route groups that mount themselves, so server.js carries one
 * line for all of them rather than one per group.
 */
function mount(app) {
  require('./rules-routes').mount(app);       // the memory rules: read, write, review, answer, undo
  require('./questions-routes').mount(app);   // questions the agent is waiting on the owner for
  require('../canvas/routes').mount(app);     // canvases: where to open one (never the page itself)
}

module.exports = { mount };
