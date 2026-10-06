'use strict';

/**
 * A service the agent prepared for a person to switch on (asked 2026-10-06: "is the dashboard+harness able to add any
 * service … without needing to change the code, and in a more comfortable way than doing all from scratch?").
 *
 * The agent reads the service's own documentation (research_docs), then drafts everything but the secret: how the key
 * is sent (`service-keys.js`: a header, a parameter, or id:secret traded for a token), the service's address, what it
 * is for, and a skill — the steps an agent follows to use it (submit, wait, keep, show), in plain markdown. The draft
 * waits in Settings → Connectors → "Prepared by the agent": the person reads it, pastes the key, and one Save writes
 * the key (to the protected keys file) and the skill. Nothing is used before that, the agent never holds the secret,
 * and no code is written — an MCP server is drafted the same way by mcp/drafts.js.
 */
const crypto = require('crypto');
const docs = () => require('./db/docs');
const KEY = 'service-drafts';
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const all = () => docs().getDoc(KEY, { drafts: [] }).drafts || [];
const keep = list => docs().setDoc(KEY, { drafts: list.slice(-20) });

function draft({ name, origin, place = 'header', field, prefix, note, docs: source, skill }, by = {}) {
  name = String(name || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw bad('name: short, lowercase letters, digits and dashes (hyper3d, weather-api).');
  let o;
  try { o = new URL(String(origin || '')).origin; } catch { throw bad('origin: the API\'s address, like https://api.example.com.'); }
  if (!['header', 'query', 'exchange'].includes(place)) throw bad('place: header, query or exchange.');
  if (place === 'exchange') { try { if (new URL(String(field)).origin !== o) throw new Error(); } catch { throw bad('For exchange, field is the token address on the same origin.'); } }
  const sk = skill && typeof skill === 'object' ? skill : null;
  if (sk && (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(sk.name || '')) || !String(sk.body || '').trim()))
    throw bad('skill: {name (lowercase-dashes), description (when to use it), body (the steps, markdown)}.');
  const d = { id: `svc_${crypto.randomBytes(4).toString('hex')}`, name, origin: o, place,
    field: field ? String(field).slice(0, 300) : null, prefix: prefix === undefined || prefix === null ? null : String(prefix).slice(0, 30),
    note: String(note || '').slice(0, 200), docs: String(source || '').slice(0, 300),
    skill: sk ? { name: String(sk.name), description: String(sk.description || '').slice(0, 400), body: String(sk.body).slice(0, 20000) } : null,
    by: by.sessionId || null, at: new Date().toISOString() };
  keep([...all().filter(x => x.name !== name), d]);
  return d;
}

/** The person's Save: the key into the protected file, the skill into the skills — then the draft is gone. */
function accept(id, { key, who } = {}) {
  const d = all().find(x => x.id === id);
  if (!d) throw bad('No such draft.', 404);
  const saved = require('./service-keys').save({ name: d.name, origin: d.origin, place: d.place, field: d.field || undefined,
    prefix: d.prefix ?? undefined, who: who === 'everyone' ? 'everyone' : 'host', note: d.note, key });
  let skill = null;
  if (d.skill) {
    const skills = require('./harness/skills');
    if (skills.list().some(s => s.name === d.skill.name && s.source !== 'local')) throw bad(`A shipped skill is called "${d.skill.name}": the draft cannot replace it.`, 409);
    skill = skills.write(d.skill.name, { description: d.skill.description, body: d.skill.body });
  }
  keep(all().filter(x => x.id !== id));
  return { key: saved, skill: skill ? d.skill.name : null };
}

function remove(id) { const before = all().length; keep(all().filter(x => x.id !== id)); return { removed: before !== all().length }; }

function mount(app) {
  const h = fn => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/connectors/drafts/all', h(() => ({ drafts: all() })));
  app.post('/api/connectors/drafts/:id/accept', h(req => accept(req.params.id, req.body || {})));
  app.delete('/api/connectors/drafts/:id', h(req => remove(req.params.id)));
}

module.exports = { all, draft, accept, remove, mount };
