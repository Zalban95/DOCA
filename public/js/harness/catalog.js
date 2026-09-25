/* ═══════════════════════════════════════════════════════
   Harness settings on the Controls page: the catalog modal, installing anything DOCA knows.
   ═══════════════════════════════════════════════════════ */

/* ── Catalog modal: install anything DOCA knows ───────── */

function _harnessCatalogFind(id) { return _harnesses.find(h => h.id === id); }

function harnessCatalogOpen() {
  document.getElementById('harness-catalog-overlay').style.display = 'flex';
  document.getElementById('harness-catalog-out').style.display = 'none';
  harnessCatalogRender();
  if (!_harnesses.length) harnessLoad();
}

function harnessCatalogClose(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('harness-catalog-overlay').style.display = 'none';
}

function harnessCatalogRender() {
  const list = document.getElementById('harness-catalog-list');
  if (!list) return;
  const q = (document.getElementById('harness-catalog-filter')?.value || '').toLowerCase();
  const rows = _harnesses.filter(h =>
    !q || `${h.label} ${h.vendor} ${h.id}`.toLowerCase().includes(q));

  list.innerHTML = rows.map(h => `
    <div class="harness-cat-row">
      <span class="harness-cat-status" style="color:${h.detected ? 'var(--green)' : 'var(--muted)'}">${h.detected ? '✓' : '○'}</span>
      <span class="harness-label">${escHtml(h.label)}</span>
      <span class="harness-vendor">${escHtml(h.vendor || '')}</span>
      <span class="harness-note">${escHtml(h.detected ? (h.version || 'installed') : (h.note || h.cmd || ''))}</span>
      <span class="tool-actions">
        ${h.canInstall
          ? `<button class="btn btn-xs ${h.detected ? '' : 'btn-teal'}" onclick="harnessInstall(${jsArg(h.id)})">${h.detected ? '↻ Update' : '⬇ Install'}</button>`
          : '<span class="tool-manual">manual install</span>'}
        ${h.isDefault ? '' : `<button class="btn btn-xs" onclick="harnessSetDefault(${jsArg(h.id)})">Use</button>`}
        ${h.url ? `<a class="tool-repo" href="${escHtml(h.url)}" target="_blank" rel="noopener">docs</a>` : ''}
      </span>
    </div>`).join('') || '<div class="placeholder">Nothing matches that filter.</div>';
}
