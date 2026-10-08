/* Organized: the common few, the rest under Advanced (asked 2026-10-08). The forms written in index.html — which is at
   its line ceiling — are folded here once the page is there, by moving their own elements into advancedFold
   (js/lib/ui-parts.js): every field keeps its id, its place in the form and its handlers; only what is shown at first
   changes. Each field folded gets the default it is marked against. Forms drawn by a script fold themselves. */
const STATIC_FOLDS = [
  // Field → MCP, adding a server: name, transport and the command or address are the common few.
  { id: 'mcp-form-stdio', label: 'Advanced — environment, working folder', fields: ['mcp-env', 'mcp-cwd'] },
  { id: 'mcp-form-http', label: 'Advanced — headers', fields: ['mcp-headers'] },
];

function staticFoldsApply() {
  for (const f of STATIC_FOLDS) {
    const fields = f.fields.map(id => document.getElementById(id)).filter(Boolean);
    if (!fields.length || fields[0].closest('details.adv-fold')) continue;
    for (const el of fields) if (el.dataset.default === undefined) el.dataset.default = '';
    advancedFold(fields.map(el => el.closest('.field') || el), { id: f.id, label: f.label });
  }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', staticFoldsApply);
