/* ═══════════════════════════════════════════════════════
   Focused and Extended (asked 2026-10-12; modules/screens/panel-mode.js): two faces of one panel. Focused is the
   calm everyday view — Home, a conversation, Calendar and Mail, what was made — drawn in a root of its own over the
   page; Extended is the whole panel. Focused only hides: the panel underneath keeps running, every route, tool and
   setting stays where it was, and one tap goes either way (the avatar menu here, the "Focused" pill in Extended's
   header).

   Which one a screen shows is the screen setting `panelMode`: this screen's, else its person's, else the hive's, else
   by role (a host starts in Extended, everyone else in Focused). The hub says which (`GET /api/screen` → panelMode);
   this browser remembers the last answer (focused/early.js) so the right face is drawn before the hub answers.
   `?view=focused` shows Focused on this tab without changing the setting.
   ═══════════════════════════════════════════════════════ */
const FOCUSED_ASKED = (() => { try { return new URLSearchParams(location.search).get('view') === 'focused'; } catch { return false; } })();
let _focusedMode = null;   // {mode, from} as the hub said, or as this page chose since

function focusedOn() { return document.documentElement.dataset.mode === 'focused'; }

function _focusedMark(mode) {
  document.documentElement.dataset.mode = mode;
  try { localStorage.setItem('doca.panelMode', mode); } catch { /* a private window: this page only */ }
}

/** At start: ask the hub which face this screen shows, and draw it. */
async function focusedStart() {
  if (!document.getElementById('chat-fab')) return;   // the panel only, not /face or a device page's own scripts
  _focusedPill();
  let s = null;
  try { s = await screenLoad(); } catch { /* the hub did not answer: the face this browser showed last */ }
  _focusedMode = s?.panelMode || { mode: document.documentElement.dataset.mode || 'extended', from: 'browser' };
  const mode = FOCUSED_ASKED ? 'focused' : _focusedMode.mode;
  if (!FOCUSED_ASKED) _focusedMark(mode); else document.documentElement.dataset.mode = 'focused';
  if (mode === 'focused') fcShellOpen();
}

/**
 * Switch this screen to `mode`. `everywhere`: the person's own layer, so every screen of theirs that has not chosen
 * for itself follows (S13) — and this screen's own choice is cleared so it follows too.
 */
async function focusedSwitch(mode, { everywhere = false } = {}) {
  if (!['focused', 'extended'].includes(mode)) return;
  _focusedMark(mode);
  if (mode === 'focused') fcShellOpen(); else fcShellClose();
  try {
    const q = typeof _screenQ === 'function' ? _screenQ() : '';
    if (everywhere) {
      await apiFetch(`/api/screen/settings${q ? `${q}&` : '?'}layer=person`, { method: 'POST', body: { panelMode: mode } });
      const r = await screenSave({ panelMode: null });
      _focusedMode = r.panelMode || { mode, from: 'person' };
    } else {
      const r = await screenSave({ panelMode: mode });
      _focusedMode = r.panelMode || { mode, from: 'device' };
    }
  } catch (e) { if (typeof appAlert === 'function') appAlert(`This screen shows ${mode === 'focused' ? 'Focused' : 'Extended'} now, but it was not kept: ${e.message}`); }
  if (mode === 'extended' && typeof nav === 'function') nav(typeof currentTab !== 'undefined' ? currentTab : 'controls');
  if (FOCUSED_ASKED && mode === 'extended') history.replaceState(history.state, '', location.pathname + location.hash);
}

/** The way back from Extended: one pill in the header (and the phone's drawer), always there. */
function _focusedPill() {
  if (document.getElementById('focused-pill')) return;
  const b = Object.assign(document.createElement('button'), { id: 'focused-pill', type: 'button', className: 'focused-pill',
    title: 'The calm everyday view: home, your conversation, calendar and mail. Everything here stays one tap away.' });
  b.innerHTML = '<span class="focused-pill-pt" aria-hidden="true"></span><span>Focused</span>';
  // Back from a page opened for a moment (fcPeek): this screen is Focused already, so nothing is written.
  b.onclick = () => (_focusedMode?.mode === 'focused' ? (_focusedMark('focused'), fcShellOpen()) : focusedSwitch('focused'));
  const right = document.querySelector('header .header-right');
  if (right) right.prepend(b);
}

/** The panel's own polling waits while Focused shows (sidebar.js asks). */
function focusedQuiet() { return focusedOn(); }

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', focusedStart);
