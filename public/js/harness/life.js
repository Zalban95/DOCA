/* A harness switched off or deleted (modules/harness/harness-life.js, asked 2026-10-12). DOCA's own is neither. Off
   keeps it installed but never chosen; delete removes one added by hand, or uninstalls with the exact reverse of its
   own installer — the confirmation says what will run, or why the panel cannot undo it. */
async function harnessToggle(id, on) {
  const st = document.getElementById('harness-status');
  try {
    const r = await apiFetch(`/api/harness/${encodeURIComponent(id)}/enabled`, { method: 'POST', body: { on } });
    setStatus(st, on ? '✓ Switched on' : `✓ Switched off${r.defaultNow ? ' — the chat uses DOCA\'s own agent again' : ''}`, 'ok');
    await harnessLoad();
    if (r.defaultNow) _harnessConsoleReset();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function harnessDelete(id) {
  const h = _harnesses.find(x => x.id === id);
  let p;
  try { p = await apiFetch(`/api/harness/${encodeURIComponent(id)}/delete`); } catch (e) { return appAlert(e.message); }
  if (!p.can) return appAlert(p.why);
  appConfirm(`Delete “${h?.label || id}”? ${p.said}`, async () => {
    if (p.how === 'remove') {
      try { await apiFetch(`/api/harness/${encodeURIComponent(id)}/delete`, { method: 'POST', body: {} }); await harnessLoad(); }
      catch (e) { appAlert(e.message); }
      return;
    }
    const out = document.getElementById('harness-install-out');
    showStream(out, '');
    await sseStream(`/api/harness/${encodeURIComponent(id)}/delete`, {}, {
      onStatus: text => appendStream(out, text),
      onDone: () => setTimeout(() => harnessLoad(), 1200),
      onError: e => appendStream(out, `\nError: ${e.message}`),
    });
  });
}
