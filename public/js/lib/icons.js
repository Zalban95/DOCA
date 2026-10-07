/* ═══════════════════════════════════════════════════════
   One monochrome icon set (wave E, des 27): strokes in currentColor on a 16-unit grid, so the theme tints them and
   no colour emoji sits in the interface where an icon is meant. uiIcon('restart') → an <svg> string.
   Only paths written here: nothing is fetched, nothing comes from data.
   ═══════════════════════════════════════════════════════ */

const ICONS = {
  logs:    '<path d="M3 4h10M3 8h10M3 12h6"/>',
  restart: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3"/>',
  stop:    '<rect x="4" y="4" width="8" height="8" rx="1"/>',
  start:   '<path d="M5.5 3.5v9l7-4.5z"/>',
  more:    '<circle cx="3.5" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor"/>',
  close:   '<path d="M4 4l8 8M12 4l-8 8"/>',
  remove:  '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  edit:    '<path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z"/>',
  plus:    '<path d="M8 3v10M3 8h10"/>',
  search:  '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  solo:    '<rect x="2.5" y="4.5" width="9" height="9" rx="1"/><path d="M6 2.5h7.5V10"/>',
  phone:   '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/>',
  talk:    '<rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14"/>',
  attach:  '<path d="M10.5 4.5l-5 5a1.8 1.8 0 0 0 2.5 2.5l5.5-5.5a3 3 0 0 0-4.2-4.2L3.8 7.8"/>',
  send:    '<path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3"/>',
  up:      '<path d="M8 13V4M4 8l4-4 4 4"/>',
  collapse:'<path d="M4.5 3.5L8 6.5l3.5-3M4.5 12.5L8 9.5l3.5 3"/>',
  folder:  '<path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z"/>',
  file:    '<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/>',
  download:'<path d="M8 3v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>',
  upload:  '<path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13.5h10"/>',
  menu:    '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  trace:   '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  gear:    '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4L5 11M11 5l1.4-1.4"/>',
  warn:    '<path d="M8 2l6.5 11h-13z"/><path d="M8 6.5v3M8 11.5v.5"/>',
  check:   '<path d="M3.5 8.5l3 3 6-7"/>',
  // The page groups (nav-groups.js), drawn in Points' phone bar in place of their glyphs
  overview:'<circle cx="8" cy="8" r="1.6"/><circle cx="8" cy="8" r="5.6" stroke-opacity=".4"/>',
  agents:  '<circle cx="4.5" cy="8" r="1.6"/><circle cx="11.5" cy="4.5" r="1.6"/><circle cx="11.5" cy="11.5" r="1.6"/><path d="M6 7.3l4-2M6 8.7l4 2"/>',
  machine: '<rect x="2.5" y="3" width="11" height="8" rx="1.2"/><path d="M5.5 13.5h5"/>',
  terminal:'<path d="M3 5l3.5 3L3 11M8 11.5h5"/>',
  field:   '<path d="M8 2.5l5 5.5-5 5.5-5-5.5z"/>',
};
const NAV_GROUP_ICONS = { controls: 'overview', agents: 'agents', machines: 'machine', host: 'terminal', intelligence: 'field', settings: 'gear' };

/** An icon as markup; `label` makes it announced (otherwise it is decoration beside a label). */
function uiIcon(name, size = 16, label = '') {
  const body = ICONS[name] || ICONS.more;
  const aria = label ? `role="img" aria-label="${String(label).replace(/[<>&"]/g, '')}"` : 'aria-hidden="true"';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${aria}>${body}</svg>`;
}
