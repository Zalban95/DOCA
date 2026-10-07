'use strict';

/**
 * The calls that are always a person's decision, in every approval mode, Unattended included, and never "always
 * allowed" — besides what governs the agent (control-plane.js), which approval.gate checks first: signing in with a
 * stored login, and a control that pays, buys, signs in, confirms or submits, which a computer's browser, the person's
 * browser or a device marks by refusing it without confirm: true (TODO H5.4, H5.5, A4). Moved out of approval.js,
 * which may only shrink.
 */
function of(name, args, summarize) {
  // A computer's browser on a control that pays, buys, signs in or submits (the computer refuses it without confirm:
  // computers' clients/computer/tools.js sensitive()): always a person's decision, every mode, never "always" (TODO H5.4).
  if (name === 'computer_login') return { tool: name, keys: null, forced: true,
    summary: `Sign in on computer ${args?.computer} with the stored login "${args?.login}" — the hub types its password; the agent never sees it. Always asked.` };
  // A secret handed to a device (sealed/use.js, CONSTITUTION S4): whoever holds that device then has it. A person's yes
  // each time, naming the secret, the device and where it goes.
  if (name === 'secret_use') {
    let where = 'its clipboard';
    try { where = require('../sealed/use').describe(args?.ref !== undefined && args?.ref !== null ? 'field' : args?.mode === 'type' ? 'type' : 'clipboard',
      { ref: args?.ref, tab: args?.tab, origin: 'the secret\'s own site', uses: Number(args?.uses) || 1, ttlSec: Number(args?.seconds) || 30 }); } catch { /* described plainly */ }
    return { tool: name, keys: null, forced: true,
      summary: `Hand the secret "${args?.secret}" to the device ${args?.device} — ${where}. The hub sends it sealed for that device; the agent never sees it. Always asked.` };
  }
  if (/^mcp__[\w-]+__browser_(click|type)$/.test(name) && args?.confirm === true)   // a computer's browser, or the person's own (H5.5)
    return { tool: name, keys: null, forced: true, summary: `${summarize(name, args)} — on a control that pays, buys, signs in or submits in a browser. Always asked, whatever the approval mode.` };
  // Any device's tool called with confirm: true (TODO A4, audit 2026-10-06 cl 5): a phone's screen_press on "Pay now",
  // a desk's input on a submit — the device refuses such a press without confirm, and confirm is a person's yes, never
  // the agent's. Every mode, never "always".
  if (/^mcp__/.test(name) && args?.confirm === true)
    return { tool: name, keys: null, forced: true, summary: `${summarize(name, args)} — the device says this decides something (pays, buys, signs in, confirms or submits). Always asked, whatever the approval mode.` };
  // A hub command the registry marks confirm (stopping a service, a snapshot): a person's, as on a phone (TODO B6b).
  if (name === 'hub_command' && args?.action === 'run') {
    const c = require('../api-v1/commands').describe(String(args.id || ''));
    if (c?.confirm) return { tool: name, keys: null, forced: true, summary: `Run the hub command ${c.id} — ${c.title}${args.params ? ` ${JSON.stringify(args.params)}` : ''}. Always asked, whatever the approval mode.` };
  }
  return null;
}

module.exports = { of };
