/* ═══════════════════════════════════════════════════════
   What the panel is waiting on the person for, told to the app that hosts it (2026-10-08).
   ═══════════════════════════════════════════════════════
   A desk or phone app keeps this page in a window that may be hidden: a password asked by a guarded switch, a
   question or the agent's approval popup waits there unseen. Whenever the set of open dialogs changes, the panel
   posts {type: 'doca.attention', kinds: [...]} — 'password', 'question', 'approval' — to the host it runs in
   (WebView2's chrome.webview: DocaDesk; DocaMobile's window.DocaDevice.attention, when it has one). Kinds only:
   never a dialog's text, a field's value or an approval's command. In an ordinary browser there is no host and
   nothing is sent. The ids are the dialogs' own (lib/dialogs.js, agent-ui/approval.js); test/attention.test.js
   holds them to index.html, so a renamed dialog fails a test instead of silently stopping the notices. */

const ATTENTION_IDS = { prompt: 'app-prompt-modal', promptInput: 'app-prompt-input', confirm: 'app-confirm-modal', approval: 'approval-overlay' };

/** The open dialogs that wait for the person, by kind. */
function attentionKinds() {
  const k = [];
  const p = document.getElementById(ATTENTION_IDS.prompt);
  if (p?.classList.contains('open')) k.push(document.getElementById(ATTENTION_IDS.promptInput)?.type === 'password' ? 'password' : 'question');
  if (document.getElementById(ATTENTION_IDS.confirm)?.classList.contains('open') && !k.includes('question')) k.push('question');
  if (document.getElementById(ATTENTION_IDS.approval)) k.push('approval');
  return k;
}

let _attentionLast = null;
function attentionTell() {
  const kinds = attentionKinds(), s = kinds.join(',');
  if (s === _attentionLast) return;
  _attentionLast = s;
  const msg = { type: 'doca.attention', kinds };
  try { window.chrome?.webview?.postMessage(msg); } catch { /* not a WebView2 host */ }
  try { window.DocaDevice?.attention?.(JSON.stringify(msg)); } catch { /* an app without it */ }
}

(function attentionStart() {
  if (typeof window === 'undefined' || window !== window.top || !(window.chrome?.webview || window.DocaDevice)) return;
  const start = () => {
    attentionTell();
    new MutationObserver(attentionTell).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'type'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
