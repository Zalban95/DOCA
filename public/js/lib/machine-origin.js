/* Who started a machine, on every place it is drawn (asked 2026-10-08: "I started the VMs manually, log the actions so
   there is no confusion"): "started by <the person's name> from <the screen's or device's name>, 2 h ago" (both read from their records), "started by an agent in the
   conversation …", or "started outside DOCA" for one running that no noted act started (modules/machines/origin.js).
   The rows' endpoint carries the line for every machine, and for the services, llama.cpp and MCP servers beside them;
   the tabs read it from here, kept a few seconds like the rows themselves. */
let _machineOrigins = { at: 0, rows: [], others: {} };

function machineAgo(at) {
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
}

/** Keep the lines from a rows answer the page already has (the status column), or read them at most every 5 s. */
function machineOriginsKeep(data) { _machineOrigins = { at: Date.now(), rows: data?.rows || [], others: data?.origins || {} }; }
async function machineOriginsLoad() {
  if (Date.now() - _machineOrigins.at < 5000) return;
  try { machineOriginsKeep(await apiFetch('/api/machines/rows')); } catch { _machineOrigins.at = Date.now(); }
}

/** The line as text, or ''. `o`: an origin from the hub; else found by kind and id (a container by id or name). */
function machineOriginText(o) {
  return o?.text ? `${o.text}${o.at ? `, ${machineAgo(o.at)}` : ''}` : '';
}
function machineOriginFind(kind, id) {
  const r = _machineOrigins.rows.find(x => x.kind === kind && (x.id === id || x.name === id || (kind === 'container' && String(x.id).startsWith(String(id).slice(0, 12)))));
  return r?.origin || _machineOrigins.others[`${kind}:${id}`] || null;
}
function machineOriginHtml(kind, id, o = null) {
  const found = o || machineOriginFind(kind, id), t = machineOriginText(found);
  return t ? `<div class="m-origin${found.outside ? ' outside' : ''}" title="Who started it (Agents → Chronicle → Hub keeps every act)">${escHtml(t)}</div>` : '';
}

/** Fill a placeholder a row already has (a service's or a llama.cpp server's header) with its line. */
function machineOriginFill(el, kind, id) {
  if (!el) return;
  const o = machineOriginFind(kind, id);
  el.textContent = machineOriginText(o);
  el.classList.toggle('outside', !!o?.outside);
}
