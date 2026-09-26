'use strict';

/**
 * DOCA's model providers and their API keys, in DOCA's own file.
 *
 * They lived in OpenClaw's config (~/.openclaw/openclaw.json), so an install
 * with no OpenClaw still made a `.openclaw` folder to keep its credentials in
 * another product's file — inside HOME, where the agent's file tools could
 * read them (ISSUES.md H-19). Now:
 *
 *   - DOCA keeps them in `<DATA_DIR>/keys/providers.json`, mode 0600, which
 *     the file tools refuse (paths.PROTECTED_FILES) and a backup carries.
 *   - OpenClaw's file is still *read*, as a source of providers, when it
 *     exists; DOCA's entry wins where both name one. A provider removed in
 *     DOCA is remembered as removed, so OpenClaw's copy does not bring it back.
 *   - It is *written* only when OpenClaw is installed, so OpenClaw keeps
 *     seeing the keys it was given here (decided 2026-09-26: keep the two in
 *     agreement where both exist; never create OpenClaw's file where it does not).
 *   - The first read copies what OpenClaw's file has, once.
 *
 * Shape (the same as openclaw.json's `models.providers`, so the two agree):
 *   { providers: { [id]: { baseUrl, apiKey, api, models } }, removed: [id] }
 */
const fs   = require('fs');
const path = require('path');

const { PROVIDER_KEYS_FILE, CONFIG_PATH, COMPOSE_DIR } = require('./paths');

function readOwn() {
  try { return JSON.parse(fs.readFileSync(PROVIDER_KEYS_FILE, 'utf8')); } catch { return null; }
}

function writeOwn(doc) {
  fs.mkdirSync(path.dirname(PROVIDER_KEYS_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${PROVIDER_KEYS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, PROVIDER_KEYS_FILE);
  fs.chmodSync(PROVIDER_KEYS_FILE, 0o600);
}

/** OpenClaw's providers, or {} — a file that does not parse is read as none, never rewritten. */
function openclawProviders() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))?.models?.providers || {}; } catch { return {}; }
}

/** OpenClaw is here: its compose file, as the catalogue detects it. */
function openclawInstalled() {
  return fs.existsSync(path.join(COMPOSE_DIR, 'docker-compose.yml'));
}

/** DOCA's document, made from OpenClaw's providers the first time. */
function own() {
  let doc = readOwn();
  if (!doc) {
    doc = { providers: { ...openclawProviders() }, removed: [], migratedAt: new Date().toISOString() };
    writeOwn(doc);
  }
  doc.providers ||= {};
  doc.removed ||= [];
  return doc;
}

/** Every provider: OpenClaw's (when it has a file) under DOCA's own; removed ones left out. */
function all() {
  const doc = own();
  const merged = { ...openclawProviders(), ...doc.providers };
  for (const id of doc.removed) if (!doc.providers[id]) delete merged[id];
  return merged;
}

function get(id) { return all()[id] || null; }

/** Keep OpenClaw's file in agreement — only where OpenClaw is installed. */
function mirror(id, entry) {
  if (!openclawInstalled()) return false;
  const { loadConfig, saveConfig } = require('./utils');
  let cfg;
  try { cfg = loadConfig(); } catch { return false; }   // a file that does not parse is not ours to replace
  cfg.models ||= {};
  cfg.models.providers ||= {};
  if (entry) cfg.models.providers[id] = entry; else delete cfg.models.providers[id];
  saveConfig(cfg);
  return true;
}

/** Create or change one provider (fields merged over what it had). */
function set(id, patch) {
  if (!id) throw Object.assign(new Error('provider required'), { status: 400 });
  const doc = own();
  const entry = { models: [], ...(all()[id] || {}), ...doc.providers[id], ...patch };
  doc.providers[id] = entry;
  doc.removed = doc.removed.filter(x => x !== id);
  writeOwn(doc);
  mirror(id, entry);
  return entry;
}

function remove(id) {
  if (!all()[id]) return false;
  const doc = own();
  delete doc.providers[id];
  if (!doc.removed.includes(id)) doc.removed.push(id);
  writeOwn(doc);
  mirror(id, null);
  return true;
}

module.exports = { all, get, set, remove, openclawInstalled, FILE: PROVIDER_KEYS_FILE };
