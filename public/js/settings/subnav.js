/* ═══════════════════════════════════════════════════════
   Settings → the sub-navigation, and the Harness sub-tab.
   ═══════════════════════════════════════════════════════ */

// DOCA's own settings first; OpenClaw's after them, in a group of their own that
// is drawn only when OpenClaw is installed — so it is never unclear whose they
// are (decided 2026-09-25). Skills are OpenClaw's today: clawhub skills in
// ~/.openclaw/workspace/skills; the harness has none of its own yet.
const _SETTINGS_SUBTABS = [
  { id: 'general',   label: 'General',   init: '_subtabGeneralInit' },
  { id: 'keys',      label: 'API Keys',  init: 'loadKeys' },
  { id: 'backups',   label: 'Backups',   init: 'backupsLoad' },
  { id: 'harness',   label: 'Harness',   init: '_settingsHarnessRender' },
  { id: 'voice',     label: 'Voice',     init: '_subtabVoiceInit' },
  { id: 'system',    label: 'System',    init: '_subtabSystemInit' },
  { id: 'skills',    label: 'Skills',    init: 'loadSkills',    group: 'openclaw' },
  { id: 'snapshots', label: 'Snapshots', init: 'loadSnapshots', group: 'openclaw' },
  { id: 'setup',     label: 'Setup',     init: 'loadScripts',   group: 'openclaw' },
  { id: 'config',    label: 'Config',    init: 'initConfig',    group: 'openclaw' },
];

let _settingsActiveSubtab = 'general';
let _subtabInited = {};
let _openclawInstalled = false;

async function settingsInit() {
  try {
    const { harnesses = [] } = await apiFetch('/api/harness');
    _openclawInstalled = !!harnesses.find(h => h.id === 'openclaw')?.detected;
  } catch { /* shown without OpenClaw's group; nothing of DOCA's depends on it */ }
  _settingsSubnavRender();
  const entry = _SETTINGS_SUBTABS.find(t => t.id === _settingsActiveSubtab);
  settingsSubNav(entry && (!entry.group || _openclawInstalled) ? entry.id : 'general');
}

function _settingsSubnavRender() {
  const nav = document.getElementById('settings-subnav');
  if (!nav) return;
  const pill = t => `<button class="settings-subnav-btn" data-subtab="${t.id}" onclick="settingsSubNav('${t.id}')">${t.label}</button>`;
  const own = _SETTINGS_SUBTABS.filter(t => !t.group);
  const oc  = _SETTINGS_SUBTABS.filter(t => t.group === 'openclaw');
  nav.innerHTML = own.map(pill).join('')
    + (_openclawInstalled ? `<span class="settings-subnav-group" title="OpenClaw's own settings, not DOCA's">OpenClaw</span>${oc.map(pill).join('')}` : '');
}

function settingsSubNav(panelId) {
  _settingsActiveSubtab = panelId;

  document.querySelectorAll('#settings-subnav .settings-subnav-btn').forEach(btn => {
    const active = btn.dataset.subtab === panelId;
    btn.classList.toggle('active', active);
    // Keep the active pill visible when the sub-nav scrolls horizontally (mobile)
    if (active && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });

  document.querySelectorAll('#tab-settings .settings-panel').forEach(p => {
    p.classList.toggle('active', p.id === `sp-${panelId}`);
  });

  const entry = _SETTINGS_SUBTABS.find(t => t.id === panelId);
  if (entry?.init && !_subtabInited[panelId]) {
    _subtabInited[panelId] = true;
    const fn = window[entry.init];
    if (typeof fn === 'function') fn();
  }
}

/* ── Harness: the built-in agent's own settings, each opened where it is edited ── */

function _settingsHarnessRender() {
  const panel = document.getElementById('sp-harness');
  if (!panel) return;
  const row = (btn, what) => `<div class="settings-tab-row">${btn}<span class="settings-tab-label">${what}</span></div>`;
  panel.innerHTML = `<div class="card">
    <div class="card-title">DOCA Harness</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:12px">The built-in agent's own settings. Each opens where it is edited.</p>
    ${row('<button class="btn btn-sm" onclick="settingsOpenHarnessParams()">⚙ Model &amp; parameters</button>', 'Provider, model, the fallback chain, limits, tools')}
    ${row('<button class="btn btn-sm" onclick="hcRulesOpen()">Memory rules</button>', 'How it keeps memory: the rules, their review, history and undo')}
    ${row('<button class="btn btn-sm" onclick="hcApprovalOpen()">Approvals</button>', 'What runs without asking: Ask, Auto, Unattended')}
  </div>`;
  identityRender(panel);   // persona.md and human.md (settings/identity.js)
  skillsCardRender(panel); // skills (settings/skills.js)
}
/** Settings → Harness → ⚙: the built-in agent's parameters are edited on Controls, beside its row. */
async function settingsOpenHarnessParams() {
  nav('controls');
  await harnessLoad();
  await harnessConfigToggle('doca', true);
  document.getElementById('harness-cfg-doca')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
