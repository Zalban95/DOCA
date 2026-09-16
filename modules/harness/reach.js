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
const fs   = require('fs');
const path = require('path');

/**
 * Who the prompt says it is from. Not a device — the harness is the hub, not a
 * client of it — but the prompt system publishes its author's copies of an
 * event by id, so this leaves an outbox behind that `clearAgentOutbox()` sweeps.
 */
const AGENT_ID = 'harness';
const AGENT = { id: AGENT_ID, scopes: ['*'] };

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

const ASK_DEFAULT_SEC = 120;
const ASK_MAX_SEC     = 900;
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

/**
 * Resolve what the model said into devices that can actually receive this.
 *
 * `to` may be a device id, a form factor, a name or part of one, or nothing at
 * all — which means every device that can be interacted with, the same audience
 * an external agent gets when it omits `targets`. A miss lists what does exist,
 * because a dead end with no directions is how a model starts guessing ids.
 */
function resolveTargets(to) {
  const { devices, scopes } = api();
  const live = devices.list().filter(d => !d.revokedAt && scopes.hasScope(d.scopes, 'interact'));
  if (!live.length) {
    const any = devices.list().filter(d => !d.revokedAt).length;
    throw new Error(any
      ? `None of the ${any} paired devices can receive a question or a notice — that needs the "interact" scope. Check doca_clients; a viewer-preset device is read-only on purpose.`
      : 'No devices are paired with this hub, so there is nobody to reach. Pairing happens in the dashboard (Devices).');
  }
  const want = String(to || '').trim().toLowerCase();
  if (!want || want === 'all' || want === 'any') return live;

  const hit = live.filter(d =>
    d.id.toLowerCase() === want ||
    String(d.caps?.formFactor || '').toLowerCase() === want ||
    d.name.toLowerCase() === want ||
    d.name.toLowerCase().includes(want));
  if (!hit.length) throw new Error(`No device matches "${to}". These can be reached: ${live.map(label).join(', ')}.`);
  return hit;
}

/** Whether a device is likely to see this now, for a report the model can act on. */
function reachNote(d) {
  const { bus, profiles } = api();
  if (bus.isOnline(d.id)) return 'now';
  const prof = profiles.get(d.id);
  if (prof.prompts?.receive === false) return 'declines prompts in its profile';
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

/**
 * Ask, and wait. Resolves with what the model needs to carry on:
 * `{ status: 'answered' | 'dismissed' | 'timeout' | 'closed', ... }`.
 */
async function ask({ to, question, choices, note, timeoutSec } = {}) {
  const { prompts } = api();
  const text = String(question || '').trim();
  if (!text) throw new Error('A question needs to be asked in words.');

  const targets = resolveTargets(to);
  const built = buildChoices(choices);
  const waitSec = Math.min(ASK_MAX_SEC, Math.max(5, Number(timeoutSec) || ASK_DEFAULT_SEC));

  const { prompt } = prompts.create({
    title: text.slice(0, 120),
    body: note ? [{ type: 'text', text: String(note).slice(0, 800) }] : [],
    choices: built,
    targets: targets.map(d => d.id),
    priority: 'high',
    // The prompt outlives the wait by a little so a tap landing as the wait ends
    // is answered rather than met with "closed".
    ttlSec: waitSec + 30,
  }, AGENT);

  const deadline = Date.now() + waitSec * 1000;
  try {
    for (;;) {
      const cur = prompts.get(prompt.id) || prompt;
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
      if (Date.now() >= deadline) {
        try { prompts.cancel(prompt.id, AGENT); } catch { /* already gone */ }
        return { status: 'timeout', waitedSec: waitSec, targets };
      }
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  } finally {
    clearAgentOutbox();
  }
}

/* ── Telling ──────────────────────────────────────────── */

/** Read a picture from disk and store one copy per recipient. */
function attachImage(imagePath, targets) {
  const { media } = api();
  const abs = path.resolve(imagePath);
  const mime = MIME_BY_EXT[path.extname(abs).toLowerCase()];
  if (!mime) throw new Error(`${path.basename(abs)} is not an image this can send (png, jpg, webp or gif).`);
  if (!fs.existsSync(abs)) throw new Error(`No such file: ${abs}`);
  const buf = fs.readFileSync(abs);
  const saved = targets.map(d => {
    try { return { deviceId: d.id, id: media.save(buf, mime, d.id, { source: 'agent', name: path.basename(abs) }).id }; }
    catch (e) {
      // The size limit is media's, and naming it beats "failed": the agent can
      // scale the image down, which is the fix a person would apply too.
      throw new Error(`${path.basename(abs)} could not be sent: ${e.message}`);
    }
  });
  return { bytes: buf.length, byDevice: new Map(saved.map(s => [s.deviceId, s.id])) };
}

/**
 * Tell, without waiting. One durable `alert` per device, high priority, so it
 * survives a watch being asleep and arrives when it wakes.
 */
function tell({ to, title, text, imagePath, urgent } = {}) {
  const { bus, media, profiles, motion } = { ...api(), motion: require('../api-v1/motion') };
  const head = String(title || text || '').trim();
  if (!head) throw new Error('A notice needs something to say.');

  const targets = resolveTargets(to).filter(d => profiles.get(d.id).prompts?.receive !== false);
  if (!targets.length) throw new Error('Every matching device declines notices in its profile (prompts.receive is false).');

  const image = imagePath ? attachImage(imagePath, targets) : null;
  const priority = urgent ? 'urgent' : 'high';
  const id = `alt_${require('crypto').randomBytes(6).toString('hex')}`;

  const delivered = targets.map(d => {
    const body = [];
    if (title && text) body.push({ type: 'text', text: String(text).slice(0, 2000) });
    if (image) body.push({ type: 'media', mediaId: image.byDevice.get(d.id), alt: path.basename(imagePath) });
    const payload = { id, title: head.slice(0, 120), body: motion.tailorBlocks(motion.normalizeBlocks(body), d.caps), priority, haptic: true, from: AGENT_ID };
    bus.publish(d.id, 'alert', payload, { priority, ttlSec: 6 * 3600 });
    return { device: d, note: reachNote(d) };
  });
  media.purgeExpired?.();
  return { alertId: id, delivered, imageBytes: image?.bytes || 0 };
}

module.exports = { ask, tell, resolveTargets, reachNote, label, AGENT_ID, ASK_DEFAULT_SEC, ASK_MAX_SEC };
