/* ═══════════════════════════════════════════════════════
   "Unlocked until hh:mm" — the password question's "Keep it unlocked for" (modules/auth/unlock.js; the owner's yes of
   2026-10-13). While this session is open, guarded switches do not ask; the header says until when, with Lock now.
   The window lives in the hub's memory only: this chip reads it at load and is drawn when a password opens one.
   ═══════════════════════════════════════════════════════ */

let _unlockTimer = null;

/** The question's choice: "Just this" first (one click's switches), then the minutes the hub offers. */
function unlockChoice(choices) {
  const mins = Array.isArray(choices) && choices.length ? choices : [1, 5, 15, 30];
  return { label: 'Keep it unlocked for', value: '0', options: [['0', 'Just this'], ...mins.map(m => [String(m), `${m} minute${m === 1 ? '' : 's'}`])] };
}

/** Draw (or clear, with no time) the chip beside the clock; it goes by itself when the time is up. */
function unlockShow(untilIso) {
  clearTimeout(_unlockTimer);
  const at = untilIso ? Date.parse(untilIso) : 0;
  let chip = document.getElementById('unlock-chip');
  if (!at || at <= Date.now()) { chip?.remove(); return; }
  // A phone's header has no room: there the chip is a pill just under it, on the right, over the page.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
  if (!chip) {
    chip = Object.assign(document.createElement('span'), { id: 'unlock-chip', className: 'unlock-chip' });
    const look = 'display:inline-flex;gap:6px;align-items:center;font-size:12px;padding:2px 6px;flex:none;border-radius:999px;border:1px solid var(--amber);color:var(--amber);white-space:nowrap';
    if (narrow) {
      const h = document.querySelector('header')?.getBoundingClientRect().bottom || 52;
      chip.style.cssText = `${look};position:fixed;top:${Math.round(h) + 6}px;right:16px;z-index:900;background:var(--bg)`;
      document.body.append(chip);
    } else {
      chip.style.cssText = look;
      document.querySelector('.header-right')?.prepend(chip);
    }
  }
  const hhmm = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  chip.innerHTML = narrow
    ? `🔓 ${hhmm} <button type="button" class="btn btn-xs" onclick="unlockLock()" aria-label="Lock now">Lock</button>`
    : `🔓 Unlocked until ${hhmm} <button type="button" class="btn btn-xs" onclick="unlockLock()">Lock now</button>`;
  chip.title = `Unlocked until ${hhmm}: important switches do not ask for your password until then (this browser's sign-in only).`;
  _unlockTimer = setTimeout(() => unlockShow(null), at - Date.now() + 500);
}

async function unlockLock() {
  try { await fetch('/api/auth/unlock', { method: 'DELETE' }); } catch { /* the chip goes either way: the hub forgets at restart */ }
  unlockShow(null);
}

/** At load: a window chosen on another tab of this sign-in is shown here too (a chain's half minute is not). */
async function unlockRead() {
  try {
    const d = await (await fetch('/api/auth/unlock')).json();
    if (d.until && Date.parse(d.until) - Date.now() > 35e3) unlockShow(d.until);
  } catch { /* signed out, or an older hub */ }
}
if (typeof document !== 'undefined' && typeof window !== 'undefined' && !/\/login/.test(location.pathname) && !/[?&]cast=1\b/.test(location.search))   // a cast screen switches nothing
  window.addEventListener('load', () => setTimeout(unlockRead, 1500));
