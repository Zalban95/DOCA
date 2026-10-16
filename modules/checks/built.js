'use strict';

/**
 * Built from the current values (checks/, `{built: "project.params.json"}`; parametric projects): holds when the hub's
 * stamp beside the parameters (project.build.json, params/stamp.js) says the last build used exactly the values in the
 * file now, every check of it held, and every file it made is still as it left it. A plan's last step can then say
 * "the deliverables are built from the current values" and mean it mechanically.
 */
const path = require('path');

function normalize(c) { return { built: String(c.built).slice(0, 500) }; }

async function check(c, abs) {
  if (path.basename(abs) !== require('../params/file').NAME) return { ok: false, why: `name the project's ${require('../params/file').NAME}` };
  return require('../params/stamp').builtNow(path.dirname(abs));
}

module.exports = { normalize, check };
