'use strict';

/**
 * A plan's contracts (CONSTITUTION V10, 2026-10-07; TODO P1.4): finished means every contract in the plan is
 * fulfilled. Each step may carry one — `done`, a plain "done when …" any model can write and read, and where it
 * helps a `check` the hub runs itself when the step is marked done:
 *   { file: "<path>" }                     the file is there
 *   { file: "<path>", contains: "<text>" } and holds that text
 *   { url: "<address>" }                   the address answers (2xx–3xx) — the owner's own addresses only
 * A check never runs a command: a test the agent runs itself and reports (the turn's own approvals), so a contract
 * can never be a way around them. Steps stay strings (every reader of a plan keeps working); `plan.contracts[i]`
 * belongs to `plan.steps[i]`, or is null.
 */
const fs = require('fs');
const path = require('path');

const bad = m => Object.assign(new Error(m), { status: 400 });

/** One step as the agent gave it — a string, or {title, done, check} — split into its title and its contract. */
function split(step) {
  if (typeof step === 'string') return { title: step, contract: null };
  if (!step || typeof step !== 'object') throw bad('A step is a sentence, or {title, done, check}.');
  const title = String(step.title || '').trim();
  if (!title) throw bad('A step needs a title.');
  const done = String(step.done || '').trim().slice(0, 300);
  const check = step.check ? normalizeCheck(step.check) : null;
  return { title, contract: done || check ? { done: done || null, check } : null };
}

function normalizeCheck(c) {
  if (typeof c !== 'object') throw bad('A check is {file}, {file, contains} or {url}.');
  if (c.file) return { file: String(c.file).slice(0, 500), ...(c.contains ? { contains: String(c.contains).slice(0, 300) } : {}) };
  if (c.url) {
    if (!require('./toolbox/http').owned(String(c.url))) throw bad('A check reaches only the owner\'s own addresses (this machine, the LAN, the tailnet).');
    return { url: String(c.url).slice(0, 500) };
  }
  throw bad('A check is {file}, {file, contains} or {url}; a test you run yourself and report.');
}

/** Whether a contract's check holds now: { ok, why }. A contract without a check holds on the agent's word. */
async function verify(contract, { cwd } = {}) {
  const c = contract?.check;
  if (!c) return { ok: true, why: 'no check — on the agent\'s word' };
  if (c.file) {
    const p = path.resolve(cwd || process.cwd(), c.file.replace(/^~(?=$|[\\/])/, require('os').homedir()));
    if (!fs.existsSync(p)) return { ok: false, why: `${c.file} is not there` };
    if (c.contains) {
      let text = '';
      try { text = fs.readFileSync(p, 'utf8'); } catch (e) { return { ok: false, why: `${c.file} cannot be read: ${e.message}` }; }
      if (!text.includes(c.contains)) return { ok: false, why: `${c.file} does not contain "${c.contains}"` };
    }
    return { ok: true, why: `${c.file} is there${c.contains ? ` with "${c.contains}"` : ''}` };
  }
  if (c.url) {
    try {
      const r = await fetch(c.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000) });
      r.body?.cancel?.().catch(() => {});
      return r.status < 400 ? { ok: true, why: `${c.url} answered ${r.status}` } : { ok: false, why: `${c.url} answered ${r.status}` };
    } catch (e) { return { ok: false, why: `${c.url} did not answer (${e.cause?.code || e.message})` }; }
  }
  return { ok: true, why: '' };
}

/** Every step done: the plan is fulfilled. */
const fulfilled = plan => !!plan?.steps?.length && plan.steps.every((_, i) => plan.progress?.[i + 1] === 'done');

/** "1. Build the page — done when it shows the model" for prompts and documents. */
const line = (plan, i) => `${plan.steps[i]}${plan.contracts?.[i]?.done ? ` — done when ${plan.contracts[i].done}` : ''}`;

module.exports = { split, verify, fulfilled, line };
