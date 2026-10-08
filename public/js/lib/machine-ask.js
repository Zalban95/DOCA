/* Asking before a machine is stopped, restarted or removed (asked 2026-10-08: "add a confirmation when a machine or a
   docker container's (and so on) closing button is pressed by the user, so we do not close a service in use"). Every
   button that stops, restarts, kills or removes a container, a service, a llama.cpp server, a VM, a computer, a VNC
   screen, the stack or an MCP server asks this one question, naming what uses it right now — the hive's voice, the
   agent's model, a running mission, an open console — from GET /api/machines/use (modules/machines/use.js). Starting
   and opening do not ask. */
const MACHINE_ASK_VERB = { stop: 'Stop', restart: 'Restart', reboot: 'Restart', kill: 'Cut the power to', remove: 'Remove', rm: 'Remove',
  delete: 'Delete', update: 'Update', 'listener-stop': 'Stop' };
const MACHINE_ASK_STOPS = /^(stop|restart|reboot|kill|remove|rm|delete|update|listener-stop)$/;

/** Ask, then `go()`. `extra`: the button's own sentence about what is lost (a VM's power cut, a computer's files). */
async function machineAsk(kind, id, verb, name, go, extra = '') {
  let use = null;
  try { use = await apiFetch(`/api/machines/use?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`); } catch { /* asked without it */ }
  // A sentence opening on a plain word gets its capital; one opening on a machine's own name keeps that name as it is.
  const reasons = (use?.reasons || []).map(r => `• ${/^(it|an|a|the|someone|\d)\b/.test(r) ? r.charAt(0).toUpperCase() + r.slice(1) : r}`);
  const said = use === null ? 'DOCA could not tell what is using it right now.'
    : reasons.length ? `In use right now:\n${reasons.join('\n')}` : 'Nothing DOCA can see is using it right now.';
  appConfirm([`${MACHINE_ASK_VERB[verb] || verb} ${name || use?.name || id}?`, extra, said].filter(Boolean).join('\n\n'), go);
}

/** For a button that both starts and stops: true when it asked (and will call `again()` on yes), false to go on. */
function machineAskFirst(kind, id, verb, name, again, extra = '') {
  if (!MACHINE_ASK_STOPS.test(String(verb))) return false;
  machineAsk(kind, id, verb, name, again, extra);
  return true;
}
