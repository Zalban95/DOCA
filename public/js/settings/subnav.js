/* ═══════════════════════════════════════════════════════
   Settings → the sub-navigation, and the Harness sub-tab.
   ═══════════════════════════════════════════════════════ */

// DOCA's own settings first, then one Harnesses section (asked 2026-10-05: "packed in one section, but still separate"):
// its own row of pills, grouped by whose they are — DOCA's own agent, then OpenClaw, OpenDots and the CLI harnesses,
// each drawn only when that harness is installed, so it is never unclear whose settings they are (decided 2026-09-25).
// OpenClaw's Skills are OpenClaw's (clawhub, ~/.openclaw/workspace/skills); DOCA's own skills are in Harness → Skills.
const _SETTINGS_SUBTABS = [
  { id: 'general',   label: 'General',   init: '_subtabGeneralInit' },
  { id: 'guided',    label: 'Set-up',    init: 'guidedLoad', host: true, find: 'guided setup first run wizard machine models providers keys what to install' },
  { id: 'keys',      label: 'API Keys',  init: 'loadKeys',       find: 'tokens devices pairing apps apk update', page: 'apikeys' },   // page: lives in Field (field-pages.js)
  { id: 'users',     label: 'Users',     init: 'usersLoad',      find: 'people accounts levels permissions roles' },
  { id: 'wearables', label: 'Wearables', init: 'wearablesLoad',  find: 'watch DocaWear console macros joystick' },
  { id: 'channels',  label: 'Channels',  init: 'channelsLoad',   find: 'telegram matrix element slack mail email imap bot chat messaging' },
  { id: 'connectors', label: 'Connectors', init: 'connectorsLoad', find: 'oauth github google gmail calendar microsoft outlook accounts keys services', page: 'connectors' },
  { id: 'packs',     label: 'Packs',     init: 'packsLoad',      find: 'export import dpack share skills recipes mcp' },
  { id: 'backups',   label: 'Backups',   init: 'backupsLoad' },
  { id: 'voice',     label: 'Voice',     init: '_subtabVoiceInit', find: 'live call speech microphone barge-in interrupt tts stt' },
  { id: 'ambient',   label: 'Ambient',   init: 'ambientSettingsInit', find: 'screen saver nest resting clock weather calendar margins galaxy wake' },
  { id: 'system',    label: 'System',    init: '_subtabSystemInit' },
  { id: 'experiments', label: 'Developer', init: 'experimentsLoad', host: true, find: 'developer mode experiment flag try measure' },
  // ── Harnesses: one section, a group each ──
  { id: 'harness',   label: 'Harness',   init: '_settingsHarnessRender', group: 'doca', find: 'skills memory rules approvals parameters guards' },
  { id: 'evals',     label: 'Evaluations', init: 'evalsLoad',    group: 'doca', find: 'evaluation eval test regression promptfoo judge' },
  { id: 'skills',    label: 'Skills',    init: 'loadSkills',    group: 'openclaw' },
  { id: 'snapshots', label: 'Snapshots', init: 'loadSnapshots', group: 'openclaw' },
  { id: 'setup',     label: 'Stack',     init: '_subtabStackInit', group: 'openclaw', find: 'compose start stop restart update rebuild setup scripts' },
  { id: 'config',    label: 'Config',    init: 'initConfig',    group: 'openclaw' },
  { id: 'opendots',  label: 'OpenDots',  init: 'openDotsSettingsLoad', group: 'opendots', find: 'copilotkit dots spaces intelligence' },
  // One pill per installed CLI harness (cli-<id>), all drawn by settings/harnesses.js into one panel, a harness at a time.
  { id: 'harness-others', label: 'CLI harnesses', init: 'otherHarnessesLoad', group: 'others', find: 'claude code codex gemini opencode goose cursor launch command' },
];
const _HARNESS_GROUPS = { doca: 'DOCA', openclaw: 'OpenClaw', opendots: 'OpenDots', others: 'CLI harnesses' };

let _settingsActiveSubtab = 'general';
let _subtabInited = {};
let _openclawInstalled = false;
let _harnessesInstalled = {};   // group → shown: OpenClaw, OpenDots, the CLI harnesses only when installed
let _cliHarnesses = [];         // the installed CLI harnesses, a pill each

async function settingsInit() {
  _harnessesInstalled = { doca: true };
  try {
    const { harnesses = [] } = await apiFetch('/api/harness');
    _openclawInstalled = !!harnesses.find(h => h.id === 'openclaw')?.detected;
    _harnessesInstalled.openclaw = _openclawInstalled;
    _harnessesInstalled.opendots = !!harnesses.find(h => h.id === 'opendots')?.detected;
    _cliHarnesses = harnesses.filter(h => (h.kind === 'cli' || h.kind === 'custom') && h.detected).map(h => ({ id: h.id, label: h.label }));
    _harnessesInstalled.others = _cliHarnesses.length > 0;
  } catch { /* shown with DOCA's own harness only; nothing of DOCA's depends on the others */ }
  _settingsSubnavRender();
  const entry = _SETTINGS_SUBTABS.find(t => t.id === _settingsActiveSubtab);
  settingsSubNav(_settingsActiveSubtab.startsWith('cli-') ? _settingsActiveSubtab : entry && (!entry.group || _harnessesInstalled[entry.group]) ? entry.id : 'general');
}

function _settingsSubnavRender() {
  const nav = document.getElementById('settings-subnav');
  if (!nav) return;
  const pill = t => `<button class="settings-subnav-btn" data-subtab="${t.id}" onclick="settingsSubNav('${t.id}')">${t.label}</button>`;
  // Developer (developer mode and the experiments) is for an owner or a tester: a host's, never drawn for anyone else.
  const mine = t => !t.host || typeof authHasRight !== 'function' || authHasRight('host');
  nav.innerHTML = _SETTINGS_SUBTABS.filter(t => !t.group && !t.page && mine(t)).map(pill).join('')
    + '<button class="settings-subnav-btn" data-subtab="harnesses" onclick="settingsSubNav(\'harness\')" title="DOCA\'s own agent, and each other harness installed here">Harnesses</button>';
  // The second row: the harnesses, a group each.
  let row = document.getElementById('settings-subnav2');
  if (!row) { row = Object.assign(document.createElement('div'), { id: 'settings-subnav2', className: 'settings-subnav settings-subnav2' }); nav.after(row); }
  row.innerHTML = Object.entries(_HARNESS_GROUPS).filter(([g]) => _harnessesInstalled[g]).map(([g, label]) =>
    `<span class="settings-subnav-group" title="${g === 'doca' ? 'DOCA\'s own agent' : `${label}'s own settings, not DOCA's`}">${label}</span>${
      g === 'others' ? _cliHarnesses.map(c => pill({ id: `cli-${c.id}`, label: c.label })).join('') : _SETTINGS_SUBTABS.filter(t => t.group === g).map(pill).join('')}`).join('');
}

function settingsSubNav(panelId) {
  // A section that is a page of its own now (Field → Connectors, API keys): every old link lands there.
  const moved = _SETTINGS_SUBTABS.find(t => t.id === panelId && t.page);
  if (moved && typeof nav === 'function') return nav(moved.page);
  _settingsActiveSubtab = panelId;
  const cli = panelId.startsWith('cli-') ? panelId.slice(4) : null;   // a CLI harness: one panel, that harness

  const inHarnesses = !!cli || !!_SETTINGS_SUBTABS.find(t => t.id === panelId)?.group;
  const row2 = document.getElementById('settings-subnav2');
  if (row2) row2.style.display = inHarnesses ? '' : 'none';
  document.querySelectorAll('#settings-subnav .settings-subnav-btn, #settings-subnav2 .settings-subnav-btn').forEach(btn => {
    const active = btn.dataset.subtab === panelId || (btn.dataset.subtab === 'harnesses' && inHarnesses);
    btn.classList.toggle('active', active);
    // Keep the active pill visible when the sub-nav scrolls horizontally (mobile)
    if (active && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });

  document.querySelectorAll('#tab-settings .settings-panel').forEach(p => {
    p.classList.toggle('active', p.id === `sp-${cli ? 'harness-others' : panelId}`);
  });

  if (cli) return otherHarnessesLoad(cli);
  if (panelId === 'harness-others' && _cliHarnesses[0]) return settingsSubNav(`cli-${_cliHarnesses[0].id}`);
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
  guardsCardRender(panel); // guards (settings/guards.js)
  searchCardRender(panel); // web search (settings/search.js)
  retrievalCardRender(panel); // retrieval: the embedding model (settings/retrieval.js)
  visionCardRender(panel);    // vision: the screen readers (settings/vision.js)
  scoutCardRender(panel);     // the model scout, in developer mode (settings/scout.js)
}
/** Settings → Harness → ⚙: the built-in agent's parameters are edited on Controls, beside its row. */
async function settingsOpenHarnessParams() {
  nav('controls');
  await harnessLoad();
  await harnessConfigToggle('doca', true);
  document.getElementById('harness-cfg-doca')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
