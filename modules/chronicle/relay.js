'use strict';

/**
 * Chronicle's source `relay` (relay/serve.js): each request through the model relay, from the usage ledger — when,
 * where it came from (`relay:computer:<id>`, `relay:device:<id>`, with that machine's name), for whom, which model and
 * how many tokens — never a word of it. The owner's, 2026-10-14: work a paired device or a computer does through the
 * relay carries its tag, so a leak or misuse is traced to it. A host sees every request; anyone else their own.
 */
function lines(person, f, limit, host) {
  const where = ["tenant_id = 'local'", "kind = 'relay'"], args = [];
  if (f.from) { where.push('at >= ?'); args.push(String(f.from)); }
  if (f.to) { where.push('at <= ?'); args.push(String(f.to)); }
  if (!host) { where.push('person_id = ?'); args.push(person?.id || '-'); }
  let rows = [];
  try { rows = require('../db').syncHandle()?.prepare(`SELECT * FROM usage WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT 3000`).all(...args) || []; } catch { /* no database */ }
  const names = new Map(), who = new Map();
  const nameOf = tag => {
    if (!names.has(tag)) {
      const [, kind, id] = String(tag || '').split(':');
      let n = null;
      try { n = kind === 'device' ? require('../api-v1/devices').get(id)?.name : kind === 'computer' ? require('../computers').get(id)?.name : null; } catch { /* gone */ }
      names.set(tag, n);
    }
    return names.get(tag);
  };
  const personOf = id => { if (!id) return null; if (!who.has(id)) { const u = require('../auth/store').userById(id); who.set(id, u ? (u.name || u.email || id) : id); } return who.get(id); };
  const q = String(f.q || '').trim().toLowerCase();
  const out = rows.map(r => {
    const name = nameOf(r.agent), p = personOf(r.person_id);
    const text = `${r.agent || 'relay'}${name ? ` (${name})` : ''}${p ? ` · for ${p}` : ''} · ${r.provider || '?'}/${r.model || '?'} · ${Number(r.prompt) || 0} in, ${Number(r.completion) || 0} out${r.source === 'provider' ? '' : ' (estimated)'}`;
    return { source: 'relay', at: r.at, level: 'info', text, via: r.agent || null, person: r.person_id ? { id: r.person_id, name: p } : null, sessionId: r.session_id || null };
  }).filter(r => (!f.state || r.level === f.state) && (!f.person || r.person?.id === f.person) && (!q || r.text.toLowerCase().includes(q)));
  return { rows: out.slice(0, limit), total: out.length, totals: { tokens: rows.reduce((n, r) => n + (Number(r.prompt) || 0) + (Number(r.completion) || 0), 0) } };
}

module.exports = { lines };
