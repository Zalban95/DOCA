'use strict';

/**
 * A team's board as a page (asked 2026-10-10, Agents → Teams: "a specific place where I can see the teams of agents
 * working, their plan, the state of the project"): what the board view already carries, plus what only the page needs —
 * read from records, never written by an agent or a model (AGENTS.md, "Visibility is mechanical"):
 *
 *   lines     each task's specialist's last words: its report's first line when it finished, else the newest line of
 *             its conversation (a work chat: its brief) — the agent's own words, framed as such by the page
 *   checks    each task's contract — "done when …", the check the hub runs, and its verdict with when
 *   doc       the team document's text (doc.js render: the same words the file holds), drawn inline
 *   project   the project it works on, as git and its chats say: the main folder's branch and changed files, the
 *             newest commits on main and on each task's branch, and the plan steps still open in its conversations
 */
const board = require('./board');

const firstLine = s => String(s || '').split('\n').map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || '';
const cut = (s, n = 240) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The newest thing the conversation's assistant said, as one line. */
function lastSaid(sessionId) {
  if (!sessionId) return null;
  let rows = [];
  try { rows = require('../harness/memory').messages(sessionId) || []; } catch { return null; }
  for (let i = rows.length - 1; i >= 0 && i >= rows.length - 60; i--) {
    const r = rows[i];
    if (r.role === 'assistant' && typeof r.content === 'string' && r.content.trim()) return { text: cut(firstLine(r.content)), at: r.at || null };
  }
  return null;
}

function lines(team, views) {
  const missions = require('../agents/missions');
  const out = {};
  for (const v of views) {
    const m = v.missionId ? missions.get(v.missionId) : null;
    if (m?.result && ['done', 'finished', 'cancelled'].includes(m.state)) out[v.id] = { text: cut(firstLine(m.result)), at: m.endedAt || null, kind: 'report' };
    else if (m?.error) out[v.id] = { text: cut(firstLine(m.error)), at: m.endedAt || null, kind: 'error' };
    else {
      const sid = m?.sessionId || v.sessionId;
      const s = !m && sid ? require('../harness/memory').getSession(sid) : null;
      const said = s?.brief ? { text: cut(firstLine(s.brief)), at: s.updatedAt || null } : lastSaid(sid);
      if (said) out[v.id] = { ...said, kind: 'said' };
    }
  }
  return out;
}

function checks(team, views) {
  return views.filter(v => v.contract).map(v => {
    const t = (team.tasks || []).find(x => x.id === v.id) || {};
    return { task: v.id, title: v.title, done: v.contract.done || null, check: v.contract.check || null, state: v.state,
      verdict: t.verdict ? { ok: !!t.verdict.ok, why: t.verdict.why || '', at: t.verdict.at || null } : null };
  });
}

/** The plan steps still open in the project's conversations (projects/store.chats), at most twelve. */
function openSteps(projectId) {
  const out = [];
  let chats = [];
  try { chats = require('../projects/store').chats(projectId); } catch { return out; }
  const memory = require('../harness/memory');
  for (const c of chats) {
    const plan = memory.getSession(c.id)?.plan;
    if (!plan?.steps?.length || ['rejected', 'superseded'].includes(plan.state)) continue;
    plan.steps.forEach((step, i) => {
      const state = plan.progress?.[i + 1] || 'queued';
      if (state !== 'done' && out.length < 12) out.push({ sessionId: c.id, chat: c.title || c.id, n: i + 1, step: cut(typeof step === 'string' ? step : step?.title || '', 160), state });
    });
  }
  return out;
}

async function project(team, views) {
  const p = team.projectId ? require('../projects/store').get(team.projectId) : null;
  if (!p) return null;
  const git = require('../projects/git');
  const out = { id: p.id, name: p.name, root: p.root, git: null, main: [], branches: [], openSteps: openSteps(p.id) };
  const short = list => list.map(c => ({ short: c.short, subject: cut(c.subject, 120), author: c.author, date: c.date }));
  try {
    if (await git.top(p.root)) {
      const st = await git.status(p.root);
      out.git = { branch: st.branch, changed: st.files.length, ahead: st.ahead, behind: st.behind };
      out.main = short(await git.log(p.root, { limit: 5 }));
      for (const v of views.filter(x => x.place?.branch)) {
        let commits = [];
        try { commits = short(await git.log(p.root, { limit: 4, rev: v.place.branch })); } catch { /* a branch that went */ }
        out.branches.push({ task: v.id, title: v.title, branch: v.place.branch, root: v.place.root, commits });
      }
    }
  } catch (e) { out.gitError = e.message; }
  return out;
}

/** Everything the Teams page draws for one team. */
async function detail(team) {
  const teams = require('./index');
  const view = teams.view(team);
  const views = view.tasks;
  let doc = '';
  try { doc = require('./doc').render(team, views); } catch { /* drawn without it */ }
  return { team: view, lines: lines(team, views), checks: checks(team, views), doc, project: await project(team, views),
    says: Object.fromEntries(views.map(v => [v.id, board.say(v, id => views.find(x => x.id === id)?.title || id)])) };
}

module.exports = { detail, lines, checks, openSteps };
