/* ═══════════════════════════════════════════════════════
   Settings → System → System tools (moved from settings.js as it was):
   the rows of modules/system-tools-catalog.js, found and installed here.
   ═══════════════════════════════════════════════════════ */

const SYSDEP_CATEGORY_LABEL = { required: 'Required', recommended: 'Recommended', optional: 'Optional — for the features that use them', clients: 'For building DOCA\'s apps (not needed to run DOCA)' };
const SYSDEP_CATEGORY_COLOR = { required: 'var(--red)', recommended: 'var(--amber)', optional: 'var(--muted)', clients: 'var(--teal, var(--muted))' };

let _sysdepsInstalling = null; // tool id currently installing
let _sysdepsTools      = [];   // cached list from last fetch (used by sysdepsInstall)

async function sysdepsLoad() {
  const list   = document.getElementById('sysdeps-list');
  const btn    = document.getElementById('sysdeps-refresh-btn');
  if (!list) return;
  list.innerHTML = '<div class="placeholder pulse">Checking…</div>';
  if (btn) btn.disabled = true;
  if (hostedHive()) { list.innerHTML = `<div class="placeholder">${escHtml(HOSTED_SAY)}</div>`; return; }
  try {
    const data  = await apiFetch('/api/system/tools');
    _sysdepsTools = data.tools || [];
    _sysdepsRender(_sysdepsTools);
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function sysdepsRefresh() { sysdepsLoad(); }

/** Every "Settings → System → System tools" link: the section, with its card brought into view — the Models page's
    link only changed the section and left the card a screen and a half below (newcomer run 2026-10-14, a12). Taken
    again once the cards above it have drawn, since they move it down. */
function sysdepsShow() {
  settingsSubNav('system');
  const bring = () => document.getElementById('sysdeps-list')?.closest('.card')?.scrollIntoView({ block: 'start' });
  bring();
  setTimeout(bring, 400);
}

function _sysdepsRender(tools) {
  const list = document.getElementById('sysdeps-list');
  if (!list) return;

  // Group by category
  const cats = ['required', 'recommended', 'optional', 'clients'];
  let html = '';

  cats.forEach(cat => {
    const group = tools.filter(t => t.category === cat);
    if (!group.length) return;

    html += `<div class="tool-group-label" style="color:${SYSDEP_CATEGORY_COLOR[cat]}">${SYSDEP_CATEGORY_LABEL[cat]}</div>`;
    html += group.map(t => toolRowHtml({
      id:             `sysdep-${t.id}`,
      label:          t.label,
      note:           t.note,
      for:            t.for,
      command:        t.installCmd,
      detected:       t.detected,
      version:        t.version,
      canInstall:     t.canInstall,
      installing:     _sysdepsInstalling === t.id,
      installOnclick: `sysdepsInstall('${t.id}')`,
      updateOnclick:  t.canUpdate ? `sysdepsUpdate('${t.id}')` : '',
      restartOnclick: t.restartCmd ? `sysdepsRestart('${t.id}')` : '',
      repo:           t.repo,
      repoLabel:      t.repoLabel,
    })).join('');
  });

  list.innerHTML = html;
}

/** Install asks first, saying how much it downloads (lib/install-ask.js; deep test B, R5). */
function sysdepsInstall(id) {
  const tool = _sysdepsTools.find(t => t.id === id);
  installAsk('tool', id, tool ? tool.label : id, () => _sysdepsStart(id, 'Installing'), { note: tool?.note || '' });
}

/** Updating is re-running the installer: apt reinstalls the current release,
 *  vendor scripts fetch the latest, git-backed stacks pull. Confirmed first —
 *  on a tool that already works this can swap a live binary or restart
 *  services, which is not what "↻" suggests on its own. */
function sysdepsUpdate(id) {
  const tool = _sysdepsTools.find(t => t.id === id);
  appConfirm(
    `Update "${tool ? tool.label : id}" by re-running its installer? ` +
    `If it is already up to date this changes nothing; otherwise it upgrades in place.`,
    () => _sysdepsStart(id, 'Updating'),
  );
}

/** Restart a program that runs as a service (Ollama, Docker): asked first with what it cuts, then the machine's
 *  password where its command needs it; only the row's own command runs (system-tools.js handleRestart). */
function sysdepsRestart(id) {
  const tool = _sysdepsTools.find(t => t.id === id);
  if (!tool?.restartCmd) return;
  appConfirm(`Restart ${tool.label}? ${tool.restartNote || ''}`.trim(), () => {
    const go = pw => _sysdepsRunInstall(id, pw, 'Restarting', '/api/system/tools/restart');
    if (tool.restartCmd.includes('sudo ')) sudoAsk(`Restarting "${tool.label}" requires elevated privileges.`, pw => { if (pw !== null) go(pw); });
    else go(null);
  });
}

function _sysdepsStart(id, verb) {
  const tool = _sysdepsTools.find(t => t.id === id);
  const needsSudo = tool && (tool.needsSudo || (typeof tool.installCmd === 'string' && tool.installCmd.includes('sudo ')));

  if (needsSudo) {
    sudoAsk(`${verb} "${tool.label}" requires elevated privileges.`, pw => {
      if (pw === null) return; // user cancelled
      _sysdepsRunInstall(id, pw, verb);
    });
  } else {
    _sysdepsRunInstall(id, null, verb);
  }
}

async function _sysdepsRunInstall(id, password, verb = 'Installing', url = '/api/system/tools/install') {
  _sysdepsInstalling = id;
  // Re-render with installing flag using cached tools list
  if (_sysdepsTools.length) _sysdepsRender(_sysdepsTools);

  const out = document.getElementById('sysdeps-out');
  showStream(out, `${verb} ${id}…\n`);

  const body = { id };
  if (password !== null && password !== undefined) body.password = password;

  await sseStream(url, body, {
    onStatus: text => appendStream(out, text),
    onDone: () => {
      _sysdepsInstalling = null;
      setTimeout(sysdepsLoad, 800);
    },
    onError: e => {
      if (out) out.textContent += `\nError: ${e.message}`;
      _sysdepsInstalling = null;
      setTimeout(sysdepsLoad, 500);
    },
  });
}
