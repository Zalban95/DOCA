'use strict';

/**
 * `npm run experiment -- realtime-voice` (docs/experiments/realtime-voice.md): the configured realtime service is
 * given typed utterances — small talk, and questions only the hive can answer — and for each one the script measures
 * the time to the first audio and whether the model routed it right (the `doca` tool for the hive's questions, none
 * for small talk). The tool is answered at once with a canned line, so what is timed is the voice service alone.
 * Typed words skip the service's speech recognition: the microphone path is measured by hand in real calls.
 * Runs inside bin/doca-experiment.js on its throwaway copy of the settings; spends the provider's minutes.
 */
const CASES = [
  { say: 'Hi! How are you today?', hive: false },
  { say: 'How many containers are running on my machine right now?', hive: true },
  { say: 'Thanks, that is all.', hive: false },
  { say: 'What is in my notes about the backup schedule?', hive: true },
  { say: 'Start the ComfyUI service, please.', hive: true },
];

function once(rt, s, t, text) {
  return new Promise(resolve => {
    const m = rt.ADAPTERS[s.protocol].connect({ ...t, model: s.model, voice: s.voice, dialect: s.dialect, instructions: rt.INSTRUCTIONS, tools: [rt.TOOL] });
    const r = { firstAudioMs: null, tool: false, error: null }, t0 = { at: 0 };
    const done = () => { clearTimeout(timer); m.close(); resolve(r); };
    const timer = setTimeout(() => { r.error = r.error || 'no answer in 30 s'; done(); }, 30000);
    m.on('ready', () => { t0.at = Date.now(); m.userText(text); });
    m.on('audio', () => { if (r.firstAudioMs === null) r.firstAudioMs = Date.now() - t0.at; });
    m.on('tool', ({ id }) => { r.tool = true; m.toolResult(id, 'Four containers are running.'); });
    m.on('turn', () => { if (r.firstAudioMs !== null) done(); });
    m.on('error', e => { r.error = e; });
    m.on('closed', done);
  });
}

async function measure() {
  const rt = require('../../modules/realtime');
  const s = rt.settings();
  if (!s.model) { console.log('No realtime model is set (realtime.model) on this machine, so nothing can be measured.'); return 0; }
  const t = rt.target(s);
  const rows = [];
  for (const c of CASES) rows.push({ ...c, ...(await once(rt, s, t, c.say)) });
  console.log(JSON.stringify(rows, null, 2));
  const ok = rows.filter(r => !r.error), right = ok.filter(r => r.tool === r.hive).length;
  const lat = ok.map(r => r.firstAudioMs).filter(x => x != null).sort((a, b) => a - b);
  const med = lat.length ? lat[Math.floor(lat.length / 2)] : null;
  console.log(`\n| ${new Date().toISOString().slice(0, 10)} | ${s.protocol} / ${s.model} | ${right} of ${rows.length} routed right | ${med != null ? (med / 1000).toFixed(2) : '—'} s median to first audio | ${rows.length - ok.length} failed |`);
  return 0;
}

module.exports = { measure };
