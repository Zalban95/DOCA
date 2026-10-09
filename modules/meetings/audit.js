'use strict';

/**
 * Every screen shared and every hand on someone else's machine, written down (CONSTITUTION §1, nothing runs unseen):
 * the audit (who, when, what — Hub → Admin's record of changes) and a line in the hub's activity, which Chronicle's
 * `hub` source tells with a person filter. Who, when, whose machine, and why it ended — never what was on the screen,
 * never a key that was pressed (typing is counted in characters at most).
 */
const title = roomId => require('./rooms').get(roomId)?.title || roomId;
const person = p => (p?.personId || p?.id ? { id: p.personId || p.id, name: p.name } : null);

function write({ orgId, actorId, action, detail, line, who, machine = null, act = null, ok = null }) {
  try { require('../auth/store').audit({ orgId: orgId || null, actorId: actorId || null, action, detail }); } catch { /* never breaks the call */ }
  require('../activity').note({ from: 'meetings', what: line, person: who, machine, act, ok });
}

/** A share started or stopped. */
function share(roomId, peer, on, why = '') {
  write({ orgId: peer.orgId, actorId: peer.personId, action: on ? 'meeting.share.start' : 'meeting.share.stop',
    detail: `${roomId}${why ? ` (${why})` : ''}`, who: person(peer),
    line: `${peer.name} ${on ? 'started' : 'stopped'} sharing their screen in "${title(roomId)}"${why ? ` — ${why}` : ''}` });
}

/** A step of taking control: requested, offered (consent 1), granted (consent 2), refused, ended. */
function control(g, step, why = '') {
  const machine = g.deviceId ? { kind: 'device', id: g.deviceId, name: g.deviceName || g.deviceId } : null;
  const words = {
    requested: `${g.controllerName} asked to control ${g.sharerName}'s screen`,
    offered: `${g.sharerName} offered ${g.controllerName} control of ${g.deviceName}`,
    granted: `${g.sharerName} let ${g.controllerName} control ${g.deviceName}`,
    refused: `${g.controllerName} could not control ${g.sharerName}'s screen`,
    ended: `${g.controllerName}'s control of ${g.deviceName || `${g.sharerName}'s screen`} ended`,
  }[step];
  write({ orgId: g.orgId, actorId: step === 'requested' ? g.controllerId : g.sharerId, action: `meeting.control.${step}`,
    detail: `${g.roomId} ${g.deviceId || ''} → ${g.controllerId}${why ? ` (${why})` : ''}`.trim(),
    who: { id: g.sharerId, name: g.sharerName }, machine: step === 'granted' || step === 'ended' ? machine : null,
    act: step === 'granted' ? 'control' : step === 'ended' ? 'release' : null, ok: step === 'refused' ? false : null,
    line: `${words} in "${title(g.roomId)}"${why ? ` — ${why}` : ''}` });
}

/** A meeting made, changed or cancelled. */
function meeting(m, step, by) {
  write({ orgId: m.orgId, actorId: by?.id, action: `meeting.${step}`, detail: m.id, who: by ? { id: by.id, name: by.name } : null,
    line: `${by?.name || 'Someone'} ${step} the meeting "${m.title}"` });
}

module.exports = { share, control, meeting };
