'use strict';

/**
 * How the agent reaches a person on a device: a question it waits for an answer
 * to, and a notice it does not.
 *
 * The client layer had all of this already — a prompt with choices, per-device
 * tailoring, quiet hours, expiry, an outcome view, durable delivery to whoever
 * is asleep — and none of it was reachable from the harness. Only a separately
 * paired `agent`-scoped device could raise a prompt, so the thing that actually
 * does the work could *see* the user's devices (`doca_clients`) and not speak to
 * one. That is the gap this closes, and it closes it by calling the same
 * `prompts`/`bus` code a paired agent calls, not by growing a second path: a
 * question from the built-in harness and a question from an external agent must
 * look identical on a wrist, or every client has to learn two shapes.
 *
 * Three decisions worth keeping:
 *
 * **`ask()` blocks, and withdraws the question if nobody answers.** A model asks
 * because it cannot continue, so returning an id and hoping it polls would mean
 * the turn ends and the answer arrives with nobody left to read it. And a
 * question that outlives the turn that asked it is worse than no question: the
 * watch keeps offering choices that now lead nowhere. On timeout the prompt is
 * cancelled, the device is told it closed, and the model is told plainly that
 * nobody answered — it can ask again.
 *
 * **Choices are options only.** `prompts` also supports voice, text and image
 * answers, but those resolve through the gateway or through a paired agent
 * posting the outcome; a wrist answering "which of these three" needs neither.
 * Free-form is a separate job, not a parameter to bolt on here.
 *
 * **A picture is saved as the recipient's own media.** `GET /media/:id` answers
 * the owner (or `media:*`), and a watch has neither `media:*` nor a reason to.
 * Storing the bytes under the device the picture was sent *to* makes it readable
 * by exactly that device, with the 24 h expiry and the 0600 mode media already
 * has, and needs no new scope, no new route and no sharing table.
 */
/**
 * Who the prompt says it is from. Not a device — the harness is the hub, not a
 * client of it — but the prompt system publishes its author's copies of an
 * event by id, so this leaves an outbox behind that `clearAgentOutbox()` sweeps.
 */
const AGENT_ID = 'harness';
const AGENT = { id: AGENT_ID, scopes: ['*'] };

const ASK_DEFAULT_SEC = 120;
const ASK_MAX_SEC     = 900;
/** A poller checks at most every 60 s (the watch clamps `retryAfterSec`), so twice that is still "on". */
const POLLING_WINDOW_SEC = 120;
const POLL_MS         = 300;

const api = () => ({
  devices:  require('../api-v1/devices'),
  prompts:  require('../api-v1/prompts'),
  bus:      require('../api-v1/bus'),
  media:    require('../api-v1/media'),
  profiles: require('../api-v1/profiles'),
  scopes:   require('../api-v1/scopes'),
});

/** Nothing durable should accumulate under an id that is not a device. */
function clearAgentOutbox() {
  try { api().bus.dropDevice(AGENT_ID, 'not_a_device'); } catch { /* nothing to clear */ }
}

const label = d => `${d.name} (${d.caps?.formFactor || d.kind || 'device'})`;
const shows = require('./reach-shows');

/**
 * Resolve what the model said into devices that may receive this (they hold `interact`).
 *
 * `to` may be a device id, a form factor, a name or part of one, or nothing at
 * all — which means every device that can be interacted with, the same audience
 * an external agent gets when it omits `targets`. A miss lists what does exist,
 * because a dead end with no directions is how a model starts guessing ids.
 * Whether one can SHOW it is the next filter (ownTargets, reach-shows.js).
 */
function resolveTargets(to) {
  const { devices, scopes } = api();
  const live = devices.list().filter(d => !d.revokedAt && scopes.hasScope(d.scopes, 'interact'));
  if (!live.length) {
    const any = devices.list().filter(d => !d.revokedAt && d.kind !== 'browser').length;
    // `unshown`: nothing here can show it, so the panel is where it goes (ask: the questions dock; a notice: notices/).
    throw Object.assign(new Error(any
      ? `None of the ${any} paired devices can receive a question or a notice — that needs the "interact" scope. Check doca_clients; a viewer-preset device is read-only on purpose.`
      : 'No device or linked chat is paired with this hub, so only the panel can show it. Pairing happens in Field → API keys.'), { unshown: [] });
  }
  // A list is device ids, exactly (a mission's machine question: its person's own devices, never a name that merely
  // contains one — harness/mission-asks.js).
  if (Array.isArray(to)) {
    const hit = live.filter(d => to.includes(d.id));
    if (!hit.length) {
      const named = devices.list().filter(d => !d.revokedAt && to.includes(d.id));
      throw Object.assign(new Error(named.length ? `None of those devices can show a question or a notice: ${shows.explain(named)}.`
        : 'None of those devices can receive a question.'), { unshown: named });
    }
    return hit;
  }
  const want = String(to || '').trim().toLowerCase();
  if (!want || want === 'all' || want === 'any') return live;

  const hit = live.filter(d =>
    d.id.toLowerCase() === want ||
    String(d.caps?.formFactor || '').toLowerCase() === want ||
    d.name.toLowerCase() === want ||
    d.name.toLowerCase().includes(want));
  if (!hit.length) throw new Error(`No device matches "${to}". These can be reached: ${live.filter(shows.shows).map(label).join(', ') || 'none that can show it'}.`);
  return hit;
}

/** Whether a device is likely to see this now, for a report the model can act on. */
function reachNote(d) {
  const { bus, profiles } = api();
  if (bus.isOnline(d.id)) return 'now';
  const prof = profiles.get(d.id);
  if (prof.prompts?.receive === false) return 'declines prompts in its profile';
  // No live stream is not "offline": a watch polls `GET /events` through its phone
  // and never holds one, so for it "queued" is the normal path. A device seen
  // recently collects the queue on its next check; telling the model it is offline
  // sends it off diagnosing a connection that works.
  const seenSec = d.lastSeenAt ? Math.round((Date.now() - Date.parse(d.lastSeenAt)) / 1000) : Infinity;
  if (seenSec <= POLLING_WINDOW_SEC) return `queued, collected on its next check (it polls; seen ${seenSec} s ago)`;
  return `offline, queued (${bus.pendingCount(d.id)} waiting)`;
}

/* ── Asking ───────────────────────────────────────────── */

function buildChoices(choices) {
  const list = (Array.isArray(choices) ? choices : []).slice(0, 8)
    .map((c, i) => {
      const text = typeof c === 'string' ? c : String(c?.label ?? c?.text ?? '');
      if (!text.trim()) return null;
      const id = (typeof c === 'object' && c?.id) ? String(c.id).slice(0, 32) : `c${i + 1}`;
      // `outcome.summary` is what the device shows back after a tap, so it is the
      // answer restated rather than a second sentence nobody wrote.
      return { id, type: 'option', label: text.slice(0, 80), outcome: { summary: text.slice(0, 200) } };
    })
    .filter(Boolean);
  if (list.length < 2) throw new Error('A question needs at least two choices to pick between.');
  // Every question can be declined. A wrist with no way out is a wrist that
  // stays lit until the prompt expires.
  return [...list, { id: 'not_now', type: 'dismiss', label: 'Not now' }];
}

/** The answer, if one of the targets has given it. */
function answerOf(prompt, targets) {
  for (const d of targets) {
    const pd = prompt.perDevice?.[d.id];
    if (!pd) continue;
    if (pd.state === 'outcome_ready' || pd.state === 'confirmed') {
      const choice = prompt.choices.find(c => c.id === pd.choiceId);
      return { status: 'answered', device: d, choiceId: pd.choiceId, label: choice?.label || pd.choiceId };
    }
    if (pd.state === 'dismissed') return { status: 'dismissed', device: d, choiceId: null, label: null };
  }
  return null;
}

/* ── Answering at the panel ─────────────────────────────
   The same question the devices get is open at the desk too: the dashboard
   shows it as a question card (agent-ui/question-card.js) — its choices, or an
   answer in the owner's own words — and whichever answers first is the answer;
   the devices are then told it closed, as when one of several devices answers. */

const _open = new Map();   // promptId -> { id, question, note, choices, at }

/** The questions waiting for an answer right now, for the dashboard. */
function openQuestions() { return [..._open.values()]; }

/** Answer from the panel: a choice by id, or the owner's own words. */
function answerAtPanel(promptId, { choiceId, text } = {}) {
  const q = _open.get(promptId);
  if (!q) throw Object.assign(new Error('That question is no longer waiting for an answer.'), { status: 409 });
  const choice = choiceId ? q.choices.find(c => c.id === choiceId) : null;
  const own = String(text || '').trim().slice(0, 1000);
  if (!choice && !own) throw Object.assign(new Error('Pick a choice or write an answer.'), { status: 400 });
  q.answer = choice ? { choiceId: choice.id, label: choice.label } : { choiceId: 'own_words', label: own };
  return q.answer;
}

/**
 * Ask, and wait. Resolves with what the model needs to carry on:
 * `{ status: 'answered' | 'dismissed' | 'timeout' | 'closed', ... }`.
 */
/**
 * An SVG the agent drew, as a `figure` block: each device gets it as it can draw
 * it (a watch: a PNG at its own screen size, from /render/figure). `quadrants`
 * makes it the whole screen, its four quarters the choices (top-left, top-right,
 * bottom-left, bottom-right), for the agent to label in the drawing itself.
 */
function figureBlock(svg, alt) {
  const s = String(svg || '').trim();
  if (!s) return null;
  if (!/^<svg[\s>]/i.test(s.replace(/^<\?xml[^>]*>\s*/i, ''))) throw new Error('svg must be one <svg> element.');
  return { type: 'figure', svg: s, alt: String(alt || 'drawing').slice(0, 200) };
}

async function ask({ to, question, choices, note, blocks, timeoutSec, signal, svg, layout, personId } = {}) {
  const { prompts } = api();
  const text = String(question || '').trim();
  if (!text) throw new Error('A question needs to be asked in words.');

  // The person's own devices only, as for a notice (ownTargets): never a question on someone else's wrist. When none
  // of theirs can show it, the agent's own question is still open at the panel (the questions dock), and the answer
  // says so; a caller naming device ids (an approval asked on the device that started the turn) has its own card.
  let targets, unshown = null;
  try { targets = ownTargets(to, personId); }
  catch (e) { if (!e.unshown || Array.isArray(to)) throw e; targets = []; unshown = e.message; }
  const built = buildChoices(choices);
  const quadrants = layout === 'quadrants';
  if (quadrants && (!svg || built.filter(c => c.type === 'option').length > 4))
    throw new Error('layout "quadrants" needs an svg and at most four choices, one per quarter.');
  const figure = figureBlock(svg, text);
  const waitSec = Math.min(ASK_MAX_SEC, Math.max(5, Number(timeoutSec) || ASK_DEFAULT_SEC));

  const { prompt } = !targets.length ? { prompt: { id: `pq_${require('crypto').randomBytes(6).toString('hex')}`, state: 'open', choices: built } } : prompts.create({
    title: text.slice(0, 120),
    // `blocks`: a caller's own text blocks in place of the note (an approval's why, what it does and its exact request).
    body: [...(Array.isArray(blocks) && blocks.length ? blocks : note ? [{ type: 'text', text: String(note).slice(0, 800) }] : []), ...(figure ? [figure] : [])],
    choices: built,
    ...(quadrants ? { ext: { layout: 'quadrants' } } : {}),
    targets: targets.map(d => d.id),
    priority: 'high',
    // The prompt outlives the wait by a little so a tap landing as the wait ends
    // is answered rather than met with "closed".
    ttlSec: waitSec + 30,
  }, AGENT);

  const deadline = Date.now() + waitSec * 1000;
  _open.set(prompt.id, { id: prompt.id, question: text, note: note ? String(note).slice(0, 800) : '',
    choices: built.filter(c => c.type === 'option').map(c => ({ id: c.id, label: c.label })), at: new Date().toISOString() });
  try {
    for (;;) {
      const cur = (targets.length && prompts.get(prompt.id)) || prompt;
      const atPanel = _open.get(prompt.id)?.answer;
      if (atPanel) {
        try { prompts.cancel(prompt.id, AGENT); } catch { /* already gone */ }
        return { status: 'answered', device: { name: 'the person at the panel', kind: 'dashboard' }, ...atPanel,
          waitedSec: Math.round((Date.now() - (deadline - waitSec * 1000)) / 1000), targets, unshown };
      }
      const found = answerOf(cur, targets);
      if (found) {
        // Asked in several places, answered in one: close it everywhere else, or
        // the other screens keep offering choices nobody is waiting for. Left
        // alone when there was one target, so the device that answered keeps the
        // outcome view it was just shown instead of being told it closed.
        if (targets.length > 1) { try { prompts.cancel(prompt.id, AGENT); } catch { /* already gone */ } }
        return { ...found, waitedSec: Math.round((Date.now() - (deadline - waitSec * 1000)) / 1000), targets };
      }
      if (cur.state !== 'open') return { status: 'closed', reason: cur.state, targets };
      // Answered somewhere else — the panel, another device. The question is
      // withdrawn rather than left lit on a wrist offering choices that now
      // lead nowhere, which is the same rule the timeout below follows.
      if (signal?.aborted) {
        try { prompts.cancel(prompt.id, AGENT); } catch { /* already gone */ }
        return { status: 'cancelled', targets };
      }
      if (Date.now() >= deadline) {
        try { prompts.cancel(prompt.id, AGENT); } catch { /* already gone */ }
        return { status: 'timeout', waitedSec: waitSec, targets, unshown };
      }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  } finally {
    _open.delete(prompt.id);
    clearAgentOutbox();
  }
}

/* ── Telling ──────────────────────────────────────────── */

/**
 * Only the person's own devices, when the turn has a person: a device paired in someone else's name is never told
 * — nor asked, nor sent their files (2026-10-08). A device with no person (paired before accounts) is the hive's and stays in.
 * Naming another person's device is refused in so many words rather than matched to nothing.
 */
function ownTargets(to, personId) {
  const all = resolveTargets(to);
  const mine = personId ? all.filter(d => !d.userId || d.userId === personId) : all;
  if (!mine.length) {
    const want = String(to || '').trim();
    throw new Error(want && !['all', 'any'].includes(want.toLowerCase())
      ? `${all.map(label).join(', ')} ${all.length === 1 ? 'is' : 'are'} someone else's: a question, a notice or a file goes only to the person's own devices and chats.`
      : 'None of the paired devices is this person\'s own, so there is nobody to tell.');
  }
  // Only what can show it (reach-shows.js): a notice "sent" to a client that draws nothing reached nobody. The
  // error carries `unshown`, so a caller can say who could not show it and fall back to the panel.
  const showing = mine.filter(shows.shows);
  if (!showing.length) throw Object.assign(new Error(`No device of theirs could show it: ${shows.explain(mine)}.`), { unshown: mine });
  return showing;
}

/**
 * Tell, without waiting. One durable `alert` per device, high priority, so it
 * survives a watch being asleep and arrives when it wakes. `files` (reach-files.js
 * `read`) go with it, each stored as the recipient's own media; `imagePath` is the
 * one-picture form it shipped with.
 */
function tell({ to, title, text, imagePath, files, svg, urgent, personId } = {}) {
  const { bus, media, profiles, motion } = { ...api(), motion: require('../api-v1/motion') };
  const sending = require('./reach-files');
  const list = sending.read([...(imagePath ? [{ path: imagePath }] : []), ...(Array.isArray(files) ? files : [])]);
  const head = String(title || text || '').trim() || (list.length ? (list.length === 1 ? list[0].name : `${list.length} files`) : '');
  if (!head) throw new Error('A notice needs something to say.');

  const targets = ownTargets(to, personId).filter(d => profiles.get(d.id).prompts?.receive !== false);
  if (!targets.length) throw Object.assign(new Error('Every matching device declines notices in its profile (prompts.receive is false).'), { unshown: [] });

  const blocks = list.length ? sending.attach(list, targets) : new Map();
  const figure = figureBlock(svg, head);
  const priority = urgent ? 'urgent' : 'high';
  const id = `alt_${require('crypto').randomBytes(6).toString('hex')}`;

  const delivered = targets.map(d => {
    const body = [];
    if (title && text) body.push({ type: 'text', text: String(text).slice(0, 2000) });
    body.push(...(blocks.get(d.id) || []));
    if (figure) body.push(figure);
    const payload = { id, title: head.slice(0, 120), body: motion.tailorBlocks(motion.normalizeBlocks(body), d.caps), priority, haptic: true, from: AGENT_ID };
    bus.publish(d.id, 'alert', payload, { priority, ttlSec: 6 * 3600 });
    return { device: d, note: reachNote(d), files: sending.noteFor(d, list) };
  });
  media.purgeExpired?.();
  return { alertId: id, delivered, files: list.map(f => ({ name: f.name, kind: f.kind, bytes: f.bytes })),
    imageBytes: list.reduce((n, f) => n + f.bytes, 0) };
}

module.exports = { openQuestions, answerAtPanel, ask, tell, resolveTargets, ownTargets, reachNote, label, AGENT_ID, ASK_DEFAULT_SEC, ASK_MAX_SEC };
