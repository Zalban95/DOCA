'use strict';

/**
 * The team's living document (docs/design/teams.md): `team-<slug>.md`, written again from the board and the missions'
 * reports every time a task changes state — goal, tasks with their state and who does them, decisions (each report's
 * first line), notes the teammates posted, results with the files they wrote. Generated, never edited by an agent:
 * its words are the board's and the reports' own.
 *
 * Where: a page in the team's project (projects/pages.js — a project's `.md` files are its pages; place.js) when it
 * has one, and always a copy in the attachments folder, which is how a phone opens it (`agent.team` `doc`, the
 * road the plan document takes — a watch skips a doc).
 */
const fs = require('fs');
const path = require('path');
const board = require('./board');

const slug = s => String(s || 'team').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const when = iso => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '');

function render(team, views) {
  const product = require('../branding').name('product');
  const missions = require('../agents/missions');
  const p = team.progress || board.summary(team, views).progress;
  const title = id => { const t = team.tasks.find(x => x.id === id); return t ? t.id : id; };
  const who = v => (v.agent === 'work' ? 'a work chat' : (require('../agents/registry').get(v.agent)?.label || v.agent)) + (v.missionId ? ` (${v.missionId})` : '');
  const rows = views.map((v, i) => `| ${i + 1} | ${cell(`${v.title} (${v.id})`)} | ${cell(who(v))} | ${cell(board.say({ ...v, budget: null }, title))} | ${cell(v.after.join(', ') || '—')} | ${cell(v.contract?.done || '—')} |`);
  const reports = views.filter(v => v.missionId).map(v => ({ v, m: missions.get(v.missionId) })).filter(x => x.m?.result);
  const decisions = reports.map(({ v, m }) => `- **${v.id}** ${cell(who(v))}: ${cell(String(m.result).split('\n').find(l => l.trim()) || '')}`);
  const results = reports.map(({ v, m }) => {
    const files = require('../agents/after').filesOf(m);
    return `### ${v.title} (${v.id}) — ${who(v)}\n\n${String(m.result).slice(0, 1500).trim()}${files.length ? `\n\nFiles: ${files.map(f => `\`${f}\``).join(', ')}` : ''}`;
  });
  const branches = views.filter(v => v.place?.branch).map(v => `- **${v.id}** ${cell(who(v))}: branch \`${v.place.branch}\` in \`${v.place.root}\` — merging it back is the person's call`);
  const notes = (team.notes || []).slice(-30).map(n => `- ${when(n.at)} **${cell(n.from)}** (${n.task}): ${cell(n.text)}`);
  const loop = team.loop?.on ? `keep going: on, round ${team.loop.rounds || 0} of ${require('./engine').maxRounds(team)}` : 'keep going: off';
  return [
    `# Team: ${team.title}`, '',
    `*${product} writes this page from the team's board and its missions' reports, again whenever a task changes state; how far a running task is shows live in the panel. Edits made here are overwritten.*`, '',
    team.goal ? `**Goal** ${team.goal}` : '', '',
    `**State** ${team.state} — ${p.done} of ${p.total} tasks done (${p.percent}%; every task counts the same) · ${loop}`, '',
    `**Started** ${when(team.createdAt)}${team.endedAt ? ` · **ended** ${when(team.endedAt)}` : ''} · ${team.id}`, '',
    '## Tasks', '', '| # | Task | Who | State | After | Done when |', '|---|---|---|---|---|---|', ...rows, '',
    ...(branches.length ? ['## Where the work is', '', 'Tasks that change files while others do work in git worktrees of their own:', '', ...branches, ''] : []),
    '## Decisions', '', ...(decisions.length ? decisions : ['*None reported yet.*']), '',
    '## Notes from the team', '', ...(notes.length ? notes : ['*None yet.*']), '',
    '## Results', '', ...(results.length ? results.flatMap(r => [r, '']) : ['*Nothing delivered yet.*', '']),
  ].join('\n');
}

/** Write it: the project page (when the leader has a project) and the attachment copy. Records where on the team. */
function write(team, views) {
  const text = render(team, views);
  const before = JSON.stringify(team.doc || {});
  const doc = team.doc || (team.doc = {});
  if (doc.project === undefined) {
    let root = null;   // the team's project (place.js) — its main folder, where its pages are — else the leader's
    try { root = (team.projectId && require('../projects/store').get(team.projectId)?.root) || require('../projects/store').forSession(team.by)?.root || null; } catch { /* no projects */ }
    doc.project = null;
    if (root && fs.existsSync(root)) {
      let name = `team-${slug(team.title)}.md`;
      for (let n = 2; fs.existsSync(path.join(root, name)) && n < 50; n++) name = `team-${slug(team.title)}-${n}.md`;
      doc.project = name; doc.root = root;
    }
  }
  if (doc.project && doc.root) try { fs.writeFileSync(path.join(doc.root, doc.project), text); } catch { /* the folder went: the copy stays */ }
  const attachments = require('../attachments');
  const abs = doc.name ? path.join(attachments.dir(), doc.name) : null;
  if (abs && fs.existsSync(path.dirname(abs))) fs.writeFileSync(abs, text);
  else doc.name = attachments.save(Buffer.from(text), `team-${slug(team.title)}.md`, { from: 'agent', mime: 'text/markdown' }).name;
  if (JSON.stringify(doc) !== before) require('./store').save(team);
  return text;
}

module.exports = { render, write, slug };
