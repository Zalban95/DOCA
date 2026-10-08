'use strict';

/**
 * The agent's VNC tools (asked 2026-10-08 with the VNC section of Machines): `vnc_look` sees a VNC target's screen and
 * `vnc_input` clicks, scrolls and types on it. The owner's rule (2026-10-08): "If I ask clearly the orchestrator to take
 * control of a machine, that's totally fine; if the agents need a machine to test something, they might ask for
 * confirmation." So a person's own turn uses them under the ordinary approvals (neither is free: asked in Manual); a
 * specialist holds them only for the target its mission was lent (agent_dispatch vnc:), and its vnc_input is always a
 * person's decision (forced-asks.js). A target is an admin's until allotted (`use:vnc:<id>`, auth/allot.js), a person
 * driving it makes vnc_input wait, and no kept secret is ever typed. Both exist once a target is added (tool-shape.js).
 */
const bad = m => `Error: ${m}`;

/** The target, or a refusal: off, unknown, not allotted, or not the one lent to this mission. */
function reach(ref, ctx) {
  const store = require('../../vnc-targets/store');
  const t = store.find(ref);
  if (!t) { const names = store.list().map(x => x.name); return { no: `no VNC target "${ref}". ${names.length ? `There are: ${names.join(', ')}.` : 'None is added yet (Machines → VNC).'}` }; }
  const allot = require('../../auth/allot');
  if (!allot.uses(ctx.user, 'vnc', t.id) && !allot.uses(ctx.user, 'vnc', t.name)) return { no: allot.refusal(ctx.user, 'vnc', t.name) };
  const s = ctx.sessionId ? require('../memory').getSession(ctx.sessionId) : null;
  if (s?.kind === 'specialist' && s.profile?.vnc !== t.id) return { no: `VNC target ${t.name} was not lent to this mission; say so in your report and your leader sends you back with it.` };
  return { t };
}

/** Every secret DOCA keeps that could end up typed: VNC passwords, logins' passwords, keys for services, the hub's sealed secrets. */
async function secrets() {
  const out = [...require('../../vnc-targets/store').passwords()];
  try { const l = require('../../logins'); for (const x of l.list()) out.push(l.secretOf(x.id)?.value); } catch { /* none */ }
  try { const k = require('../../service-keys'); for (const x of k.list()) out.push(k.secretOf(x.name)?.value); } catch { /* none */ }
  try { const v = require('../../sealed/vault'); for (const x of await v.list()) out.push((await v.reveal(x.name))?.value); } catch { /* none */ }
  return out.filter(s => typeof s === 'string' && s.length >= 4);
}

async function look({ target, question, how }, ctx = {}) {
  const { t, no } = reach(target, ctx);
  if (no) return bad(no);
  let shot;
  try { shot = await require('../../vnc-targets/shots').capture(t.id, 1920); } catch (e) { return bad(e.message); }
  const kept = require('../../mcp/content').keep({ type: 'image', data: shot.png.toString('base64'), mimeType: 'image/png' }, `vnc-${t.name.replace(/[^\w.-]+/g, '-')}`);
  const size = `${t.name}'s screen is ${shot.width}×${shot.height}${shot.scale > 1 ? `; the picture is 1/${shot.scale} of it, so multiply what you read off it by ${shot.scale}` : ''} — vnc_input takes screen pixels.`;
  if (!String(question || '').trim()) return `${kept}\n${size}`;
  const lookOn = require('../../computers/look').on();
  if (!lookOn) return `${kept}\n${size}\nThe vision pass is off, so nothing read the picture: show it to the person, or ask them.`;
  const vision = require('../../vision');
  try { return `${kept}\n${size}\n${vision.say(await vision.read(shot.png, question, { how: how || 'auto', person: ctx.user }))}`; }
  catch (e) { return `${kept}\n${size}\nError reading it: ${e.message}`; }
}

async function input(a, ctx = {}) {
  const { t, no } = reach(a.target, ctx);
  if (no) return bad(no);
  const state = require('../../vnc-targets/state');
  if (state.driving(t.id)) return `Not run: a person is driving ${t.name} right now (they took over from its console). Your input waits until they hand it back — look with vnc_look meanwhile, or try again later.`;
  const make = require('../../vnc-targets/input');
  const n = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  let events, said;
  try {
    if (a.action === 'type') {
      const text = String(a.text ?? '');
      if (!text) return bad('say what to type (text).');
      if (text.length > 2000) return bad('type at most 2000 characters at a time.');
      if ((await secrets()).some(s => text.includes(s))) return bad('not typed: the text holds a password or key DOCA keeps. A secret goes into a screen only through secret_use (one of the person\'s devices) or computer_login (a computer\'s browser) — never typed by you.');
      events = make.typing(text); said = `Typed ${text.length} character${text.length === 1 ? '' : 's'}`;
    } else if (a.action === 'key') { events = make.combo(a.keys); said = `Pressed ${a.keys}`; }
    else {
      const x = n(a.x), y = n(a.y);
      if (x == null || y == null) return bad('say where, in screen pixels (x, y): vnc_look gives the screen\'s size.');
      if (a.action === 'click' || a.action === 'double_click' || a.action === 'right_click') {
        events = make.click(x, y, a.action === 'right_click' ? 'right' : 'left', a.action === 'double_click' ? 2 : 1); said = `${a.action.replace('_', ' ')} at ${x},${y}`;
      } else if (a.action === 'move') { events = [{ x, y, mask: 0 }]; said = `Moved to ${x},${y}`; }
      else if (a.action === 'scroll') { events = make.scroll(x, y, a.direction || 'down', a.amount ?? 3); said = `Scrolled ${a.direction || 'down'} at ${x},${y}`; }
      else return bad('action is click, double_click, right_click, move, scroll, type or key.');
    }
    const size = await require('../../vnc-targets/rfb').act(require('../../vnc-targets/store').connection(t.id), events);
    const back = state.handedBack(t.id);
    if (back) state.clearHandBack(t.id);
    return `${back ? `[A person drove ${t.name} until ${back} and handed it back: look again before trusting what you saw earlier.]\n` : ''}`
      + `${said[0].toUpperCase()}${said.slice(1)} on ${t.name} (${size.width}×${size.height}). Look with vnc_look to see what changed.`;
  } catch (e) { return bad(e.message); }
}

/** For agent_dispatch vnc: the target's id when this turn may lend it ({ no } otherwise). */
function lendable(ref, ctx = {}) { const { t, no } = reach(ref, ctx); return no ? { no } : { id: t.id }; }

module.exports = [
  {
    name: 'vnc_look',
    description: 'See the screen of a VNC target (another machine the owner added under Machines → VNC): the picture is kept as an '
      + 'attachment to show with show_media, with the screen\'s size; with a question and the vision pass on, it is also read — what '
      + 'is visible and where, in screen pixels for vnc_input.',
    parameters: { type: 'object', properties: {
      target: { type: 'string', description: 'The VNC target\'s name or id.' },
      question: { type: 'string', description: 'Optional: what to find or read on it, e.g. "where is the Start button?".' },
      how: { type: 'string', enum: ['auto', 'model', 'text', 'detector', 'template'], description: 'Which reader, when there is a question; auto is the owner\'s choice.' },
    }, required: ['target'] },
    run: look,
  },
  {
    name: 'vnc_input',
    description: 'Act on a VNC target\'s screen (another machine): click, double_click, right_click, move or scroll at x,y in screen '
      + 'pixels, type text, or press keys ("Enter", "ctrl+l", "ctrl+alt+Delete"). Look with vnc_look first and after. It waits while '
      + 'a person drives that screen, and it never types a password or key: those go through secret_use or computer_login.',
    parameters: { type: 'object', properties: {
      target: { type: 'string', description: 'The VNC target\'s name or id.' },
      action: { type: 'string', enum: ['click', 'double_click', 'right_click', 'move', 'scroll', 'type', 'key'] },
      x: { type: 'number', description: 'click, move, scroll: from the left, in screen pixels.' },
      y: { type: 'number', description: 'click, move, scroll: from the top, in screen pixels.' },
      text: { type: 'string', description: 'type: the text.' },
      keys: { type: 'string', description: 'key: one key or a combination joined by +, e.g. "Enter", "ctrl+c", "super".' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'scroll: which way (down by default).' },
      amount: { type: 'number', description: 'scroll: how many notches (3 by default).' },
    }, required: ['target', 'action'] },
    run: input,
  },
];
module.exports.lendable = lendable;
