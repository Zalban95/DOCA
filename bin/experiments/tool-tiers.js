'use strict';

/**
 * `npm run experiment -- tool-tiers` (docs/experiments/tool-tiers.md): what one step costs the Orchestrator and a work
 * chat in prompt and tool schemas, with the experiment off and on — on the sandbox's copy of this machine's settings,
 * so its MCP servers and connectors count. No model is called: it measures what would be sent (≈4 characters a token).
 */
async function measure() {
  const experiments = require('../../modules/experiments');
  const agent = require('../../modules/harness/agent');
  const memory = require('../../modules/harness/memory');
  const org = require('../../modules/harness/organization');
  const tools = require('../../modules/harness/tools');
  const { disabledFor } = require('../../modules/harness/turn/prompt');
  const params = require('../../modules/harness/turn/params');
  const tiers = require('../../modules/harness/turn/tool-tiers');
  experiments.setDeveloper(true);
  const work = org.create({ title: 'measure' });
  const kinds = [['Orchestrator', memory.mainSession().id, org.profileFor({ kind: 'orchestrator' })], ['work chat', work.id, null]];
  const tok = s => Math.round(s.length / 4);
  const rows = [];
  for (const flag of [false, true]) {
    experiments.set('toolTiers', flag);
    for (const [label, id, profile] of kinds) {
      const prompt = agent.preview({ message: 'what is the weather like?', sessionId: id });
      const held = tools.schemas(disabledFor(profile, params.turnParams(profile), id));
      const sent = tiers.split(held, { sessionId: id, profile, text: '' }).offered;
      rows.push({ flag, label, prompt: tok(prompt), schemas: tok(JSON.stringify(sent)), held: held.length, sent: sent.length });
    }
  }
  console.log('| date | type | flag | tools sent / held | prompt | schemas | per step |');
  for (const r of rows)
    console.log(`| ${new Date().toISOString().slice(0, 10)} | ${r.label} | ${r.flag ? 'on' : 'off'} | ${r.sent} / ${r.held} | ${r.prompt} | ${r.schemas} | ${r.prompt + r.schemas} |`);
  return 0;
}

module.exports = { measure };
