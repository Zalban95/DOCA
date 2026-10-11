/* Organized: the common few, the rest under Advanced (asked 2026-10-08). The forms written in index.html — which is at
   its line ceiling — are folded here once the page is there, by moving their own elements into advancedFold
   (js/lib/ui-parts.js): every field keeps its id, its place in the form and its handlers; only what is shown at first
   changes. Each field folded gets the default it is marked against. Forms drawn by a script fold themselves. */
const STATIC_FOLDS = [
  // Field → MCP, adding a server: name, transport and the command or address are the common few.
  { id: 'mcp-form-stdio', label: 'Advanced — environment, working folder', fields: ['mcp-env', 'mcp-cwd'] },
  { id: 'mcp-form-http', label: 'Advanced — headers', fields: ['mcp-headers'] },
  // Field → Models: the address is the common one; folders only move where things are kept or measured.
  { id: 'models-ollama', label: 'Advanced — models folder', fields: ['models-ollama-path'], grid: true },
  { id: 'models-hf', label: 'Advanced — download folder', fields: ['hf-cache-dir'], grid: true },
  { id: 'models-nlm', label: 'Advanced — address, config file', fields: ['nlm-apiurl', 'nlm-config-path'], grid: true },
];

/** In a label | field grid (.models-settings-grid) a field is its cell and the label before it: both move, into a grid
 *  of their own inside the fold, so they still line up. */
function _staticFoldGridParts(fields) {
  const grid = fields[0].closest('.models-settings-grid');
  if (!grid) return fields;
  const inner = Object.assign(document.createElement('div'), { className: 'models-settings-grid' });
  const cells = fields.map(el => { let c = el; while (c.parentElement !== grid) c = c.parentElement; return c; });
  grid.append(inner);   // at the end, under the common ones
  for (const c of cells) inner.append(c.previousElementSibling, c);
  return [inner];
}

function staticFoldsApply() {
  for (const f of STATIC_FOLDS) {
    const fields = f.fields.map(id => document.getElementById(id)).filter(Boolean);
    if (!fields.length || fields[0].closest('details.adv-fold')) continue;
    for (const el of fields) if (el.dataset.default === undefined) el.dataset.default = '';
    advancedFold(f.grid ? _staticFoldGridParts(fields) : fields.map(el => el.closest('.field') || el), { id: f.id, label: f.label, count: f.grid ? fields.length : null });
  }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', staticFoldsApply);
