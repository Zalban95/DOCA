/* ═══════════════════════════════════════════════════════
   System tools: the shared detection cache, the installer, and the row
   every tool list draws.
   ═══════════════════════════════════════════════════════ */

/**
 * Standard tool row: status icon, label, version, note and actions
 * (⬇ Install when missing & installable, doc link, ⚙ gear when settable).
 * Used by Settings → System, the Models tab AI Tools card, and any other
 * tool list that needs the same look.
 *
 * @param {{
 *   id: string, label: string, note?: string,
 *   detected: boolean, version?: string|null,
 *   canInstall?: boolean, installing?: boolean, installOnclick?: string,
 *   updateOnclick?: string,  - opt-in: shows ↻ Update once the tool is detected
 *   gearOnclick?: string, repo?: string, repoLabel?: string,
 *   extraActions?: string,   - pre-built HTML appended to the actions cell
 * }} t
 * @returns {string} HTML
 */
function toolRowHtml(t) {
  const statusIcon = t.detected ? '✓' : '✗';
  const cls        = t.detected ? 'tool-ok' : 'tool-missing';

  const versionStr = t.detected && t.version
    ? `<span class="tool-version">${escHtml(t.version)}</span>` : '';

  const installBtn = !t.detected && t.canInstall && t.installOnclick
    ? `<button class="btn btn-xs btn-teal" onclick="${t.installOnclick}" ${t.installing ? 'disabled' : ''}>
         ${t.installing ? '⏳ Installing…' : '⬇ Install'}
       </button>`
    : '';

  // Re-running an installer is how most of these tools update (apt reinstalls
  // the current release, vendor scripts fetch the latest, git-backed stacks
  // pull). Opt-in per caller: not every tool list wants the extra button.
  const updateBtn = t.detected && t.updateOnclick
    ? `<button class="btn btn-xs" onclick="${t.updateOnclick}" ${t.installing ? 'disabled' : ''}
               title="Re-run the installer to update to the latest version">
         ${t.installing ? '⏳ Updating…' : '↻ Update'}
       </button>`
    : '';

  const repoLink = !t.detected && t.repo
    ? `<a class="tool-repo" href="${t.repo}" target="_blank" title="${t.repo}">${escHtml(t.repoLabel || t.repo)}</a>`
    : '';

  const manualNote = !t.detected && !t.canInstall && !t.extraActions
    ? `<span class="tool-manual">manual install</span>`
    : '';

  const gearBtn = t.gearOnclick
    ? `<button class="btn btn-xs tool-gear" title="Settings" onclick="${t.gearOnclick}">⚙</button>`
    : '';

  return `<div class="tool-row ${cls}" id="tool-row-${t.id}">
    <span class="tool-status">${statusIcon}</span>
    <span class="tool-label">${escHtml(t.label)}</span>
    ${versionStr}
    <span class="tool-note">${escHtml(t.note || '')}</span>
    <span class="tool-actions">${t.extraActions || ''}${installBtn}${updateBtn}${repoLink}${manualNote}${gearBtn}</span>
  </div>`;
}

/* ── System-tools shared cache + installer ───────────── */

let _systemToolsCache = null;

/**
 * Fetch /api/system/tools once and cache the result (shared by the Models
 * tab badges and anything else needing detection state).
 * @param {boolean} [force] - bypass the cache
 */
async function getSystemTools(force = false) {
  if (_systemToolsCache && !force) return _systemToolsCache;
  const data = await apiFetch('/api/system/tools');
  _systemToolsCache = data.tools || [];
  return _systemToolsCache;
}

/**
 * Install a system tool by id (single shared install path — same endpoint
 * the Settings → System panel uses), streaming output into `outEl`.
 * Prompts for the sudo password when the tool requires it.
 * @param {string} id - system tool id (e.g. 'ollama', 'huggingface-cli')
 * @param {HTMLElement|null} outEl - <pre> for streamed output
 * @param {Function} [onDone] - called with the final done event
 */
async function systemToolInstall(id, outEl, onDone) {
  let tool = null;
  try { tool = (await getSystemTools()).find(t => t.id === id); } catch {}

  const run = async password => {
    showStream(outEl, `Installing ${id}…\n`);
    const body = { id };
    if (password) body.password = password;
    await sseStream('/api/system/tools/install', body, {
      onStatus: text => appendStream(outEl, text),
      onDone:   obj => { _systemToolsCache = null; if (onDone) onDone(obj); },
      onError:  e => { if (outEl) outEl.textContent += `\nError: ${e.message}`; },
    });
  };

  if (tool?.needsSudo) {
    sudoAsk(`Installing "${tool.label}" requires elevated privileges.`, pw => {
      if (pw === null) return; // cancelled
      run(pw);
    });
  } else {
    run(null);
  }
}
