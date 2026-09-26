/* ═══════════════════════════════════════════════════════
   Harness tab: settings and installs the agent wants, applied
   or rejected by the user.
   ═══════════════════════════════════════════════════════ */

/* ── Settings the agent wants changed ─────────────────── */

async function _hcLoadProposals() {
  const box = document.getElementById('hc-proposals');
  if (!box) return;
  // Settings changes and installs share one tray on purpose: they are the same
  // question — the agent wants something done that only the user may do — and
  // two lists would mean two places to look for an unanswered one.
  const [props, inst] = await Promise.all([
    apiFetch('/api/harness/proposals').catch(() => ({ pending: [] })),
    apiFetch('/api/harness/installs').catch(() => ({ pending: [] })),
  ]);
  box.innerHTML = (props.pending || []).map(_hcProposalHtml).join('')
    + (inst.pending || []).map(_hcInstallHtml).join('');
}

/**
 * One thing the agent wants installed.
 *
 * It names the installer rather than a command, because that is the actual
 * safety property here: the agent chose from a catalog, and Accept runs the
 * same code the Models or Services tab runs when you click their buttons.
 * There is nothing in this card the user could not already have clicked, which
 * is what makes it a fair thing to be asked.
 */
function _hcInstallHtml(i) {
  return `
    <div class="hc-prop" id="hc-inst-${escHtml(i.id)}">
      <div class="hc-prop-head">
        <span class="badge badge-blue" style="font-size:9px">INSTALL</span>
        <span class="hc-prop-why">${escHtml(i.reason || 'The agent needs this to continue.')}</span>
      </div>
      <div class="hc-prop-row">
        <code class="hc-prop-key">${escHtml(i.kind)}</code>
        <span class="hc-prop-to">${escHtml(i.target)}</span>
      </div>
      <div class="hc-prop-note">${escHtml(i.what)}</div>
      ${i.needsPassword
        ? '<div class="hc-prop-note">Its installer needs sudo — you will be asked for your password, not the agent.</div>'
        : ''}
      <div class="hc-prop-actions">
        <span class="status-line" id="hc-inst-status-${escHtml(i.id)}"></span>
        <button class="btn btn-xs" onclick="hcInstallReject(${jsArg(i.id)})">Decline</button>
        <button class="btn btn-xs btn-green" onclick="hcInstallApply(${jsArg(i.id)})">${escHtml(i.verb || 'Install')}</button>
      </div>
    </div>`;
}

async function hcInstallApply(id) {
  const st = document.getElementById(`hc-inst-status-${id}`);
  setStatus(st, 'installing…', '');
  try {
    const { install } = await apiFetch(`/api/harness/installs/${encodeURIComponent(id)}/apply`,
      { method: 'POST', body: {} });
    if (install.status === 'installed') {
      setStatus(st, '✓ installed', 'ok');
      // Tools are rebuilt per step server-side, but the ⚙ panel's copy is not.
      _harnessLoadMeta(true);
    } else {
      setStatus(st, `✗ ${install.error || 'failed'}`, 'err');
    }
    setTimeout(_hcLoadProposals, 1500);
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function hcInstallReject(id) {
  const st = document.getElementById(`hc-inst-status-${id}`);
  try {
    await apiFetch(`/api/harness/installs/${encodeURIComponent(id)}/reject`, { method: 'POST', body: {} });
    _hcLoadProposals();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * One pending change, with the values it would replace.
 *
 * The old value is shown next to the new one for every key, because "accept"
 * has to be a decision about something visible: the agent proposing a path is
 * also the agent that would use it, and nobody should have to open Settings in
 * another tab to see what it is asking to overwrite.
 */
function _hcProposalHtml(p) {
  const rows = p.changes.map(c => `
    <div class="hc-prop-row">
      <code class="hc-prop-key">${escHtml(c.path)}</code>
      <span class="hc-prop-from">${escHtml(_hcPropValue(c.from))}</span>
      <span class="hc-prop-arrow">→</span>
      <span class="hc-prop-to">${escHtml(_hcPropValue(c.to))}</span>
    </div>`).join('');

  const notes = [...new Set(p.changes.map(c => c.note).filter(Boolean))];

  return `
    <div class="hc-prop" id="hc-prop-${escHtml(p.id)}">
      <div class="hc-prop-head">
        <span class="badge badge-amber" style="font-size:9px">SETTINGS CHANGE</span>
        <span class="hc-prop-why">${escHtml(p.reason || 'The agent suggests this change.')}</span>
      </div>
      ${rows}
      ${notes.map(n => `<div class="hc-prop-note">${escHtml(n)}</div>`).join('')}
      <div class="hc-prop-actions">
        <span class="status-line" id="hc-prop-status-${escHtml(p.id)}"></span>
        <button class="btn btn-xs" onclick="hcProposalReject(${jsArg(p.id)})">Decline</button>
        <button class="btn btn-xs btn-green" onclick="hcProposalApply(${jsArg(p.id)})">Accept</button>
      </div>
    </div>`;
}

async function hcProposalApply(id) {
  const st = document.getElementById(`hc-prop-status-${id}`);
  try {
    const data = await apiFetch(`/api/harness/proposals/${encodeURIComponent(id)}/apply`, { method: 'POST' });
    _hcAppend('summary', data.proposal.changes.map(c => `${c.path} = ${JSON.stringify(c.to)}`).join('\n'),
      data.restartNeeded ? 'Applied — restart the panel for it to take effect' : 'Applied');
    await _hcLoadProposals();
    // Paths and stats are drawn from prefs elsewhere in the panel; the pages
    // that show them read on open, so only this one needs telling.
    if (typeof settingsLoad === 'function' && currentTab === 'settings') settingsLoad();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * Decline, with the chance to say why.
 *
 * The reason is not politeness: it goes into the agent's context, which is what
 * stops it proposing the same thing again next turn. Declining without one is
 * still allowed — leaving the box empty should not cost anyone a click.
 */
function hcProposalReject(id) {
  appPrompt('Why not? The agent sees this, so it will not suggest it again. Leave it empty to just decline.',
    async reason => {
      try {
        await apiFetch(`/api/harness/proposals/${encodeURIComponent(id)}/reject`, {
          method: 'POST', body: { reason: reason || '' },
        });
        await _hcLoadProposals();
      } catch (e) { appAlert(e.message); }
    }, '', { allowEmpty: true });
}

/** A value as the card shows it: a tool note's words, not its bookkeeping (modules/harness/tool-notes.js). */
function _hcPropValue(v) {
  return v && typeof v === 'object' && typeof v.text === 'string' && 'fp' in v ? v.text : JSON.stringify(v);
}
