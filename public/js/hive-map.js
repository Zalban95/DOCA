/* Machines → Map (modules/machines/map.js; R16, "Draw my hive"): the hive as one picture from its own records — people,
   their devices, this hub, the machines, the models and services, the things around — each a box in its column with a
   point for its state, and a line for every relation a record names (paired, hosts, uses, sees). Drawn here as SVG,
   from data only: no model words or arranges it. Refreshed while shown, every 30 s; nothing is kept. */
let _hmTimer = null;

function hiveMapTab(shown) {
  clearInterval(_hmTimer); _hmTimer = null;
  if (!shown) return;
  hiveMapLoad();
  _hmTimer = setInterval(() => { if (document.visibilityState === 'visible') hiveMapLoad(); }, 30000);
}

async function hiveMapLoad() {
  const page = document.getElementById('tab-map');
  if (!page) return;
  if (!page.querySelector('.hm-wrap')) page.innerHTML = `${pageHeadHtml({ title: 'Map', sub: 'Your hive as one picture, drawn from what DOCA records: people and their devices, this hub, the machines, the models and services it uses, and the things saved around you.',
    actions: '<button class="btn btn-sm" onclick="hiveMapLoad()">Refresh</button>' })}<div class="card hm-wrap" style="overflow-x:auto"><div class="placeholder pulse">Drawing…</div></div>`;
  let d;
  try { d = await apiFetch('/api/machines/map'); } catch (e) { page.querySelector('.hm-wrap').innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  page.querySelector('.hm-wrap').innerHTML = hiveMapSvg(d);
}

const _HM_ICON = { hub: '⬢', person: '☺', phone: '📱', watch: '⌚', desktop: '🖥', channel: '💬', agent: '⚙', container: '▣', computer: '🖵', vm: '◫', vnc: '▭',
  model: '◆', mcp: '⇄', connector: '⚿', service: '☁', tv: '📺', speaker: '🔊', printer: '🖨', light: '💡' };

/**
 * The SVG: people and devices on the left, the hub in the middle, and everything the hub reaches — machines, models and
 * services, the things around — stacked on the right under their headings, so every line from the hub is short and none
 * crosses a column. A device's own links (a server it hosts, a thing it saw) cross the hub's column, dashed.
 */
function hiveMapSvg(d) {
  const W = 200, H = 46, GAP = 12, COLW = 260, TOP = 40, HEAD = 26;
  const label = Object.fromEntries(d.columns.map(c => [c.id, c.label]));
  const left = ['people', 'devices'].filter(c => label[c]);
  const right = ['machines', 'field', 'around'].filter(c => label[c]);
  const xOf = { hub: 20 + left.length * COLW };
  left.forEach((c, i) => { xOf[c] = 20 + i * COLW; });
  const rx = xOf.hub + COLW;
  const pos = {}, heads = [];
  for (const c of left) d.nodes.filter(n => n.col === c).forEach((n, i) => { pos[n.id] = { x: xOf[c], y: TOP + i * (H + GAP), n }; });
  let y = TOP - HEAD;
  for (const c of right) {
    heads.push({ x: rx, y: y + 16, text: label[c] });
    y += HEAD;
    for (const n of d.nodes.filter(m => m.col === c)) { pos[n.id] = { x: rx, y, n }; y += H + GAP; }
    y += 8;
  }
  const bottom = Math.max(y, ...Object.values(pos).map(p => p.y + H)) + 10;
  const height = Math.max(bottom, 200);
  const hubNode = d.nodes.find(n => n.col === 'hub');
  if (hubNode) pos[hubNode.id] = { x: xOf.hub, y: TOP, n: hubNode };   // level with people and devices: the first thing seen
  const width = rx + W + 20;
  const esc = s => escHtml(String(s ?? ''));
  const line = l => {
    const a = pos[l.from], b = pos[l.to];
    if (!a || !b) return '';
    const [p1, p2] = a.x <= b.x ? [a, b] : [b, a];
    const x1 = p1.x + W, y1 = p1.y + H / 2, x2 = p2.x, y2 = p2.y + H / 2, mx = (x1 + x2) / 2;
    const far = p2.x - p1.x > COLW + 1;   // a device's own link, past the hub
    return `<path d="M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="var(--border2)" stroke-width="1.2"${far ? ' stroke-dasharray="4 4"' : ''}><title>${esc(`${a.n.label} — ${l.label || 'linked'} — ${b.n.label}`)}</title></path>`;
  };
  const box = p => { const n = p.n;
    const dot = n.up === true ? 'var(--green)' : n.up === false ? 'var(--muted)' : 'var(--accent, var(--amber))';
    return `<g><rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="8" fill="var(--surface)" stroke="${n.kind === 'hub' ? 'var(--amber)' : 'var(--border)'}"/>
      <circle cx="${p.x + 12}" cy="${p.y + 14}" r="4" fill="${dot}"/>
      <text x="${p.x + 22}" y="${p.y + 18}" font-size="12" fill="var(--bright)">${esc(`${_HM_ICON[n.kind] || '•'} ${n.label}`.slice(0, 24))}</text>
      <text x="${p.x + 12}" y="${p.y + 35}" font-size="10.5" fill="var(--muted)">${esc(String(n.detail || n.kind).slice(0, 28))}</text>
      <title>${esc(`${n.label}\n${n.detail || n.kind}`)}</title></g>`; };
  const colHeads = [...left.map(c => ({ x: xOf[c], y: 22, text: label[c] })), ...(hubNode ? [{ x: xOf.hub, y: 22, text: label.hub || 'Hub' }] : []), ...heads];
  return `<svg class="hm-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Your hive: ${d.nodes.length} parts">
    ${colHeads.map(h => `<text x="${h.x}" y="${h.y}" font-size="11" letter-spacing="1.5" fill="var(--muted)">${esc(h.text.toUpperCase())}</text>`).join('')}
    ${d.links.map(line).join('')}${Object.values(pos).map(box).join('')}</svg>
    <p class="desc" style="margin-top:8px">${d.nodes.length} parts, ${d.links.length} links · drawn ${esc(new Date(d.at).toLocaleTimeString())}. Lines: paired, hosts, uses, sees — each from a record; dashed, a device's own.</p>`;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-map' });
  document.getElementById('tab-settings')?.before(page);
});
