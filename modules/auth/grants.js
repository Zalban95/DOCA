'use strict';

/**
 * Grants: exceptions to a level, recorded (docs/design/permissions.md §2–3).
 *
 * A grant gives a subject — a user, a specialist type, a mission, a session —
 * one permission:
 *   tool:<name> or tool:<name>:<verb>   e.g. tool:shell, tool:shell:git (tool:shell covers every verb)
 *   approve:<tool>[:<verb>]             a call of that kind runs without asking ("always" on an ask level)
 *   setting:<prefix>                    a settings prefix the subject may change or apply
 *   path:<absolute real path>           a folder (and below) the subject's tools may reach
 *   use:<kind>:<id>                     a resource allotted: a model (provider/model), provider, key, connector, login,
 *                                       computer, service or device (allot.js; CONSTITUTION S13)
 *
 * Who may give one — decided with Al 2026-10-04:
 *   - a person whose level holds `delegate` (admin and owner do), to a person
 *     of their own level or below, or to a specialist;
 *   - an agent (the Orchestrator, a work chat) to the specialist or mission it
 *     dispatched, scope `mission`;
 *   and never beyond what the giver holds themselves (permits.holds). The rules
 *   (charter, protected files, NEVER tools) are not grantable: permits() checks
 *   them before any grant is read.
 */
const crypto = require('crypto');

const KINDS = ['user', 'specialist', 'mission', 'session'];
const SCOPES = ['permanent', 'session', 'mission'];
const PERM = /^(tool|approve):[\w.*-]+(:[\w.*\/-]+)?$|^setting:[\w.*-]+$|^path:.+$|^use:(model|provider|key|connector|login|computer|service|device):[\w.*\/:@-]+$/;

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const raw = () => require('../db').syncHandle();
const now = () => new Date().toISOString();
const row = r => ({ id: r.id, subject: { kind: r.subject_kind, id: r.subject_id }, permission: r.permission, scope: r.scope,
  by: { kind: r.by_kind, id: r.by_id, user: r.by_user || null }, createdAt: r.created_at, expiresAt: r.expires_at || null,
  revokedAt: r.revoked_at || null, note: r.note || '' });

/** Does a granted permission cover a wanted one? tool:shell covers tool:shell:git; '*' parts cover anything; a path covers below it. */
function covers(granted, wanted) {
  if (granted === wanted) return true;
  const [gk, ...gr] = granted.split(':'), [wk, ...wr] = wanted.split(':');
  if (gk !== wk) return false;
  const g = gr.join(':'), w = wr.join(':');
  if (gk === 'path') {
    const fold = s => (process.platform === 'win32' ? s.toLowerCase() : s);
    return fold(w) === fold(g) || fold(w).startsWith(fold(g).replace(/[\\/]+$/, '') + require('path').sep);
  }
  if (gk === 'setting') return g === '*' || w === g || w.startsWith(`${g}.`);
  if (gk === 'use') {   // use:<kind>:<id>, the id may itself hold ':' or '/'
    const [gkind, ...gid] = gr, [wkind, ...wid] = wr, a = gid.join(':'), b = wid.join(':');
    return (gkind === '*' || gkind === wkind) && (a === '*' || a === b || (a.endsWith('*') && b.startsWith(a.slice(0, -1))));
  }
  const [gt, gv] = g.split(':'), [wt, wv] = w.split(':');
  const part = (a, b) => a === '*' || a === b || (a.endsWith('*') && String(b).startsWith(a.slice(0, -1)));
  return part(gt, wt) && (gv === undefined || part(gv, wv));
}

/** Active grants for any of these subjects. */
function forSubjects(subjects) {
  const r = raw();
  const list = subjects.filter(Boolean);
  if (!r || !list.length) return [];
  const t = now();
  return list.flatMap(s => r.prepare(`SELECT * FROM grants WHERE tenant_id = 'local' AND subject_kind = ? AND subject_id = ?
    AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`).all(s.kind, String(s.id), t)).map(row);
}

/** True when one of the subjects holds a grant covering `wanted`. */
function holds(subjects, wanted) { return forSubjects(subjects).some(g => covers(g.permission, wanted)); }

function list({ subjectKind, subjectId, all = false } = {}) {
  const r = raw();
  if (!r) return [];
  const where = ["tenant_id = 'local'"], args = [];
  if (subjectKind) { where.push('subject_kind = ?'); args.push(subjectKind); }
  if (subjectId) { where.push('subject_id = ?'); args.push(String(subjectId)); }
  if (!all) { where.push('revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)'); args.push(now()); }
  return r.prepare(`SELECT * FROM grants WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`).all(...args).map(row);
}

/**
 * Record a grant. Authority is checked by the caller's route or tool through
 * permits.mayGrant — this only stores a well-formed one and refuses the rest.
 */
function create({ subject, permission, scope = 'permanent', by, expiresAt = null, note = '' }) {
  const r = raw();
  if (!r) throw bad('Grants need the SQLite database; with PostgreSQL they are not available yet.', 501);
  if (!KINDS.includes(subject?.kind) || !subject.id) throw bad(`A grant is to a ${KINDS.join(', ')}, with its id.`);
  if (!PERM.test(String(permission || ''))) throw bad('A permission is tool:<name>[:<verb>], approve:<tool>[:<verb>], setting:<prefix>, path:<folder> or use:<model|provider|key|connector|login|computer|service|device>:<id>.');
  if (!SCOPES.includes(scope)) throw bad(`scope is ${SCOPES.join(', ')}.`);
  const g = { id: `grt_${crypto.randomBytes(6).toString('hex')}`, at: now() };
  r.prepare(`INSERT INTO grants (id, subject_kind, subject_id, permission, scope, by_kind, by_id, by_user, created_at, expires_at, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(g.id, subject.kind, String(subject.id), permission, scope, by.kind, String(by.id), by.user || null, g.at,
    expiresAt || null, String(note || '').slice(0, 300));
  return row(r.prepare("SELECT * FROM grants WHERE tenant_id = 'local' AND id = ?").get(g.id));
}

function revoke(id) {
  const r = raw();
  const cur = r?.prepare("SELECT * FROM grants WHERE tenant_id = 'local' AND id = ?").get(String(id));
  if (!cur) throw bad(`No grant ${id}.`, 404);
  r.prepare("UPDATE grants SET revoked_at = ? WHERE tenant_id = 'local' AND id = ?").run(now(), id);
  return row({ ...cur, revoked_at: now() });
}

/** A grant by id, active or not. */
function get(id) {
  const r = raw()?.prepare("SELECT * FROM grants WHERE tenant_id = 'local' AND id = ?").get(String(id));
  return r ? row(r) : null;
}

module.exports = { covers, forSubjects, holds, list, create, revoke, get, KINDS, SCOPES };
