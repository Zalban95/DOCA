'use strict';

/**
 * A paired device and the model relay (relay/index.js; the owner's yes of 2026-10-14): a device whose token holds
 * `relay:use` and whose own relay switch is on asks the hub's models at `/api/v1/relay` (api-v1 route in relay/v1.js),
 * over the panel's own HTTPS — never the computers' listener on the Docker bridge.
 *
 * Switching a device on, in the owner's words: "if the devices are just extensions of the phone they can just be added
 * without password … If they're output only no problem, maybe keep the password for devices that can input text as
 * well." So the switch asks for the password (auth/guarded.js, the row naming this route) unless the device is
 *   an extension of a phone — paired through one (`pairedBy`, the phone that minted its code, as a watch is; wake.js),
 *     that phone still paired and of the same person;
 *   or output-only — a watch, glasses or a car whose caps declare neither text nor voice input.
 * Anything else takes text: a phone, a desktop, a browser, a program (`kind: agent`), or a device that says nothing
 * about its inputs. The responsibility for pairing the wrong device is the pairing person's; what each device does
 * through the relay is kept with its tag (`relay:device:<id>`) in the usage ledger and Chronicle, so misuse is traced.
 */
const { hasScope } = require('../api-v1/scopes');

const SCOPE = 'relay:use';
const OUTPUT_FORMS = new Set(['watch', 'glasses', 'car']);
const devices = () => require('../api-v1/devices');

/** The phone this device extends, or null. */
function extensionOf(d) {
  if (!d?.pairedBy) return null;
  const phone = devices().get(d.pairedBy);
  if (!phone || phone.revokedAt || phone.caps?.formFactor !== 'phone') return null;
  if (d.userId && phone.userId && d.userId !== phone.userId) return null;
  return phone;
}

/** Whether the device can put text of its own into a request: anything but an output-only watch, pair of glasses or car. */
function takesText(d) {
  const input = d?.caps?.input || {};
  if (input.text || input.voice) return true;
  return (d?.kind || 'device') !== 'device' || !OUTPUT_FORMS.has(d?.caps?.formFactor);
}

/** Why switching it on asks for the password, or does not: { asks, why }. */
function judge(d) {
  const phone = extensionOf(d);
  if (phone) return { asks: false, why: `an extension of the phone "${phone.name}"` };
  if (!takesText(d)) return { asks: false, why: 'output only: it takes no text' };
  return { asks: true, why: 'it can send text of its own' };
}

/** The guard's question (auth/guarded.js): switching this device on asks for the password. */
function asksPassword(id) {
  const d = devices().get(String(id || ''));
  return !!d && !d.revokedAt && judge(d).asks;
}

const via = d => `relay:device:${d.id}`;

/** Devices the relay can be switched on for: paired with a token (not a browser record or a linked chat), not revoked. */
const eligible = d => d && !d.revokedAt && ['device', 'agent'].includes(d.kind || 'device');

/** For the owner's card: each device with its switch and whether turning it on asks. Never a token. */
function list() {
  return devices().list().filter(eligible).map(d => ({ id: d.id, name: d.name, kind: d.kind || 'device', formFactor: d.caps?.formFactor || 'other',
    on: !!d.relayOn, scoped: hasScope(d.scopes, SCOPE), ...judge(d) }));
}

/**
 * Its switch. On grants `relay:use` when its token lacks it (a device paired before the scope existed) and is noted in
 * the activity log with whose it is and why it did or did not ask; off takes the scope's answer away at once.
 */
function set(id, on, by = null) {
  const d = devices().get(String(id || ''));
  if (!eligible(d)) throw Object.assign(new Error('No paired device with a token by that id (a browser or a linked chat has none of its own).'), { status: 404 });
  const scopes = on && !hasScope(d.scopes, SCOPE) ? [...d.scopes, SCOPE] : undefined;
  devices().update(d.id, { relayOn: !!on, ...(scopes ? { scopes } : {}) });
  const j = judge(d);
  const owner = d.userId ? require('../auth/store').userById(d.userId) : null;
  require('../activity').note({ from: by?.id ? 'person' : 'relay', what: `the model relay ${on ? 'on' : 'off'} for the device ${d.name}`,
    why: on ? `${j.why}${j.asks ? ' — the password was typed' : ''}` : 'switched off', person: by?.id ? by : owner,
    machine: { kind: 'device', id: d.id, name: d.name }, act: on ? 'relay-on' : 'relay-off', via: via(d), ok: true });
  return { id: d.id, name: d.name, on: !!on, ...j };
}

module.exports = { SCOPE, extensionOf, takesText, judge, asksPassword, eligible, list, set, via };
