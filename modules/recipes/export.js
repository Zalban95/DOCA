'use strict';

/**
 * A recipe outside DOCA (TODO H3.1 [IO], hive.md §9): its own JSON, which another hive imports as it is, and —
 * when every step is a shell command — a script that runs on its own: bash for Linux and macOS, PowerShell for
 * Windows, the parameters as arguments with their defaults. That script is also what an Agent Skills folder
 * keeps under scripts/. A recipe with other tools in it has no faithful script form, and says so.
 */
const shellOnly = r => r.steps.every(s => s.tool === 'shell' && typeof s.args?.command === 'string');

function bash(r) {
  const lines = ['#!/usr/bin/env bash', `# ${r.title} — a DOCA recipe, revision ${r.revision}`, ...(r.description ? r.description.split('\n').map(l => `# ${l}`) : []), 'set -euo pipefail', ''];
  r.params.forEach((p, i) => lines.push(`${p.name}="\${${i + 1}:-${String(p.default ?? '').replace(/["$`\\]/g, '\\$&')}}"${p.description ? `   # ${p.description}` : ''}`));
  if (r.params.length) lines.push('');
  for (const s of r.steps) {
    if (s.note) lines.push(`# ${s.note}`);
    lines.push(s.args.command.replace(/(["']?)\{([a-z0-9_]+)\}\1/gi, (m, _q, n) => (r.params.some(p => p.name === n) ? `"$${n}"` : m)));
  }
  return `${lines.join('\n')}\n`;
}

function powershell(r) {
  const lines = [`# ${r.title} — a DOCA recipe, revision ${r.revision}`, ...(r.description ? r.description.split('\n').map(l => `# ${l}`) : [])];
  if (r.params.length) lines.push(`param(${r.params.map(p => `[string]$${p.name} = '${String(p.default ?? '').replace(/'/g, "''")}'`).join(', ')})`);
  lines.push('$ErrorActionPreference = "Stop"', '');
  for (const s of r.steps) {
    if (s.note) lines.push(`# ${s.note}`);
    lines.push(s.args.command.replace(/(["']?)\{([a-z0-9_]+)\}\1/gi, (m, _q, n) => (r.params.some(p => p.name === n) ? `$${n}` : m)));
    lines.push('if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { exit $LASTEXITCODE }');
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** @returns {{ name, mime, body }} */
function exportAs(r, format = 'json') {
  if (format === 'json') return { name: `${r.id}.recipe.json`, mime: 'application/json', body: JSON.stringify({ doca: 'recipe', ...r }, null, 2) };
  if (!shellOnly(r)) throw Object.assign(new Error(`"${r.title}" uses ${[...new Set(r.steps.filter(s => s.tool !== 'shell').map(s => s.tool))].join(', ')}, which a script cannot do; export it as JSON.`), { status: 409 });
  if (format === 'bash') return { name: `${r.id}.sh`, mime: 'text/x-shellscript', body: bash(r) };
  if (format === 'powershell') return { name: `${r.id}.ps1`, mime: 'text/plain', body: powershell(r) };
  throw Object.assign(new Error('format is json, bash or powershell'), { status: 400 });
}

module.exports = { exportAs, shellOnly };
