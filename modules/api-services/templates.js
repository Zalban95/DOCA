'use strict';

/**
 * The shipped catalogue of API services: each an OpenAPI document in ./templates (`<id>.openapi.json`), checked against
 * the provider's own documentation on the day its `x-doca-checked` says, read in by the same importer as any other
 * document — so a template is only a document someone already verified, never code. Adding one is adding a file.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'templates');
const read = id => JSON.parse(fs.readFileSync(path.join(DIR, `${id}.openapi.json`), 'utf8'));

function list() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.openapi.json')); } catch { /* none shipped */ }
  return files.map(f => {
    const id = f.replace(/\.openapi\.json$/, ''), doc = read(id);
    return { id, title: doc.info?.title || id, note: doc.info?.summary || '', docs: doc.externalDocs?.url || '', checked: doc.info?.['x-doca-checked'] || '' };
  });
}

/** A template as a definition ready for the form: { definition, warnings }. */
function load(id) {
  if (!/^[a-z0-9-]{1,40}$/.test(String(id || '')) || !fs.existsSync(path.join(DIR, `${id}.openapi.json`)))
    throw Object.assign(new Error(`No template "${id}". There are: ${list().map(t => t.id).join(', ') || 'none'}.`), { status: 404 });
  const r = require('./openapi').fromDoc(read(id));
  return { ...r, definition: { ...r.definition, name: r.definition.name || id, source: `template:${id}` } };
}

module.exports = { list, load, DIR };
