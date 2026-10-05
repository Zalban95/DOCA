/* DOCA in this browser — the popup: pairing, and the person's consent per site (the browser's own permission). */
const ext = globalThis.browser || globalThis.chrome;
const $ = id => document.getElementById(id);
const ask = m => ext.runtime.sendMessage(m);
const originOf = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } };

async function draw() {
  const s = await ask({ type: 'status' });
  $('unpaired').hidden = !!s.paired;
  $('paired').hidden = !s.paired;
  if (!s.paired) return;
  $('dot').className = `dot${s.connected ? ' on' : ''}`;
  $('state').textContent = `${s.name || 'This browser'} — ${s.connected ? `connected to ${s.hub}` : `not connected to ${s.hub}`}${s.paused ? ' (paused)' : ''}`;
  $('err').textContent = s.lastError || '';
  $('pause').checked = !!s.paused;
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const origin = tab && originOf(tab.url);
  const allowed = origin ? await ext.permissions.contains({ origins: [`${origin}/*`] }) : false;
  $('site').textContent = origin || 'This page cannot be used';
  $('allow').hidden = !origin;
  $('allow').textContent = allowed ? 'Stop letting DOCA use it' : 'Let DOCA use this site';
  $('allow').onclick = async () => {
    if (allowed) await ext.permissions.remove({ origins: [`${origin}/*`] });
    else await ext.permissions.request({ origins: [`${origin}/*`] });   // the browser asks the person, in its own words
    draw();
  };
  const hubOrigin = originOf(s.hub);
  const { origins = [] } = await ext.permissions.getAll();
  $('sites').innerHTML = '';
  for (const o of origins.filter(o => o.replace(/\/\*$/, '') !== hubOrigin)) {
    const li = document.createElement('li');
    li.textContent = o.replace(/\/\*$/, '');
    const b = document.createElement('button');
    b.textContent = 'Remove';
    b.onclick = async () => { await ext.permissions.remove({ origins: [o] }); draw(); };
    li.append(b);
    $('sites').append(li);
  }
  if (!$('sites').children.length) $('sites').innerHTML = '<li>None yet.</li>';
}

$('pair').onclick = async () => {
  $('pair-err').textContent = '';
  let hub = $('hub').value.trim();
  const link = /^doca:\/\/pair\?(.+)$/.exec(hub);
  const hubOrigin = link ? `https://${new URLSearchParams(link[1]).get('host')}` : originOf(hub);
  if (!hubOrigin) { $('pair-err').textContent = 'The pairing link, or the hub\'s https address.'; return; }
  // The hub's own address is a site too: talking to it needs the person's yes, like any other.
  if (!(await ext.permissions.request({ origins: [`${hubOrigin}/*`] }))) { $('pair-err').textContent = 'The browser needs your permission to reach the hub.'; return; }
  const r = await ask({ type: 'pair', hub, code: $('code').value, name: $('name').value.trim() || 'Browser' });
  if (r && r.error) $('pair-err').textContent = `${r.error}. If the hub has a self-signed certificate, open ${hubOrigin} in this browser once and accept it.`;
  draw();
};
$('pause').onchange = async () => { await ask({ type: 'pause', on: $('pause').checked }); draw(); };
$('forget').onclick = async () => { await ask({ type: 'forget' }); draw(); };
draw();
