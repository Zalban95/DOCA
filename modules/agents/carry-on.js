'use strict';

/**
 * Work goes on until it is finished, or the person releases it (CONSTITUTION V10, 2026-10-07): a mission a restart cut
 * off resumes by itself, as work chats already do (supervisor.recover) — a restart is not a decision. One that cannot
 * (specialists switched off, its specialist gone) stays paused, and the Orchestrator asks as before (missions.block).
 * A short delay lets the panel finish starting first.
 */
function carryOn(stuck = [], { delayMs = 3000 } = {}) {
  if (!stuck.length) return;
  const t = setTimeout(() => {
    for (const m of stuck) {
      try { require('./missions').resume(m.id, { go: true }); console.warn(`[agents] mission ${m.id} (${m.label}) carried on after the restart`); }
      catch (e) { console.warn(`[agents] mission ${m.id} stays paused: ${e.message}`); }
    }
  }, delayMs);
  t.unref?.();
}

module.exports = { carryOn };
