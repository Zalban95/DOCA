'use strict';

/**
 * `npm run experiment -- tool-tiers` (docs/experiments/tool-tiers.md, graduated 2026-10-09): what one step costs the
 * Orchestrator, a work chat and a spoken turn's front (turn/front.js) in prompt and tool schemas, with every tool sent
 * in full (`toolsLoading: all`) and by tier (`tiers`, the default) — on the sandbox's copy of this machine's settings,
 * so its MCP servers and connectors count. No model is called: it measures what would be sent (≈4 characters a token).
 */
async function measure() {
  const agent = require('../../modules/harness/agent');
  const memory = require('../../modules/harness/memory');
  const org = require('../../modules/harness/organization');
  const tools = require('../../modules/harness/tools');
  const catalog = require('../../modules/harness/catalog');
  const { disabledFor, systemPrompt } = require('../../modules/harness/turn/prompt');
  const params = require('../../modules/harness/turn/params');
  const tiers = require('../../modules/harness/turn/tool-tiers');
  const front = require('../../modules/harness/turn/front');
  const work = org.create({ title: 'measure' });
  const main = memory.mainSession().id;
  const spoken = { name: 'Watch', kind: 'phone', formFactor: 'watch', mode: 'assistant', front: true };
  const orch = org.profileFor({ kind: 'orchestrator' });
  const kinds = [['Orchestrator', main, orch, null], ['work chat', work.id, null, null], ['spoken front', main, orch, spoken]];
  const tok = s => Math.round(s.length / 4);
  const rows = [];
  for (const how of ['all', 'tiers']) {
    catalog.saveConfig(catalog.BUILTIN_ID, { toolsLoading: how });
    for (const [label, id, profile, client] of kinds) {
      const p = params.turnParams(profile);
      const disabled = client ? front.offOutside(disabledFor(profile, p, id)) : disabledFor(profile, p, id);
      const held = tools.schemas(disabled);
      const sent = tiers.split(held, { sessionId: id, profile, text: '', client }).offered;
      const prompt = client ? systemPrompt({ p, userText: 'what is the weather like?', client, profile, sessionId: id, disabled, toolCount: sent.length, disabledCount: disabled.length })
        : agent.preview({ message: 'what is the weather like?', sessionId: id });
      rows.push({ how, label, prompt: tok(prompt), schemas: tok(JSON.stringify(sent)), held: held.length, sent: sent.length });
    }
  }
  catalog.saveConfig(catalog.BUILTIN_ID, { toolsLoading: 'tiers' });
  console.log('| date | type | tools sent as | tools sent / held | prompt | schemas | per step |');
  for (const r of rows)
    console.log(`| ${new Date().toISOString().slice(0, 10)} | ${r.label} | ${r.how} | ${r.sent} / ${r.held} | ${r.prompt} | ${r.schemas} | ${r.prompt + r.schemas} |`);
  return 0;
}

module.exports = { measure };
