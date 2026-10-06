'use strict';

/**
 * What DOCA uses for each of its functions that the model scout compares the world against (docs/experiments/
 * model-scout.md): the rows of model-roles.js marked `scout`, each with the Hugging Face task a replacement would be
 * listed under. The whole list — fallbacks, assistant mode, specialists, the wake word — is model-roles.js.
 */
function roles() {
  return require('../model-roles').roles().filter(r => r.scout).map(({ scout, setting, ...r }) => r);
}

module.exports = { roles };
