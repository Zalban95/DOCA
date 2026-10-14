/* ═══════════════════════════════════════════════════════
   Settings → General → Appearance: the experience, beside the look and its colours (flow/flow.js;
   docs/design/flow-experience.md). Standard is the panel as always; Flow (experimental) warms the pages when it
   opens, moves between them and draws the groups on a side rail. Saved as this screen's `experience`; Flow's own
   options sit folded under Advanced. "Use Flow's suggested groups" writes the person's own layout through the
   panel layout route (undoable there and in Your panel) — never on its own.
   ═══════════════════════════════════════════════════════ */

const EXPERIENCES = {
  standard: { label: 'Standard', note: 'The panel as it always was' },
  flow: { label: 'Flow · experimental', note: 'Pages ready at the start, a short movement between them, groups on a side rail' },
};

/** The groups Flow suggests, by the ids the panel keeps (people's saved layouts use them); every page kept. */
const FLOW_SUGGESTED_GROUPS = [
  { id: 'controls', label: 'Home', tabs: ['controls', 'ambient', 'home', 'meetings', 'people'] },
  { id: 'agents', tabs: ['harness', 'workstream', 'teams', 'chronicle', 'archive'] },
  { id: 'machines', tabs: ['live', 'computers', 'nearby', 'vms', 'docker', 'vnc', 'map'] },
  { id: 'host', tabs: ['files', 'projects', 'logs', 'admin', 'terminal'] },
  { id: 'intelligence', tabs: ['models', 'mcp', 'connectors', 'apikeys'] },
];

/** The steps that make them, for the pages this screen has (panel-layout/ops.js: move, then a group's name). */
function flowSuggestedOps(have = NAV_TABS) {
  const ops = [];
  for (const g of FLOW_SUGGESTED_GROUPS) g.tabs.filter(t => have.includes(t)).forEach((page, index) => ops.push({ op: 'move', page, group: g.id, index }));
  for (const g of FLOW_SUGGESTED_GROUPS) if (g.label) ops.push({ op: 'rename', group: g.id, label: g.label });
  return ops;
}

const _expSel = (id, key, choices, value, label, info) => `<label class="input-label" for="${id}" data-info="${escHtml(info)}">${label}</label>
  <select class="input" id="${id}" data-default="${FLOW_DEFAULTS[key]}" onchange="experienceSave({ ${key}: this.value })">
    ${Object.entries(choices).map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`;

function experienceCardRender(prefs) {
  const anchor = document.getElementById('theme-status');
  if (!anchor) return;
  let box = document.getElementById('experience-picker');
  if (!box) { box = Object.assign(document.createElement('div'), { id: 'experience-picker', className: 'experience-picker' }); anchor.before(box); }
  const e = flowNormalize(prefs?.experience !== undefined ? prefs.experience : flowGet());
  const options = `<div class="form-row">${_expSel('flow-warm', 'warm', { all: 'Every page I can open', used: 'The pages I use most here' }, e.warm, 'Warm at start', 'Which pages Flow gets ready when the panel opens, so they show at once: every page you can open, or only the ones you open most on this screen. Pages that watch something live are never warmed. Default: every page.')}</div>
    <div class="form-row">${_expSel('flow-motion', 'motion', { gentle: 'Gentle — 220 ms', quick: 'Quick — 120 ms', none: 'None' }, e.motion, 'Motion', 'How pages move when you change page: gentle (220 ms), quick (120 ms) or none. A screen set to reduce motion never moves. Default: gentle.')}</div>
    <div class="form-row">${_expSel('flow-groups', 'groups', { rail: 'Side rail', top: 'Top groups, as in Standard' }, e.groups, 'Group layout', 'Where the groups of pages are: a rail on the left side, or across the top as in Standard. On a phone they are always the bar at the bottom. Default: side rail.')}</div>
    <div class="form-row"><button type="button" class="btn btn-xs" onclick="experienceSuggested()">Use Flow's suggested groups</button>
      <button type="button" class="btn btn-xs" onclick="experienceSuggestedUndo()">Undo</button>
      ${infoBtn('Regroups your pages as Home, Agents, Machines, Hub and Field, every page kept. It changes your own layout, on every device of yours; Undo here or in Your panel puts it back.')}</div>
    <span class="status-line" id="experience-status"></span>`;
  box.innerHTML = `<div class="input-label" data-info="Flow changes how the panel opens and moves, not what it does: pages ready at the start, a short movement between them, the groups on a side rail. Switching back is one click, and each screen chooses for itself. Default: Standard.">Experience</div><div class="look-tiles">${Object.entries(EXPERIENCES).map(([id, x]) => `
    <button type="button" class="theme-swatch look-tile experience-tile${id === e.mode ? ' active' : ''}" data-experience="${id}" onclick="experienceSave({ mode: '${id}' })">
      <span class="look-tile-text"><span class="theme-swatch-label">${escHtml(x.label)}</span><span class="look-tile-note">${escHtml(x.note)}</span></span>
    </button>`).join('')}</div>
    ${e.mode === 'flow' ? advancedFold(options, { label: 'Flow\'s options', id: 'flow-options' }) : ''}`;
}

async function experienceSave(patch) {
  const next = flowNormalize({ ...flowGet(), ...patch });
  flowApply(next);
  experienceCardRender({ experience: next });
  try {
    await screenSave({ experience: next });
    setStatus(document.getElementById('theme-status'), `✓ ${EXPERIENCES[next.mode].label}`, 'ok');
  } catch (err) {
    setStatus(document.getElementById('theme-status'), `✗ ${err.message}`, 'err');
  }
}

async function _experienceLayout(url, body) {
  const status = document.getElementById('experience-status');
  try {
    const r = await apiFetch(url, { method: 'POST', body });
    if (typeof panelLayoutLoad === 'function') await panelLayoutLoad();
    if (typeof settingsHiddenApply === 'function') settingsHiddenApply();
    setStatus(status, r.said?.length ? '✓ Your groups are Flow\'s now' : '✓ Put back', 'ok');
  } catch (err) { setStatus(status, `✗ ${err.message}`, 'err'); }
}

const experienceSuggested = () => _experienceLayout('/api/screen/layout', { scope: 'person', ops: flowSuggestedOps() });
const experienceSuggestedUndo = () => _experienceLayout('/api/screen/layout/undo', { scope: 'person' });
