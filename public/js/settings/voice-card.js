/* Settings → Voice → Voice: one card for how the hive speaks (asked 2026-10-08: "I am not sure where we find the
   differentiation of the settings between the Ambient, the Live call and the Deep call. I think we can have one mask to
   set up the voice, and one flag to check and enable different voices for different calls. That also manages which
   models are switched on."). It replaced two cards — this screen's voice, and each call's — and keeps every key they
   wrote, the screen-home setting `voice` (modules/call-voices.js):
     the voice     {engine, ttsVoice, ttsSpeed, hosted}: which service speaks, which of its voices, how fast (Advanced)
     each call     {quick, deep, ambient}: {service, voice, speed} — shown with "Different voices for each call"; the
                   Live call (the face, a device's call), the Deep call (the chat's 🎙), Ambient's assistant (unset:
                   the Live call's voice)
   for "this screen" (its own layer, any person for their own screen) or "the hive" (prefs.voice: every screen without
   its own, and devices with no screen of their own — a watch; an admin's). Beside each chosen service: whether it runs
   and "Start it" (voice-card-machines.js); a ▶ speaks a sample through what is chosen, before it is saved. Voices are
   typed or picked (lib/choice-input.js), a name the service does not list kept as typed and said so. */
const VOICE_CALLS = [
  { id: 'quick', title: 'Live call', who: 'the face, the watch' },
  { id: 'deep', title: 'Deep call', who: 'the chat’s 🎙' },
  { id: 'ambient', title: 'Ambient’s assistant', who: 'the Ambient page', same: 'Same as the Live call' },
];
let _vc = { scope: 'screen' };

const _vcHost = () => typeof authHasRight !== 'function' || authHasRight('host');

/** The `voice` value the chosen scope holds now: this screen's (what it uses) or the hive's own. */
const _vcValue = () => (_vc.scope === 'hive' ? _vc.prefs?.voice : _vc.screen?.settings?.voice) || {};

/** A service's voices as choices ({value, label}), and the list's source name, cached per engine for this drawing. */
async function _vcVoices(engine) {
  const key = engine || '';
  if (!_vc.voices[key]) {
    _vc.voices[key] = apiFetch(`/api/chat/voices${key ? `?engine=${encodeURIComponent(key)}` : ''}`).catch(() => ({ voices: [], engines: [] }));
  }
  const list = await _vc.voices[key];
  const names = list.names || {};
  const where = _vcWhere(key);
  return { list, items: (list.voices || []).map(v => ({ value: v, ...(names[v] ? { label: names[v] } : {}), ...(where ? { where } : {}) })), source: _vcEngineLabel(key, list) };
}

/** Where an engine's voices are served: on this machine, at another address, or by a service online. */
function _vcWhere(engine) {
  if (engine.startsWith('hosted:')) return 'a service, online';
  const hive = _vc.services?.hive;
  if (!engine && hive && !hive.row) { try { return `at ${new URL(hive.url).host}`; } catch { return ''; } }
  return 'served here';
}

function _vcEngineLabel(id, list) {
  if (!id) return 'the hive’s speech service';
  return (list?.engines || _vc.main?.engines || []).find(e => e.id === id)?.label || _vc.services?.services?.find(s => s.id === id)?.label || id;
}

/** The services a voice can be spoken by: the hive's, each speech row (running or not, for an admin), each service with a key. */
function _vcServiceOptions(chosen) {
  const seen = new Set(), opts = [];
  const add = (id, label) => { if (seen.has(id)) return; seen.add(id); opts.push([id, label]); };
  if (!_vc.main?.engines?.length) add('', 'The hive’s speech service');
  for (const e of _vc.main?.engines || []) add(e.id, `${e.label}${e.tags ? ' — expressive' : ''}`);
  for (const s of _vc.services?.services || []) if (s.engine) add(s.id, `${s.label}${s.running ? '' : ' — stopped'}`);
  if (chosen && !seen.has(chosen)) add(chosen, `${chosen} — ${chosen.startsWith('hosted:') ? 'its key is not kept (below)' : 'not running (Field → Models → Inference Services)'}`);
  return opts;
}

const _vcSelect = (id, opts, chosen, onchange) => `<select class="input" id="${id}" style="width:auto;max-width:100%" onchange="${onchange}">${
  opts.map(([v, l]) => `<option value="${escHtml(v)}" ${v === chosen ? 'selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`;

async function voiceCardRender(keep = {}) {
  const panel = document.getElementById('sp-voice');
  if (!panel) return;
  let s;
  try { s = await screenLoad(true); } catch { return; }
  const host = _vcHost();
  _vc = { scope: host ? keep.scope || _vc.scope || 'screen' : 'screen', screen: s, voices: {}, prefs: null, services: null, main: null };
  const [prefs, services] = await Promise.all([host ? apiFetch('/api/prefs').catch(() => null) : null, host ? apiFetch('/api/services/voices').catch(() => null) : null]);
  _vc.prefs = prefs; _vc.services = services;
  const v = _vcValue();
  const engine = keep.engine ?? v.engine ?? '';
  _vc.engine = engine;
  const main = await _vcVoices(engine);
  _vc.main = main.list; window._hvList = main.list;   // hosted-voice.js: the services, their keys' state, how each takes its key
  const hosted = engine.startsWith('hosted:');
  const voiceVal = engine === (v.engine || '') ? v.ttsVoice || '' : '';
  const split = keep.split ?? VOICE_CALLS.some(k => _vcSaid(v[k.id]));
  const own = s.from?.voice === 'device';
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'voice-card' });
  Object.assign(card.dataset, { scope: _vc.scope, engine });   // what it was drawn for (a test waits on it)
  card.innerHTML = `<span id="screen-voice-card"></span><span id="call-voices-card"></span>
    <div class="card-title">Voice</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">How answers are spoken — in a call and when a voice message is answered aloud.
      ${_vc.scope === 'hive' ? 'For every screen without its own, and devices with no screen of their own (a watch).' : `On <b>${escHtml(s.name || 'this screen')}</b>: ${own ? 'set here.' : 'now the hive’s.'}`}</p>
    ${host ? `<div class="toolbar vc-scope" role="radiogroup" aria-label="Applies to" style="gap:14px;margin-bottom:10px;justify-content:flex-start">
      <label style="font-size:12px"><input type="radio" name="vc-scope" value="screen" ${_vc.scope === 'screen' ? 'checked' : ''} onchange="voiceCardRender({scope: 'screen'})"> This screen</label>
      <label style="font-size:12px"><input type="radio" name="vc-scope" value="hive" ${_vc.scope === 'hive' ? 'checked' : ''} onchange="voiceCardRender({scope: 'hive'})"> The hive</label></div>` : ''}
    <div class="vc-row" data-kind="main">
      <div class="toolbar" style="gap:6px;flex-wrap:wrap;justify-content:flex-start">
        ${_vcSelect('vc-engine', _vcServiceOptions(engine), engine, 'voiceCardService(this.value)')}
        ${choiceInput({ id: 'vc-voice', value: voiceVal, items: main.items, source: main.source, width: '220px', placeholder: hosted ? 'a voice of the service' : `its own (${main.list.default || main.list.hive || 'default'})`,
          load: async () => { delete _vc.voices[engine]; return _vcVoices(engine); } })}
        <button class="btn btn-sm" onclick="voiceCardTry('main')" title="Speak a sample in this voice" aria-label="Speak a sample in this voice">▶</button>
      </div>
      ${voiceCardState(engine)}
      ${hosted ? hostedVoiceFields(main.list, v) : ''}
      ${advancedFold(`<label style="font-size:12px;display:flex;gap:6px;align-items:center">Speed <input class="input" id="vc-speed" type="number" min="0.5" max="2" step="0.1"
        data-default="" data-label="Speed" placeholder="as the voice" value="${escHtml(v.ttsSpeed ?? '')}" style="width:100px"></label>`, { id: 'voice-card-speed' })}
    </div>
    <label style="display:flex;gap:8px;align-items:center;font-size:12px;margin-top:6px"><input type="checkbox" id="vc-split" ${split ? 'checked' : ''}
      onchange="document.getElementById('vc-calls').hidden = !this.checked"> Different voices for each call</label>
    <div id="vc-calls" ${split ? '' : 'hidden'} style="margin-top:8px">${await voiceCallsHtml(v, engine)}</div>
    <div class="toolbar" style="gap:6px;margin-top:12px;justify-content:flex-start">
      <button class="btn btn-sm btn-blue" onclick="voiceCardSave()">Save ${_vc.scope === 'hive' ? 'for the hive' : 'for this screen'}</button>
      ${_vc.scope === 'screen' && own ? '<button class="btn btn-sm" onclick="voiceCardSave(true)">Back to the hive’s</button>' : ''}
      <span class="status-line" id="vc-status"></span></div>
    ${voiceCardUnused()}
    ${hostedVoiceSetup(main.list)}`;
  const old = document.getElementById('voice-card');
  if (old) old.replaceWith(card); else panel.prepend(card);   // first on the page: /#settings/voice lands here
}

const _vcSaid = q => q && typeof q === 'object' && (q.service || q.voice || Number(q.speed) > 0);

/** Another service chosen for the voice: drawn again with its voices (nothing saved yet). */
function voiceCardService(engine) {
  const split = document.getElementById('vc-split')?.checked;
  voiceCardRender({ scope: _vc.scope, engine, split });
}

/** What the card says, as the `voice` value for its scope; other keys the value holds are kept. */
function voiceCardValue() {
  const g = id => document.getElementById(id)?.value?.trim() || '';
  const engine = g('vc-engine'), voice = g('vc-voice'), speed = parseFloat(g('vc-speed'));
  const hosted = engine.startsWith('hosted:') ? hostedVoiceValue() : null;   // the service's model and options (hosted-voice.js)
  const out = { ..._vcValue() };
  for (const k of ['engine', 'ttsVoice', 'ttsSpeed', 'hosted', ...VOICE_CALLS.map(c => c.id)]) delete out[k];
  if (engine) out.engine = engine;
  if (voice) out.ttsVoice = voice;
  if (speed > 0) out.ttsSpeed = speed;
  if (hosted) out.hosted = hosted;
  if (document.getElementById('vc-split')?.checked) for (const k of VOICE_CALLS) { const slot = voiceCallSlot(k.id); if (slot) out[k.id] = slot; }
  return out;
}

async function voiceCardSave(reset = false) {
  const status = document.getElementById('vc-status');
  const value = reset ? null : voiceCardValue();
  const empty = !value || !Object.keys(value).length;
  try {
    if (_vc.scope === 'hive') await apiFetch('/api/prefs?replace=1', { method: 'POST', body: { voice: empty ? {} : value } });   // the whole voice section, as built here: a cleared slot goes
    else await screenSave({ voice: empty ? null : value });
  } catch (e) { return setStatus(status, `✗ ${e.message}`, 'err'); }
  await voiceCardRender({ scope: _vc.scope });
  setStatus(document.getElementById('vc-status'), '✓ Saved', 'ok');
}
