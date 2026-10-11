'use strict';

/**
 * Outside workers' own records (harness-teams/): one row per worker — which harness and model, which team task and
 * mission, which computer, its branch and where it started from, how far it got. The mission row (agents/missions.js)
 * is what every list draws; this is what only the worker needs to carry on, stop, and bring its branch back.
 */
const store = require('../store');

const DOC = 'harness-teams/workers';
const KEEP = 300;
const RUNNING = new Set(['starting', 'running']);

const rows = () => { const d = store.readJson(DOC, { workers: [] }); return Array.isArray(d.workers) ? d.workers : []; };
const save = list => store.writeJson(DOC, { workers: list.slice(-KEEP) });
const get = id => rows().find(w => w.id === id) || null;
const byMission = missionId => rows().find(w => w.missionId === missionId) || null;
const add = w => { save([...rows(), w]); return w; };
function patch(id, fields) {
  const list = rows();
  const w = list.find(x => x.id === id);
  if (!w) return null;
  Object.assign(w, fields);
  save(list);
  return w;
}
const running = () => rows().filter(w => RUNNING.has(w.state));

module.exports = { rows, get, byMission, add, patch, running, RUNNING };
