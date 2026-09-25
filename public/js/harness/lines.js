/* ═══════════════════════════════════════════════════════
   Harness settings on the Controls page: one line per harness — load, default, install,
   custom harnesses. Shared state for the harness pages is declared here.
   ═══════════════════════════════════════════════════════ */

let _harnesses     = [];
let _harnessDflt   = null;
let _harnessMeta   = null;   // { providers, tools, defaults } — fetched once
let _harnessOpenCfg = null;  // id whose ⚙ strip is open
let _harnessTerm   = null;   // { id, term, fit, ws, ro }

/* ── Controls page: the lines ─────────────────────────── */

async function harnessLoad() {
  const list = document.getElementById('harness-list');
  if (!list) return;
  try {
    const data   = await apiFetch('/api/harness');
    _harnesses   = data.harnesses || [];
    _harnessDflt = data.default;
    _harnessRender();
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

/**
 * Metadata for the ⚙ panel (providers, tool switches, defaults).
 *
 * Pass `force` when opening the panel: the tool list is no longer fixed at boot
 * now that a running MCP server contributes to it, so a cached copy would offer
 * tools of a server that has since stopped.
 */
async function _harnessLoadMeta(force) {
  if (_harnessMeta && !force) return _harnessMeta;
  _harnessMeta = await apiFetch('/api/harness/providers');
  return _harnessMeta;
}

/**
 * The main list stays short: the harnesses actually on this machine, plus the
 * default even when it is missing. Everything else lives behind ⬇ Install.
 */
function _harnessRender() {
  const list = document.getElementById('harness-list');
  if (!list) return;

  const shown = _harnesses.filter(h => h.detected || h.isDefault || h.kind === 'custom');
  const label = document.getElementById('harness-default-label');
  const dflt  = _harnesses.find(h => h.isDefault);
  if (label) label.textContent = dflt ? `default: ${dflt.label}` : '';

  list.innerHTML = shown.map(_harnessRowHtml).join('')
    || '<div class="placeholder">No harness detected — use ⬇ Install a harness.</div>';

  if (_harnessOpenCfg && shown.some(h => h.id === _harnessOpenCfg)) harnessConfigToggle(_harnessOpenCfg, true);
}

function _harnessRowHtml(h) {
  const id  = h.id;
  const arg = jsArg(id);
  const badge = h.detected
    ? `<span class="tool-version">${escHtml(h.version || 'installed')}</span>`
    : `<span class="harness-missing">not installed</span>`;

  const actions = [
    h.isDefault
      ? '<span class="badge badge-green" style="font-size:9px">default</span>'
      : `<button class="btn btn-xs" onclick="harnessSetDefault(${arg})" title="Make this the harness DOCA talks to">Use</button>`,
    h.detected
      ? `<button class="btn btn-xs btn-green" onclick="harnessOpen(${arg})" title="Open it on the Harness tab">▶ Open</button>`
      : '',
    !h.detected && h.canInstall
      ? `<button class="btn btn-xs btn-teal" onclick="harnessInstall(${arg})">⬇ Install</button>`
      : '',
    h.detected && h.canInstall
      ? `<button class="btn btn-xs" onclick="harnessInstall(${arg})" title="Re-run the installer to update">↻</button>`
      : '',
    `<button class="btn btn-xs tool-gear" onclick="harnessConfigToggle(${arg})" title="Model and parameters">⚙</button>`,
    h.url ? `<a class="tool-repo" href="${escHtml(h.url)}" target="_blank" rel="noopener" title="${escHtml(h.url)}">docs</a>` : '',
    h.kind === 'custom'
      ? `<button class="btn btn-xs btn-red" onclick="harnessRemoveCustom(${arg})" title="Remove this custom harness">🗑</button>`
      : '',
  ].filter(Boolean).join('');

  return `<div class="harness-row ${h.detected ? 'harness-ok' : 'harness-off'} ${h.isDefault ? 'harness-default' : ''}" id="harness-row-${escHtml(id)}">
      <span class="harness-dot" title="${h.isDefault ? 'Default harness' : 'Not the default'}">${h.isDefault ? '●' : '○'}</span>
      <span class="harness-label">${escHtml(h.label)}</span>
      <span class="harness-vendor">${escHtml(h.vendor || '')}</span>
      ${badge}
      <span class="harness-note">${escHtml(h.note || h.cmd || '')}</span>
      <span class="tool-actions">${actions}</span>
    </div>
    <div class="tool-config-strip harness-cfg" id="harness-cfg-${escHtml(id)}" style="display:none"></div>`;
}

async function harnessSetDefault(id) {
  const st = document.getElementById('harness-status');
  try {
    await apiFetch('/api/harness/default', { method: 'POST', body: { id } });
    setStatus(st, '✓ Default harness updated', 'ok');
    await harnessLoad();
    _harnessConsoleReset();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

function harnessInstall(id) {
  const h = _harnesses.find(x => x.id === id) || _harnessCatalogFind(id);
  if (!h) return;
  const run = pw => _harnessRunInstall(id, pw);
  if (h.needsSudo) sudoAsk(`Installing "${h.label}" requires elevated privileges.`, pw => { if (pw !== null) run(pw); });
  else run(null);
}

async function _harnessRunInstall(id, password) {
  // Output goes to whichever box is on screen: the catalog modal when it is
  // open, otherwise the Controls card.
  const inModal = document.getElementById('harness-catalog-overlay')?.style.display !== 'none';
  const out = document.getElementById(inModal ? 'harness-catalog-out' : 'harness-install-out');
  showStream(out, '');

  const body = { };
  if (password !== null && password !== undefined) body.password = password;

  await sseStream(`/api/harness/${encodeURIComponent(id)}/install`, body, {
    onStatus: text => appendStream(out, text),
    onDone:   obj => { if (obj.ok) setTimeout(() => { harnessLoad().then(harnessCatalogRender); }, 1200); },
    onError:  e => appendStream(out, `\nError: ${e.message}`),
  });
}

async function harnessAddCustom() {
  const st    = document.getElementById('harness-status');
  const label = document.getElementById('harness-new-label');
  const cmd   = document.getElementById('harness-new-cmd');
  const inst  = document.getElementById('harness-new-install');
  if (!label.value.trim() || !cmd.value.trim()) {
    setStatus(st, 'A name and a command are required.', 'err');
    return;
  }
  try {
    await apiFetch('/api/harness/custom', { method: 'POST', body: {
      label: label.value.trim(), cmd: cmd.value.trim(), installCmd: inst.value.trim() || null,
    } });
    label.value = cmd.value = inst.value = '';
    setStatus(st, '✓ Harness added', 'ok');
    harnessLoad();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

function harnessRemoveCustom(id) {
  const h = _harnesses.find(x => x.id === id);
  appConfirm(`Remove the custom harness "${h?.label || id}"?`, async () => {
    try {
      await apiFetch(`/api/harness/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });
      harnessLoad();
    } catch (e) { setStatus(document.getElementById('harness-status'), `✗ ${e.message}`, 'err'); }
  });
}

function harnessOpen(id) {
  if (id !== _harnessDflt) { harnessSetDefault(id).then(() => nav('harness')); return; }
  nav('harness');
}
