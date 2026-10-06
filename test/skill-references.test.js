'use strict';

/**
 * A shipped skill names only what exists (audit 2026-10-06, aw 23; TODO B4): tools, kits, System tools rows and the
 * tools devices lend. A skill is instructions a weaker model follows to the letter — a name that is not there is a
 * dead end it cannot see coming.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const skills = fs.readdirSync(path.join(ROOT, 'skills'))
  .map(d => ({ id: d, file: path.join(ROOT, 'skills', d, 'SKILL.md') })).filter(s => fs.existsSync(s.file))
  .map(s => ({ ...s, text: fs.readFileSync(s.file, 'utf8') }));

// What devices lend as MCP tools: doca-client (clients/node), and DocaDesk and DocaMobile (their own repositories,
// PROTOCOL §22.1). A name a skill uses for a device's tool must be one of these.
const DEVICE_TOOLS = new Set([
  ...[...fs.readdirSync(path.join(ROOT, 'clients/node')).filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(ROOT, 'clients/node', f), 'utf8')).join('\n').matchAll(/\b((?:files|screen|shell|processes|apps|device)_[a-z_]+)\b/g)].map(m => m[1]),
  'shell', 'shell_job', 'screen_capture', 'screen_windows', 'input_click', 'input_type', 'input_keys', 'input_move',   // DocaDesk
  'processes_start', 'screen_read', 'screen_press', 'media_control', 'apps_open',                                     // DocaMobile
]);
// A web API's own field names, which a skill quotes from that API's documentation.
const API_FIELDS = { hi3d: ['request_type', 'cover_url'] };

test('every snake_case name a skill puts in backticks is a tool, a device\'s tool or an API field it documents', () => {
  const tools = new Set(require('../modules/harness/tools').TOOLS.map(t => t.name));
  const bad = [];
  for (const s of skills)
    for (const m of s.text.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g))
      if (!tools.has(m[1]) && !DEVICE_TOOLS.has(m[1]) && !(API_FIELDS[s.id] || []).includes(m[1])) bad.push(`${s.id}: ${m[1]}`);
  assert.deepEqual(bad, []);
});

test('kits a skill lists are kits; System tools rows it proposes are rows', () => {
  const { KITS } = require('../modules/harness/kits');
  const rows = new Set(require('../modules/system-tools-catalog').SYSTEM_TOOLS.map(r => r.id));
  const bad = [];
  for (const s of skills) {
    for (const m of s.text.matchAll(/kits: \[([^\]]*)\]/g))
      for (const k of m[1].split(',').map(x => x.trim()).filter(Boolean)) if (!KITS[k]) bad.push(`${s.id}: kit ${k}`);
    for (const line of s.text.split('\n').filter(l => /install_propose \{kind: "tool"\}|System tools/.test(l)))
      for (const m of line.matchAll(/`([a-z][a-z0-9-]*)`/g)) if (/^(jdk|android|catt|ffmpeg|tesseract|uv|ollama)/.test(m[1]) && !rows.has(m[1])) bad.push(`${s.id}: row ${m[1]}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(rows.has('catt'), 'play-and-cast casts with catt');
});
