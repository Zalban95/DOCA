'use strict';

/**
 * The agent finds and brings in the skills it needs (the owner, 2026-10-17: "the harness has to be able to find and
 * get the skills they need, and if they do not exist, after the first time they learn to do something they can create
 * it"). `skill find` searches the public collections skill-online.js reads (GET only, as data); `skill get` brings one
 * in — only from those collections, only a valid new name, within the size limits, and only when nothing in its files
 * looks like words aimed at the agent, sending what it holds, a piped installer, a hidden character or a key
 * (skill-scan.js, secret-scan.js). Its scripts are written, never run. Each import is an activity line naming where it
 * came from; the person removes it in Settings → Harness → Skills like any. Writing a new one stays `skill write`.
 */
const online = () => require('./skill-online');

async function find(query) {
  const q = String(query || '').trim();
  if (!q) return 'Error: find needs query — the words of what the skill is for.';
  const { results, failed } = await online().search(q);
  const top = results.slice(0, 10);
  const lines = top.map(r => `${r.name} — ${r.source}: source ${online().SOURCES.find(s => s.label === r.source)?.repo}, dir ${r.dir}${r.here ? ' (already on this machine: read it)' : ''}: ${String(r.description || '').slice(0, 200)}`);
  return [top.length ? `Public skills matching "${q}" (bring one in with skill get {source, dir}, then read it):` : `No public skill matches "${q}".`,
    ...lines, failed.length ? `Not searched just now: ${failed.join('; ')}` : '',
    top.length ? '' : 'If none fits, work it out yourself; once it worked, keep it with skill write.'].filter(Boolean).join('\n');
}

async function get(a, ctx = {}) {
  const repo = String(a.source || '').trim(), dir = String(a.dir || '').trim();
  if (!repo || !dir) return 'Error: get needs source and dir, as find names them.';
  if (!online().SOURCES.some(s => s.repo === repo)) return `Error: ${repo} is not one of the collections searched here (${online().SOURCES.map(s => s.repo).join(', ')}).`;
  try {
    const p = await online().plan(repo, dir);
    if (p.exists) return `${p.name} is already on this machine: read it with skill read.`;
    const r = await online().importSkill(repo, dir, { scan: true });
    require('../activity').note({ from: 'skills', sessionId: ctx.sessionId || null, what: `brought in the skill ${p.name} from ${p.url}`,
      why: 'the agent needed it for the work in hand (skill get); checked for words aimed at the agent, exfiltration, piped installers and keys' });
    return `Skill ${p.name} brought in from ${p.url}. Read it now with skill read ${p.name}.`
      + `${r.scripts?.length ? ` It carries scripts (written, not run): ${r.scripts.join(', ')} — run one only as its instructions say, under your approvals.` : ''}`
      + `${p.audit?.status === 'adapt' ? ` It was written for ${p.audit.label || 'another harness'}: its reading note says how its words map to your tools.` : ''}`;
  } catch (e) { return `Error: ${e.message}`; }
}

module.exports = { find, get };
