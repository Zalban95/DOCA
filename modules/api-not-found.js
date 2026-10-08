'use strict';

/**
 * The end of /api: a path no route answered is the panel's JSON 404.
 *
 * The gate answers 404 for a path nothing is mounted at; a path under a mounted prefix with no route of its own
 * (GET /api/harness/agents/x) fell through to Express's HTML "Cannot GET" (self-test round two, C12). Registered last
 * in createApp(), and at the root rather than at /api, so the gate's `routed()` does not count it as a route for every
 * /api path — which would turn its 404 into `no_rule`.
 */
module.exports = function apiNotFound(req, res, next) {
  if (!/^\/api(\/|$)/i.test(req.path)) return next();
  res.status(404).json({ code: 'not_found', error: `There is no ${req.method} ${req.path} in this panel.` });
};
