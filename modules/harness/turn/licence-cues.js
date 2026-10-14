'use strict';

/**
 * A request that plainly asks for what this hive's licence leaves out, said in one line of the readings (a core-only
 * run, 2026-10-14: asked to "make a team", the agent answered "only the Orchestrator can spawn work chats, and no
 * specialists are enabled here" — it held no `team` tool and nothing told it why, so the person never learnt that
 * teams come with a licence). The tools are absent (tool-shape.js says why to the panel's roster); this puts that
 * reason in front of the turn only when the person names the thing, so it costs nothing otherwise.
 *
 * NAMES are a request's plain words for a tool, kept narrow on purpose: a wrong line here tells the person something
 * is missing when they asked for something else. The feature is the tool's own (license/use.js featureOfTool); the
 * lab's (experiments) are never named — they are not a product a person asks for.
 */
const NAMES = {
  team: /\b(make|build|form|start|create|assemble|spin up|put together|set up|use)\b[^.?!:]{0,20}\bteams?\b|\bas a team\b|\bteam of\b/i,
  agent_dispatch: /\bspecialists?\b|\bsub-?agents?\b|\b(coder|tester|researcher) agent\b/i,
  computer: /\bsandbox(ed)?\b|\b(disposable|throwaway|virtual) (desktop|computer|machine)\b|\bagents?'? (own )?computers?\b/i,
  vnc_look: /\bvnc\b/i,
  meeting: /\b(video ?call|conference call)\b|\b(set up|schedule|start|book) a meeting\b/i,
  calendar: /\bmy (calendar|agenda)\b/i,
  mail: /\bmy (inbox|e-?mails?|mail)\b/i,
  tell_device: /\b(on|to) my (phone|watch)\b/i,
  nearby: /\b(chromecast|airplay)\b|\bcast (it|this) to\b/i,
};

/** "# Not in this licence": the features a request names that this hive is not licensed for. '' when none. */
function block(message) {
  const text = String(message || '');
  if (!text.trim()) return '';
  const lic = require('../../license'), gate = require('../../license/gate'), use = require('../../license/use');
  const seen = new Set(), rows = [];
  for (const [tool, re] of Object.entries(NAMES)) {
    if (!re.test(text) || gate.toolOn(tool)) continue;
    const f = use.featureOfTool(tool);
    if (!f || lic.featureOn(f) || f.licence === 'lab' || seen.has(f.id)) continue;
    seen.add(f.id);
    rows.push(`- ${f.name}: ${require('../../features').notLicensed(f)}; then offer what you can do instead.`);
  }
  return rows.length ? ['# Not in this hive\'s licence (the request names it)', ...rows].join('\n') : '';
}

module.exports = { block, NAMES };
