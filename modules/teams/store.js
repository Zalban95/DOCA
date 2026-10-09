'use strict';

/**
 * Where teams are kept: one document per team (`teams/<id>`) and a small index (`teams/index`), the shape missions use
 * (agents/missions.js) for the same reasons — two teams never race one file, and the index is what a list draws from.
 */
const crypto = require('crypto');
const store = require('../store');

const INDEX = 'teams/index';
const MAX_INDEX = 200;

const index = () => { const d = store.readJson(INDEX, { teams: [] }); return Array.isArray(d.teams) ? d.teams : []; };
const get = id => (/^team_[a-f0-9]{6,20}$/.test(String(id)) ? store.readJson(`teams/${id}`, null) : null);

/** Write a team and its index row (what a list needs without opening every team). */
function save(team) {
  team.updatedAt = new Date().toISOString();
  store.writeJson(`teams/${team.id}`, team);
  const row = { id: team.id, title: team.title, by: team.by, projectId: team.projectId || null, state: team.state, progress: team.progress || null,
    createdAt: team.createdAt, endedAt: team.endedAt || null, archivedAt: team.archivedAt || null };
  const rows = index().filter(r => r.id !== team.id);
  store.writeJson(INDEX, { teams: [...rows, row].slice(-MAX_INDEX) });
  return team;
}

const newId = () => `team_${crypto.randomBytes(6).toString('hex')}`;

/** Teams newest first; archived ones only when asked for. */
function list({ all = false, by = null } = {}) {
  return index().filter(r => (all || !r.archivedAt) && (!by || r.by === by)).reverse();
}

function _reset() { for (const r of index()) store.removeJson(`teams/${r.id}`); store.writeJson(INDEX, { teams: [] }); }

module.exports = { get, save, list, newId, _reset };
