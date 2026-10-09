/* ═══════════════════════════════════════════════════════
   Field → API keys → Your devices (modules/devices-own.js; owner, 2026-10-08):
   a person whose level reaches their own devices pairs, renames, rotates and
   revokes their own here — a phone (DocaMobile, DocaDesk, doca-client), a
   watch or the browser extension — and sees nobody else's. An admin's card is
   the whole registry, and can pair a device for someone else.
   ═══════════════════════════════════════════════════════ */

/** What a device a person pairs for themselves can do, in plain words: the card says it before the code is shown. */
const DEV_OWN_CAN = 'A device you pair here is yours. It chats with your agents as you, gets your notices and questions, '
  + 'lends its own tools (files, screen, apps) to your agents only, and a phone can pair your watch. '
  + 'It cannot run the hub\'s commands or reach anyone else\'s devices. Revoke it here at any time.';

/** Draw the card for whose it is: "Your devices" for a person without the devices right. */
function devOwnApply(data) {
  const own = !!data.own;
  const title = document.getElementById('dev-card-title'), about = document.getElementById('dev-card-about');
  if (title) title.textContent = own ? 'Your devices' : 'This server — devices';
  if (about && own) about.textContent = DEV_OWN_CAN;
  const issue = document.getElementById('dev-issue-btn');
  if (issue) issue.style.display = own ? 'none' : '';
  if (!own) devPairForPopulate();
}

/** An admin pairs for themselves or for someone else; the device is then that person's (their level bounds the role). */
async function devPairForPopulate() {
  const field = document.getElementById('dev-pair-for-field'), sel = document.getElementById('dev-pair-for');
  if (!field || !sel || sel.options.length) return;
  let people = [];
  try { people = (await apiFetch('/api/auth/users')).users || []; } catch { return; }   // without `users`: themselves only
  const others = people.filter(p => !p.suspended && p.status === 'active');
  if (others.length < 2) return;
  sel.innerHTML = '<option value="">Mine</option>' + others.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name || p.email)} (${escHtml(p.level)})</option>`).join('');
  field.style.display = '';
}

/** The body's `forUser`, when an admin chose someone. */
function devPairFor() { return document.getElementById('dev-pair-for')?.value || undefined; }

/** The pairing card's line on what the device will be able to do. */
function devPairCanHtml(p) {
  return (_devData.own ? `<div class="input-label mt8" style="text-transform:none;letter-spacing:0">${escHtml(DEV_OWN_CAN)}</div>` : '') + devPairApprovalHtml(p);
}

function devRename(id, name) {
  appPrompt(`A new name for "${name}":`, async (next) => {
    const n = String(next || '').trim();
    if (!n || n === name) return;
    try { await apiFetch(`/api/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name: n } }); devicesLoad(); }
    catch (e) { devFailed(id, e); }
  }, name);
}
