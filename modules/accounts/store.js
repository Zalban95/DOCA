'use strict';

/**
 * A person's own accounts (the owner, 2026-10-12: "each person connects their own Google / Microsoft 365 accounts — as
 * many as they need"). Two halves, kept apart on purpose:
 *   - the record, in the store document `accounts` (DATA_DIR): { id, personId, provider, account, access, scopes,
 *     orchestrator, label, connectedAt, reading, cursor } — nothing secret, read by the page through `view()`;
 *   - its tokens, in DATA_DIR/keys/accounts.json (the protected keys folder, 0600, keys-file.js), keyed by person then
 *     account: { accessToken, refreshToken, expiresAt }. No route returns them; an admin reads nobody's.
 * `orchestrator` is the check "the Orchestrator may use it": on by default, the person's to change. Every function takes
 * whose it is first, so no caller reaches an account by its id alone.
 */
const crypto = require('crypto');
const path = require('path');
const store = require('../store');

const DOC = 'accounts';
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const keysFile = () => path.join(path.dirname(require('../paths').CONNECTOR_KEYS_FILE), 'accounts.json');
const keys = () => require('../keys-file').read(keysFile());
const writeKeys = d => require('../keys-file').write(keysFile(), d);

const rows = () => store.readJson(DOC, { accounts: [] }).accounts || [];
const save = list => store.writeJson(DOC, { accounts: list });

/** This person's accounts, oldest first. */
const list = personId => (personId ? rows().filter(a => a.personId === personId) : []);
/** One of this person's accounts, or null — never another person's. */
const get = (personId, id) => list(personId).find(a => a.id === id) || null;

/** A new connection: the record and its tokens. One account connected again replaces its old tokens, keeps its settings. */
function add(personId, { provider, account, access, scopes }, tokens) {
  if (!personId) throw bad('Sign in first.', 401);
  const all = rows();
  const same = all.find(a => a.personId === personId && a.provider === provider && account && a.account === account);
  const rec = same ? { ...same, access, scopes: tokens.scopes || scopes, connectedAt: new Date().toISOString() }
    : { id: `acc_${crypto.randomBytes(5).toString('hex')}`, personId, provider, account: account || null, access, scopes: tokens.scopes || scopes,
      orchestrator: true, label: '', connectedAt: new Date().toISOString(), reading: { mode: 'off' }, cursor: null };
  save(same ? all.map(a => (a.id === same.id ? rec : a)) : [...all, rec]);
  const k = keys();
  k[personId] = { ...(k[personId] || {}), [rec.id]: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || k[personId]?.[rec.id]?.refreshToken || null,
    expiresAt: tokens.expiresAt || null } };
  writeKeys(k);
  return rec;
}

/** Change what may change: the label, the Orchestrator's check, when the mail reader reads, the change cursor. */
function patch(personId, id, fields) {
  const rec = get(personId, id);
  if (!rec) throw bad('No such account.', 404);
  const next = { ...rec };
  if (typeof fields.label === 'string') next.label = fields.label.trim().slice(0, 60);
  if (typeof fields.orchestrator === 'boolean') next.orchestrator = fields.orchestrator;
  if (fields.reading) next.reading = fields.reading;
  if ('cursor' in fields) next.cursor = fields.cursor;
  save(rows().map(a => (a.id === id && a.personId === personId ? next : a)));
  return next;
}

/** Disconnect: the record and its tokens go. */
function remove(personId, id) {
  if (!get(personId, id)) throw bad('No such account.', 404);
  save(rows().filter(a => !(a.id === id && a.personId === personId)));
  const k = keys();
  if (k[personId]) { delete k[personId][id]; if (!Object.keys(k[personId]).length) delete k[personId]; writeKeys(k); }
  return { removed: id };
}

const secretOf = (personId, id) => keys()[personId]?.[id] || null;

/** A live access token, refreshed a minute before it expires with the hive's app (Field → Connectors). */
async function token(personId, id) {
  const rec = get(personId, id), sec = secretOf(personId, id);
  if (!rec || !sec?.accessToken) throw bad('That account is not connected.', 409);
  if (sec.expiresAt && Date.parse(sec.expiresAt) - Date.now() < 60000) {
    if (!sec.refreshToken) throw bad(`The sign-in to ${rec.account || rec.provider} expired: connect it again in Field → Connectors → Your accounts.`, 401);
    const oauth = require('../connectors/oauth');
    const fresh = await oauth.exchange(oauth.spec(rec.provider), require('../connectors/vault').get(rec.provider) || {}, { grant_type: 'refresh_token', refresh_token: sec.refreshToken });
    const k = keys();
    k[personId][id] = { ...sec, ...fresh, refreshToken: fresh.refreshToken || sec.refreshToken };
    writeKeys(k);
    return fresh.accessToken;
  }
  return sec.accessToken;
}

/** What a page may see: never a token. */
function view(rec) {
  const sec = secretOf(rec.personId, rec.id);
  return { id: rec.id, provider: rec.provider, providerLabel: require('./scopes').PROVIDERS[rec.provider]?.label || rec.provider, account: rec.account,
    label: rec.label || '', access: rec.access, can: require('./scopes').can(rec), orchestrator: rec.orchestrator !== false, connectedAt: rec.connectedAt,
    connected: !!sec?.accessToken, refreshable: !!sec?.refreshToken, reading: rec.reading || { mode: 'off' } };
}

/** Whether anyone here has connected an account (the tools are offered only then: turn/tool-shape.js). */
const any = () => rows().length > 0;

module.exports = { list, get, add, patch, remove, token, view, any, keysFile };
