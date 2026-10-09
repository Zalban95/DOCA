'use strict';

/**
 * The licence at a tool call (harness/tools.js call): a built-in tool of a feature this hive is not licensed for does
 * not exist here — the schemas never offered it, and a call by name (an old transcript, a recipe) is told so — and
 * while licensed features are read-only after a lapse, their tools that change something are refused with why.
 * Reading goes on. A connected account's tools are the connectors feature's; a computer's are the computers feature's.
 */
function featureOfTool(name) {
  const lic = require('./index');
  if (/^connector_/.test(name)) return require('../features').get('connectors');
  if (/^mcp__computer-/.test(name)) return require('../features').get('computers');
  const fs = require('../features').all().filter(f => f.tools.includes(name));
  return fs.find(f => lic.featureOn(f)) || fs[0] || null;
}

function refuse(name, args = {}) {
  const lic = require('./index');
  const f = featureOfTool(name);
  if (!f) return null;
  if (!lic.featureOn(f)) return `Error: there is no "${name}" tool in this hive: ${f.name} is not in its licence (Settings → System → Licence).`;
  if ((f.licence || 'core') === 'core') return null;
  const why = lic.readOnly();
  if (why && !require('../harness/tools').isRead(name, args) && !require('../harness/approval').FREE.has(name)) return `Error: not run — ${why}`;
  return null;
}

module.exports = { refuse, featureOfTool };
