/* ═══════════════════════════════════════════════════════
   Field → API keys → devices: giving an ownerless one to a person (owner's yes, 2026-10-09).
   "Assign to a person" on a device that belongs to nobody (paired before
   accounts: its own page refused everyone, it followed no level) —
   modules/devices-assign.js. Asked twice: whom, then what it means, with the
   scopes beyond their level named before anything is written.
   ═══════════════════════════════════════════════════════ */

/** The button on a device card: only an admin's list, only a live device with no person. */
function devAssignButtonHtml(d) {
  if (_devData.own || d.userId || d.revokedAt || ['browser', 'channel'].includes(d.kind)) return '';
  return `<button class="btn btn-xs" onclick="devAssign(${jsArg(d.id)},${jsArg(d.name)})" title="It belongs to nobody: give it to a person, held to their level">👤 Assign to a person</button>`;
}

/** The card's line saying it belongs to nobody, so the button is not a mystery. */
function devOwnerlessHtml(d) {
  if (_devData.own || d.userId || d.revokedAt || ['browser', 'channel'].includes(d.kind)) return '';
  return `<div class="desc mt8">Belongs to nobody — paired before accounts, so its own page opens for no one and it follows no person's level.</div>`;
}

async function devAssign(id, name) {
  let people = [];
  try { people = ((await apiFetch('/api/auth/users')).users || []).filter(p => !p.suspended && p.status === 'active'); }
  catch (e) { return devFailed(id, e); }
  if (!people.length) return devFailed(id, new Error('There is nobody here to give it to.'));
  const choices = people.map(p => ({ label: `${p.name || p.email} (${p.level})`, value: p.id }));
  appChoose(`Give "${name}" to whom?\n\nIt is theirs from then on: its own page opens for them and it is held to their level, like their other devices. It cannot be moved to someone else later — only revoked.`,
    [{ label: 'Cancel', value: null }, ...choices], userId => { if (userId) devAssignConfirm(id, name, userId); });
}

/** The second question: what it holds that their level does not, said before the yes (a dry run on the hub). */
async function devAssignConfirm(id, name, userId) {
  const url = `/api/devices/${encodeURIComponent(id)}/assign`;
  let plan;
  try { plan = await apiFetch(url, { method: 'POST', body: { userId, dryRun: true } }); }
  catch (e) { return devFailed(id, e); }
  const who = `${plan.person.name} (${plan.person.level})`;
  const drops = plan.dropped?.length ? `It loses what their level does not hold:\n• ${plan.dropped.join('\n• ')}` : 'It keeps everything it holds: all of it is within their level.';
  appConfirm(`Give "${name}" to ${who}?\n\n${drops}\n\nWritten in the audit log and the activity.`, async () => {
    try {
      const r = await apiFetch(url, { method: 'POST', body: { userId } });
      await devicesLoad();
      setStatus(document.getElementById(`dev-status-${id}`), `✓ Now ${r.person.name}'s${r.dropped?.length ? ` — without ${r.dropped.join(', ')}` : ''}.`, 'ok');
    } catch (e) { devFailed(id, e); }
  });
}
