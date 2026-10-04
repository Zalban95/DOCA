'use strict';

/**
 * Which implementation holds the accounts. The database when it is SQLite —
 * synchronous, like every caller of auth/store.js expects — and the JSON files
 * when PostgreSQL is configured (its driver is asynchronous) or
 * DOCA_AUTH_BACKEND=json asks for them (the contract test runs both).
 */
let _impl = null;
function get() {
  if (_impl) return _impl;
  const want = process.env.DOCA_AUTH_BACKEND;
  const sql = want !== 'json' && !process.env.DOCA_DB_URL;
  _impl = sql ? require('./accounts-sql') : require('./accounts-json');
  return _impl;
}
module.exports = { get, _reset: () => { _impl = null; } };
