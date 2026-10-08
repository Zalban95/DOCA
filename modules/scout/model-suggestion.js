'use strict';

/**
 * The model scout's second kind of suggestion (docs/design/model-suggestions.md): `suggested-model` — a model for the
 * guided set-up's list (guided/suggested-models.json), naming the role, the size class it would be the pick for, the
 * entry itself and the evidence. Accepting it writes no TODO line and builds nothing: it lays the entry over this
 * install's list (guided/overlay.js), where Set-up picks from it the next time it looks. Declining works as for any
 * suggestion, and the reason is read by the next brief. Nothing here changes the list without a person's click.
 */
const CHECK = 'Check the guided set-up\'s suggested models (docs/design/model-suggestions.md). 1) Call `model_scout` with action '
  + '"suggestions": the list in use, the day it was checked, and the pick for each size class and role. 2) Call it with action "signals" '
  + '(trending models per function, quantized GGUF releases among them) and "list" (what was suggested and declined before, and why). '
  + '3) For each class, look for a stronger open-weight model that fits it at a sensible quantization — the model card\'s benchmarks for '
  + 'tool calling and agent work (BFCL, tau-bench, SWE-bench, Terminal-Bench, MCP-Atlas), how the community rates it now, and how it '
  + 'installs: an Ollama library tag, or hf.co/<repo>:<quant> for a GGUF on Hugging Face. Read the pages (send the scout specialist when '
  + 'specialists are on); a headline is not evidence. Work out its needs in GB: the file plus its projector, its context cache at 16k '
  + 'tokens, and about 0.3 for the runtime. 4) File each that holds up with `model_scout` action "suggest", kind "suggested-model": the '
  + 'role, the class, why, the evidence (URLs), and entry {id, label, quant, released, rank (the pick it should beat has its rank in the '
  + 'list), needs {vramGB, ramGB, diskGB}, context {native, at}, install {kind: "ollama-model", id}, licence, toolCalling, sources '
  + '[{url, checked}], alsoFor}. At most five, best first. 5) Answer in one line: how many filed. Change nothing: a person accepts.';

/** Checked and cleaned now, so what a person accepts later is what they were shown. */
function prepare(a) {
  const overlay = require('../guided/overlay');
  const role = String(a.role || a.entry?.role || '').trim();
  const c = overlay.clean(a.entry, role);
  if (c.why) throw Object.assign(new Error(`The entry is not one the suggestions list can take: ${c.why}`), { status: 400 });
  const cls = String(a.class || '').trim().slice(0, 40);
  const known = require('../guided/classes').CLASSES.map(x => x.id);
  if (cls && !known.includes(cls)) throw Object.assign(new Error(`class is one of ${known.join(', ')}.`), { status: 400 });
  return { role, class: cls, entry: c.entry, candidate: c.entry.id };
}

/** Accepted: the entry joins this install's list. */
function accept(s, who) {
  const entry = require('../guided/overlay').add(s.entry, { from: s.id, by: who || null });
  return { state: 'accepted', appliedTo: 'suggestions', entry, decidedAt: new Date().toISOString(), by: who || null };
}

/** For the tool: the list in use, and the pick per size class — what a suggestion has to beat. */
async function view() {
  const sug = require('../guided/suggestions'), doc = sug.load(), about = sug.about();
  const rows = await require('../guided/classes').picks(doc);
  const lines = [`Suggested models v${about.version} (${about.source}), checked ${about.checked}${about.local ? `; ${about.local} accepted here` : ''}.`,
    'Pick per size class (role: model @ where, rank):'];
  for (const c of rows) {
    lines.push(`- ${c.id} (${c.label}): ${Object.entries(c.picks).map(([r, p]) => `${r}: ${p ? `${p.id} @${p.where}, rank ${p.rank}` : 'none — providers'}`).join('; ')}`);
  }
  lines.push('Entries (role · id · quant · needs vram/ram/disk GB · rank · checked):');
  for (const m of doc.models.filter(x => !x.alsoOf)) {
    const also = doc.models.filter(x => x.alsoOf === m.role && x.id === m.id).map(x => x.role);
    lines.push(`- ${m.role}${also.length ? `(+${also.join(',')})` : ''}${m.local ? ' [accepted here]' : ''} · ${m.id} · ${m.quant || '—'} · ${m.needs.vramGB}/${m.needs.ramGB}/${m.needs.diskGB ?? '?'} · ${m.rank} · ${(m.sources || []).map(s => s.checked).sort().pop() || '—'}`);
  }
  for (const w of doc.watching || []) lines.push(`- watching ${w.role} · ${w.id}: ${w.why}`);
  return lines.join('\n');
}

/**
 * Set-up's "Check for newer models": the scout looks now, as a brief in its own conversation, when its experiment is on.
 * Off, nothing reaches the network and the answer says how to turn it on. Either way nothing changes until accepted.
 */
function check() {
  const scout = require('./index');
  if (!scout.on()) {
    // Experiments are for the repository's owners and testers, never a newcomer (AGENTS.md, Experiments): only a
    // developer's install is told where the switch is.
    return { started: false, how: require('../experiments').developer()
      ? 'The model scout is off. It looks for newer models every few days and files what it finds in Settings → Harness → Scout for you to accept; switch it on in Settings → Developer, then press this again.'
      : 'The suggested models come from a list the DOCA project tests, and a newer list arrives with DOCA\'s updates — there is nothing to do here.' };
  }
  scout.brief('suggestions', CHECK).catch(() => { /* no owner to run as: the scout card says so */ });
  return { started: true, sessionId: scout.state().sessionId || null,
    said: 'The model scout is looking now, in its conversation "Model scout". What it finds waits in Settings → Harness → Scout for you to accept.' };
}

module.exports = { CHECK, prepare, accept, view, check };
