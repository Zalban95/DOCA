'use strict';

/**
 * A plan's contracts (CONSTITUTION V10, 2026-10-07; TODO P1.4): finished means every contract in the plan is
 * fulfilled. Each step may carry one — `done`, a plain "done when …" any model can write and read, and where it
 * helps a `check` the hub runs itself when the step is marked done:
 *   { file: "<path>" }                     the file is there
 *   { file: "<path>", contains: "<text>" } and holds that text
 *   { url: "<address>" }                   the address answers (2xx–3xx) — the owner's own addresses only
 *   { page: "<address>", contains?, selector?, noErrors? }   the page, rendered in the hub's headless browser, shows a
 *                                          text or an element, and (noErrors) its console stayed clean — page-check.js
 *   { absent: "<path>" }                   the file or folder is gone (a clean-up)
 *   { free: <port> }                       nothing listens on that port on this machine (a server stopped)
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
  const owned = u => { if (!require('./toolbox/http').owned(String(u))) throw bad('A check reaches only the owner\'s own addresses (this machine, the LAN, the tailnet).'); return String(u).slice(0, 500); };
  if (c.url) return { url: owned(c.url) };
  if (c.page) return { page: owned(c.page), ...(c.contains ? { contains: String(c.contains).slice(0, 300) } : {}), ...(c.selector ? { selector: String(c.selector).slice(0, 200) } : {}), ...(c.noErrors ? { noErrors: true } : {}) };
  if (c.absent) return { absent: String(c.absent).slice(0, 500) };
  if (c.free !== undefined) { const port = Number(c.free); if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('free is a port number.'); return { free: port }; }
  throw bad('A check is {file}, {file, contains}, {url}, {page, contains, selector, noErrors}, {absent} or {free: port}; a test you run yourself and report.');
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
  if (c.absent) {
    const p = path.resolve(cwd || process.cwd(), c.absent.replace(/^~(?=$|[\\/])/, require('os').homedir()));
    return fs.existsSync(p) ? { ok: false, why: `${c.absent} is still there` } : { ok: true, why: `${c.absent} is gone` };
  }
  if (c.free) {
    const taken = await new Promise(resolve => { const s = require('net').connect({ port: c.free, host: '127.0.0.1' });
      s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); s.setTimeout(3000, () => { s.destroy(); resolve(false); }); });
    return taken ? { ok: false, why: `something still listens on port ${c.free}` } : { ok: true, why: `nothing listens on port ${c.free}` };
  }
  if (c.page) {
    const r = await require('./page-check').look(c.page, { contains: c.contains, selector: c.selector });
    if (r.ok && c.noErrors && r.errors?.length) return { ok: false, why: `the page's console has errors: ${r.errors.join(' | ').slice(0, 300)}` };
    return { ok: r.ok, why: r.why };
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
