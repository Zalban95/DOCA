'use strict';

/**
 * The Craft App Suite (ArtCraft; asked 2026-10-12: "an amazing kit … just suggested, any user or company can choose
 * their own favorite"): twelve open-source creative desktop apps written in Rust (Apache-2.0, github.com/storytold),
 * each built on a registry of hundreds of commands that its UI, its CLI and its MCP server all call — so an agent can
 * do whatever a person clicks. Each is a catalogue row here: `<app>-cli mcp`, a stdio MCP server (headless, in-process),
 * found where the app's own release puts its CLI — on PATH (Linux packages, the macOS CLI zip), else its default
 * Windows folder (not on PATH). Off until a person adds it; skills/craft-apps says which app for what and how to drive one.
 */
const fs = require('fs');
const path = require('path');

const APPS = [
  ['photocraft', 'PhotoCraft', 'image editing: layers, masks, type, filters, real PSD files'],
  ['vectorcraft', 'VectorCraft', 'vector illustration: paths, shapes, SVG'],
  ['filmcraft', 'FilmCraft', 'video editing: cut, trim, grade, mix and export'],
  ['lightcraft', 'LightCraft', 'a photo library and raw development'],
  ['pdfcraft', 'PdfCraft', 'PDFs: read, organise, combine, split, protect'],
  ['effectcraft', 'EffectCraft', 'motion graphics and visual effects'],
  ['designcraft', 'DesignCraft', 'page layout and publishing: frames, text, styles, images'],
  ['wordcraft', 'WordCraft', 'word processing and documents'],
  ['soundcraft', 'SoundCraft', 'audio recording and editing'],
  ['deckcraft', 'DeckCraft', 'presentations and slide decks'],
  ['cadcraft', 'CADCraft', 'computer-aided design and drafting'],
  ['gridcraft', 'GridCraft', 'spreadsheets and data'],
];

/** Where this app's CLI is: installed from the panel (craft-install.js), on PATH, else the Windows installer's default folder; null when absent. */
function cliOf(id, label) {
  const mine = require('./craft-install').installedCli(id);
  if (mine) return mine;
  const { which } = require('../shell');
  const onPath = which(`${id}-cli`);
  if (onPath) return onPath;
  if (process.platform === 'win32') {
    const p = path.join(process.env.ProgramFiles || 'C:\\Program Files', label, `${id}-cli.exe`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const ROWS = APPS.map(([id, label, what]) => ({
  id, label: `${label} — ${what}`, kit: 'Craft App Suite',
  about: `${label} from the Craft App Suite (ArtCraft, open source, Apache-2.0): ${what}. Its MCP server (${id}-cli mcp) drives the `
    + 'same commands as its menus, headless; skills/craft-apps says how. Install the app with the ArtCraft Launcher '
    + '(getartcraft.com/download) or its own release on GitHub (storytold/' + id + '): the CLI comes with it.',
  get command() { return cliOf(id, label) || `${id}-cli`; },
  args: ['mcp'],
  needs: [],
  present: () => !!cliOf(id, label),
  installable: true,   // the panel installs it itself (craft-install.js)
  missingWhat: `${id}-cli (install ${label})`,
}));

module.exports = { ROWS, APPS, cliOf };
