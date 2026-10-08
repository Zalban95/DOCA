'use strict';

/**
 * API services in a pack (api-services/): each `services/<name>.openapi.json`, the OpenAPI 3.1 document the service
 * exports — so any OpenAPI tool reads it — and never its key, which `needs.secrets` lists as `service.<name>.key` for
 * whoever brings it in to paste. Brought in, a service is saved without a key ("its key is not pasted yet") through the
 * store's own checks: a key already here under that name keeps it only for its own address.
 */
const RE = /^services\/([a-z0-9][a-z0-9-]{0,39})\.openapi\.json$/;

function part(names = []) {
  const files = [], contents = [], secrets = [];
  for (const name of names) {
    const def = require('../api-services/store').get(name);
    if (!def) throw Object.assign(new Error(`No API service "${name}".`), { status: 404 });
    files.push({ name: `services/${def.name}.openapi.json`, data: `${JSON.stringify(require('../api-services/openapi').toDoc(def), null, 2)}\n` });
    contents.push({ kind: 'service', id: def.name, path: `services/${def.name}.openapi.json` });
    if (def.auth.type !== 'none') secrets.push(`service.${def.name}.key`);
  }
  return { files, contents, secrets };
}

const isFile = name => RE.test(name);
const item = (name, text) => ({ kind: 'service', id: RE.exec(name)[1], data: JSON.parse(text), path: name });
const exists = it => !!require('../api-services/store').get(it.id);
const view = it => ({ server: it.data.servers?.[0]?.url || null, actions: Object.values(it.data.paths || {}).reduce((n, p) => n + Object.keys(p).length, 0) });

function apply(it) {
  const { definition } = require('../api-services/openapi').fromDoc(it.data);
  const saved = require('../api-services/store').save({ ...definition, name: it.id, source: 'pack' });
  return saved.needsKey ? 'added; paste its key in Field → Connectors → API services' : 'added';
}

module.exports = { part, isFile, item, exists, view, apply };
