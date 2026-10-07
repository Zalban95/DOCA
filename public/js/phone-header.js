/* ═══════════════════════════════════════════════════════
   A phone's header (wave E, des 11): the search is an icon that opens over the header (css/system.css), and the two
   header buttons that crowded it — ⧉ this page alone (solo.js) and 📱 this hub on another device (settings/network.js)
   — are the first row of the ☰ drawer instead. On a wider screen the row is hidden and the header keeps them.
   ═══════════════════════════════════════════════════════ */

function phoneActsRender() {
  const side = document.querySelector('.sidebar');
  if (!side || document.getElementById('phone-acts')) return;
  const row = Object.assign(document.createElement('div'), { id: 'phone-acts', className: 'sidebar-section phone-acts' });
  const add = (label, title, fn) => {
    if (typeof fn !== 'function') return;
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-sm', textContent: label, title });
    b.onclick = () => { if (typeof closeSidebar === 'function') closeSidebar(); fn(); };
    row.append(b);
  };
  add('This page alone', 'Open this page by itself — for a screen of its own', typeof soloOpen === 'function' ? soloOpen : null);
  add('Open on another device', 'QR codes to this hub', typeof hubLinksOpen === 'function' ? hubLinksOpen : null);
  if (row.children.length) side.prepend(row);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') window.addEventListener('load', () => {
  if (document.getElementById('chat-fab')) phoneActsRender();   // the panel only, not a page served alone
});
