'use strict';

/**
 * Evaluation sets in other tools' formats ([IO]; TODO H10.1). Export: **promptfoo**'s YAML config (`tests` with
 * `vars.prompt` and `assert` — icontains, not-icontains, regex, llm-rubric), so a set runs there against any provider;
 * the checks promptfoo has no word for (a tool called, steps, tokens) are kept as comments rather than dropped
 * silently. Import: **OpenAI Evals** JSONL (`{"input": [{role, content}…], "ideal": "…"}` per line, the match/includes
 * family), each line a case whose answer must contain the ideal. And DOCA's own JSON both ways.
 */
const q = s => JSON.stringify(String(s));   // a JSON string is a valid YAML scalar

function promptfoo(set) {
  const lines = [`# ${set.title} — exported from DOCA (evals/${set.id}).`, `description: ${q(set.description || set.title)}`, 'prompts:', "  - '{{prompt}}'",
    '# providers: pick yours, e.g.', '#   - openai:chat:gpt-4o-mini', 'tests:'];
  for (const c of set.cases) {
    lines.push(`  - description: ${q(c.id)}`, '    vars:', `      prompt: ${q(c.prompt)}`, '    assert:');
    let any = false;
    for (const k of c.checks) {
      const [type, value] = k.contains !== undefined ? ['icontains', k.contains] : k.notContains !== undefined ? ['not-icontains', k.notContains]
        : k.matches !== undefined ? ['regex', `(?i)${k.matches}`] : k.judge !== undefined ? ['llm-rubric', k.judge] : [null, null];
      if (type) { lines.push(`      - type: ${type}`, `        value: ${q(value)}`); any = true; }
      else lines.push(`      # DOCA-only check, not exported: ${JSON.stringify(k)}`);
    }
    if (!any) lines.push('      []');
    if (c.mode) lines.push(`    # DOCA ran this case in ${c.mode} mode`);
  }
  return `${lines.join('\n')}\n`;
}

/** OpenAI Evals JSONL → a DOCA set. Lines without a user message or an ideal are skipped, and counted. */
function fromOpenAiEvals(text, { id, title }) {
  const cases = []; let skipped = 0;
  String(text).split(/\r?\n/).filter(l => l.trim()).forEach((line, i) => {
    let o; try { o = JSON.parse(line); } catch { skipped++; return; }
    const input = Array.isArray(o.input) ? o.input : [{ role: 'user', content: o.input }];
    const prompt = input.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
    const ideal = [].concat(o.ideal ?? []).filter(x => typeof x === 'string' && x.trim());
    if (!prompt || !ideal.length) { skipped++; return; }
    const sys = input.filter(m => m.role === 'system').map(m => m.content).join('\n');
    cases.push({ id: `case-${i + 1}`, prompt: sys ? `${sys}\n\n${prompt}` : prompt, checks: ideal.length === 1 ? [{ contains: ideal[0] }] : [{ matches: ideal.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') }] });
  });
  return { set: { id, title: title || id, description: 'Imported from an OpenAI Evals JSONL file.', cases }, skipped };
}

module.exports = { promptfoo, fromOpenAiEvals };
