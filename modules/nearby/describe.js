'use strict';

/**
 * Nearby's things in words, for the agent: what each can do and how (its own facts — a name, a control URL, an
 * address), one line per thing for the `nearby` tool, and one compact group of the saved ones for "What you have"
 * (turn/fits.js), which is re-sent every step and so stays short. Fixed templates filled with data; no model.
 */

/** How to use each ability, in one short clause — the facts are the thing's own (its name, its control URL). */
function howTo(t) {
  const h = t.how || {}, out = [];
  if (t.can?.includes('cast')) out.push(`cast: \`catt -d "${h.cast?.name || t.name}" cast <url>\` with shell${h.cast?.ip ? ` (or -d ${h.cast.ip})` : ''}`);
  if (h.dlna?.control) out.push(`DLNA: AVTransport at ${h.dlna.control} (SetAVTransportURI, then Play)`);
  if (h.airplay?.ip) out.push(`AirPlay at ${h.airplay.ip}`);
  if (h.print?.url) out.push(`print: ${h.print.url}`);
  if (h.ssh?.host) out.push(`ssh ${h.ssh.host}${h.ssh.port && h.ssh.port !== 22 ? ` -p ${h.ssh.port}` : ''}`);
  if (h.ha?.entity) out.push(`Home Assistant ${h.ha.entity} (its MCP server)`);
  if (t.web) out.push(`page ${t.web} (http_fetch, canvas)`);
  if (t.can?.includes('bluetooth-audio')) out.push('Bluetooth audio — pairing is the person\'s, in Machines → Nearby');
  return out.join('; ');
}

const where = t => (t.place ? ` — ${t.place}${t.room ? ` → ${t.room}` : ''}` : '');
const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 2 ? 'just now' : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

/** "from the hub 2 min ago, from Al's desk 3 h ago" — who saw it (cast-reach.md §1.2). */
const seenFrom = t => (t.seenFrom || []).map(x => `from ${x.by === 'hub' ? 'the hub' : x.label || x.by} ${ago(x.at)}`).join(', ');

function line(t) {
  const how = howTo(t);
  const from = seenFrom(t);
  return `- ${t.name}${where(t)} (${t.kind}${t.model ? `, ${t.model}` : ''}${t.addresses?.length ? `, ${t.addresses.slice(0, 2).join(', ')}` : ''}; seen ${from || ago(t.lastSeen)} by ${(t.sources || []).join(', ') || '—'})${how ? `: ${how}` : ''}`;
}

/** The saved things in one compact group, for "What you have" (turn/fits.js): re-sent each step, so short. */
function inventory(max = 12) {
  const saved = require('./store').saved();
  if (!saved.length) return '';
  const short = t => { const can = (t.can || []).filter(c => !['bluetooth', 'tailnet'].includes(c)); return `${t.name}${where(t)}${can.length ? ` [${can.join(', ')}]` : ''}`; };
  return `- Things nearby, saved (\`nearby\` list says how to use each): ${saved.slice(0, max).map(short).join('; ')}${saved.length > max ? `; and ${saved.length - max} more` : ''}.`;
}

module.exports = { howTo, where, ago, line, inventory, seenFrom };
