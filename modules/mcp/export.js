'use strict';

/**
 * Hand the MCP servers defined here to the other agents on this machine.
 *
 * Every target below keeps the same `mcpServers` shape, so exporting is a
 * read-modify-write of one key: everything else in the file is left exactly as
 * it was, and `writeFileSafe` leaves a `.bak` next to it. Codex is the exception
 * — its config is TOML, and blindly rewriting TOML would lose comments and
 * formatting, so that one is handed back as a snippet to paste.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { writeFileSafe } = require('../utils');
const registry = require('./registry');

const HOME = os.homedir();

const TARGETS = {
  cursor: {
    label: 'Cursor',
    file:  path.join(HOME, '.cursor', 'mcp.json'),
    kind:  'json',
  },
  claude: {
    label: 'Claude Code',
    file:  path.join(HOME, '.claude.json'),
    kind:  'json',
  },
  project: {
    label: 'Project .mcp.json',
    file:  path.join(process.env.WORKSPACE_DIR || HOME, '.mcp.json'),
    kind:  'json',
  },
  codex: {
    label: 'Codex CLI',
    file:  path.join(HOME, '.codex', 'config.toml'),
    kind:  'toml',
  },
};

/** What a server looks like in every one of these files. */
function entry(spec) {
  return spec.transport === 'http'
    ? { url: spec.url, ...(Object.keys(spec.headers || {}).length ? { headers: spec.headers } : {}) }
    : {
        command: spec.command,
        ...(spec.args?.length ? { args: spec.args } : {}),
        ...(Object.keys(spec.env || {}).length ? { env: spec.env } : {}),
      };
}

/** TOML for the servers, since Codex's config is not JSON. */
function toToml(specs) {
  const str = v => JSON.stringify(String(v));
  return specs.map(s => {
    const lines = [`[mcp_servers.${s.id}]`];
    if (s.transport === 'http') lines.push(`url = ${str(s.url)}`);
    else {
      lines.push(`command = ${str(s.command)}`);
      if (s.args?.length) lines.push(`args = [${s.args.map(str).join(', ')}]`);
      if (Object.keys(s.env || {}).length)
        lines.push(`env = { ${Object.entries(s.env).map(([k, v]) => `${k} = ${str(v)}`).join(', ')} }`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

function describeTargets() {
  return Object.entries(TARGETS).map(([id, t]) => ({
    id, label: t.label, file: t.file, kind: t.kind, exists: fs.existsSync(t.file),
  }));
}

/**
 * Write the chosen servers into one target.
 * @param {string} target
 * @param {string[]} [ids] which servers; all of them when omitted
 */
async function write(target, ids) {
  const t = TARGETS[target];
  if (!t) throw Object.assign(new Error(`Unknown export target "${target}"`), { status: 400 });

  const all   = registry.load();
  const specs = ids?.length ? all.filter(s => ids.includes(s.id)) : all;
  if (!specs.length) throw Object.assign(new Error('No MCP servers to export'), { status: 400 });

  if (t.kind === 'toml') {
    return {
      ok: false, target, file: t.file, manual: true, snippet: toToml(specs),
      message: `${t.label} uses TOML. Add this to ${t.file} yourself — rewriting it here would lose your comments.`,
    };
  }

  let existing = {};
  if (fs.existsSync(t.file)) {
    try { existing = JSON.parse(fs.readFileSync(t.file, 'utf8')) || {}; }
    catch (e) {
      // Overwriting a file we cannot parse would throw away whatever else is in
      // it, which for ~/.claude.json is the user's whole configuration.
      throw Object.assign(new Error(`${t.file} is not valid JSON (${e.message}) — fix or move it first`), { status: 409 });
    }
  }

  const merged = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers || {}),
      ...Object.fromEntries(specs.map(s => [s.id, entry(s)])),
    },
  };
  writeFileSafe(t.file, `${JSON.stringify(merged, null, 2)}\n`);

  return {
    ok: true, target, file: t.file, count: specs.length,
    message: `Wrote ${specs.length} server${specs.length === 1 ? '' : 's'} to ${t.file}`,
  };
}

module.exports = { TARGETS, describeTargets, write, entry, toToml };
