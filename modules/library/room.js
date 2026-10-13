'use strict';

/**
 * Room on the GPU for the Library's model, made while the other models are not needed (asked 2026-10-12: "go full now
 * and just make room while the other models are not needed"). Only with `library.makeRoom` on, and only when Ollama
 * refuses the model for memory ("model requires 1.9 GiB but only 0.4 GiB are available"). One thing is freed at a time,
 * the least disruptive first, and the embedding is asked again after each:
 *
 *   1. another model Ollama keeps loaded and nothing of DOCA's is asking (keep_alive 0: it loads again when asked);
 *   2. a service or llama.cpp server DOCA manages and starts again when needed (service-life: managed, "Start when
 *      needed", nothing holding it now) — stopped as its idle sweep would, with the same line in the activity log;
 *   3. a model a llama.cpp router keeps loaded, while no turn, call or device job runs and nothing of DOCA's is in
 *      flight to it — unloaded (the router loads it again on its next request).
 *
 * Nothing started outside DOCA, nothing in use, and no turn is waited on: what cannot be freed is named in the refusal.
 * While the Library holds room it made, anything else wanting a local model gets it back first — a request DOCA sends
 * to a local server (harness/inflight.js) or a service starting when needed (service-life/demand.js) unloads the
 * Library's model at once, and the indexer waits until they are quiet again (`quiet()`); a run that made room unloads
 * its model when it ends (`giveBack()`), so what was freed comes back with all its room.
 */
const REFUSED = /requires ([\d.]+) ([KMG])i?B but only ([\d.]+) ([KMG])i?B are available/i;

let _held = null;      // { base, model, since, freed: [labels] } while the Library holds room it made
let _giving = null;    // the unload in progress, so two callers share one

const isRoomError = e => REFUSED.test(String(e?.message || e || ''));
const on = () => !!require('../settings-schema').value('library.makeRoom');
const local = url => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(String(url || ''));
const ollamaBase = () => require('../harness/providers').ollamaBase();

async function post(url, body, ms = 15000) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  return r.ok;
}

function note(what, why, extra = {}) {
  require('../activity').note({ from: 'library', what, why, level: 'info', ...extra });
}

/** 1. Another model Ollama keeps loaded, with nothing of DOCA's asking it. */
async function ollamaOther(model) {
  const base = ollamaBase();
  const ps = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null);
  const flying = new Set(require('../harness/inflight').list().map(f => f.model));
  const m = (ps?.models || []).find(x => x.name !== model && x.model !== model && !flying.has(x.name) && (x.size_vram || 0) > 0);
  if (!m) return null;
  await post(`${base}/api/generate`, { model: m.name, keep_alive: 0 }).catch(() => false);
  return `${m.name} (Ollama; it loads again when asked)`;
}

/** 2. A service or llama.cpp server DOCA manages and starts again when needed, with nothing holding it now. */
async function managedService() {
  const targets = require('../service-life/targets'), policy = require('../service-life/policy'), idle = require('../service-life/idle');
  const running = await targets.running({ fresh: true });
  for (const t of targets.list()) {
    if (!running.has(t.key) || !policy.managed(t.key) || !policy.startsWhenNeeded(t.key) || idle.holds(t, policy)) continue;
    const r = await targets.stop(t);
    idle.note(t, r, 'made room on the GPU for the Library (library.makeRoom); it starts again when needed');
    if (r.ok) return `${t.label} (it starts again when needed)`;
  }
  return null;
}

/** 3. A model a llama.cpp router keeps loaded, while nothing runs and nothing of DOCA's is in flight to it. */
async function routerModel() {
  if (require('../harness/drain').busy().length) return null;
  const servers = await require('../model-servers').status().then(s => s.servers || []).catch(() => []);
  for (const s of servers) {
    if (s.kind !== 'llama.cpp router' || !local(s.url) || (s.doca || []).length) continue;
    const m = (s.models || []).find(x => x.state === 'loaded');
    if (!m) continue;
    const origin = s.url.replace(/\/v1\/?$/, '');
    if (!(await post(`${origin}/models/unload`, { model: m.id }).catch(() => false))) continue;
    note(`unloaded ${m.id} from ${s.label}`, 'made room on the GPU for the Library (library.makeRoom); the router loads it again on its next request');
    return `${m.id} (${s.label}; loaded again on its next request)`;
  }
  return null;
}

const STEPS = [ollamaOther, managedService, routerModel];

/**
 * Free one thing for `model` (the Library's). → the label of what was freed, or null when nothing more may be freed.
 * Called after Ollama refused the model for memory; the caller asks again.
 */
async function make(model) {
  if (!on()) return null;
  for (const step of STEPS) {
    let got = null;
    try { got = await step(model); } catch { /* that step could not look: the next */ }
    if (got) {
      _held = _held || { base: ollamaBase(), model, since: Date.now(), freed: [] };
      _held.freed.push(got);
      return got;
    }
  }
  return null;
}

/**
 * Embed with room made when needed: `fn` is the embedding call; a refusal for memory frees one thing and asks again,
 * up to four times. The last refusal says what was freed and that nothing more could be.
 */
async function withRoom(fn, model) {
  for (let tries = 0; ; tries++) {
    try { return await fn(); } catch (e) {
      if (!isRoomError(e) || tries >= 4) throw e;
      if (!on()) throw Object.assign(new Error(`${e.message} — turn on "Make room on the GPU" in the Library to free idle models while it works (library.makeRoom).`), { status: e.status });
      const got = await make(model);
      if (!got) {
        const freed = _held?.freed?.length ? ` Freed so far: ${_held.freed.join('; ')}.` : '';
        throw Object.assign(new Error(`${e.message} — nothing more may be freed now (what runs is in use, or was started outside DOCA).${freed}`), { status: e.status });
      }
      await new Promise(r => setTimeout(r, 1500));   // the memory is given back a moment after the stop
    }
  }
}

/** Unload the Library's model when it holds room it made; the others then have theirs back. */
function giveBack(why = 'the run ended') {
  if (!_held) return Promise.resolve(false);
  if (_giving) return _giving;
  const h = _held;
  _giving = post(`${h.base}/api/generate`, { model: h.model, keep_alive: 0 }).catch(() => false).then(ok => {
    _held = null;
    note(`gave back the GPU room it made (${h.model} unloaded)`, why);
    return ok;
  }).finally(() => { _giving = null; });
  return _giving;
}

/** Something else wants a local model now (a request to a local server, a service starting): give the room back. */
function wanted(url, why) {
  if (_held && (url == null || local(url))) giveBack(why).catch(() => {});
}

/** Whether others are using the machine's models now — the indexer waits while they are, after room was made. */
function busyElsewhere() {
  if (require('../harness/inflight').list().some(f => local(f.url))) return true;
  if (require('../harness/drain').busy().length) return true;
  return false;
}

/** Whether the Library made room in this run (the indexer then yields to the others). */
const holding = () => !!_held;
const made = () => (_held ? { since: new Date(_held.since).toISOString(), freed: [..._held.freed] } : null);

module.exports = { make, withRoom, giveBack, wanted, busyElsewhere, holding, made, isRoomError, REFUSED, _reset: () => { _held = null; _giving = null; } };
