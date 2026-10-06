'use strict';

/**
 * Assistant mode's settings (a call started from the face: settings-schema `assistant`, turn/effort.js,
 * turn/client.js): GET /api/assistant (read), POST /api/assistant (a host's) — effort, style, provider, model.
 * Settings → Voice → Live call draws them.
 */
const sc = () => require('../settings-schema');
const view = () => ({ reply: sc().value('assistant.reply'), calls: sc().value('assistant.calls'), effort: sc().value('assistant.effort'), style: sc().value('assistant.style'), provider: sc().value('assistant.provider'),
  model: sc().value('assistant.model'), defaults: { style: sc().leaf('assistant.style')?.default } });
const KEYS = { reply: /^(act|brief|always)$/, effort: /^(off|low|medium|high|default)$/, provider: /^[\w.-]{0,60}$/, model: /^[\w.:/@-]{0,120}$/ };

function mount(app) {
  app.get('/api/assistant', (_req, res) => res.json(view()));
  app.post('/api/assistant', (req, res) => {
    const b = req.body || {}, { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs(), next = { ...(prefs.assistant || {}) };
    for (const [k, re] of Object.entries(KEYS)) if (typeof b[k] === 'string') {
      if (!re.test(b[k].trim())) return res.status(400).json({ error: `${k}: not a value this takes.` });
      next[k] = b[k].trim();
    }
    if (typeof b.style === 'string') { if (b.style.length > 3000) return res.status(400).json({ error: 'style: at most 3000 characters.' }); next.style = b.style.trim(); }
    if (b.style === null) delete next.style;   // back to the default
    if (typeof b.calls === 'boolean') next.calls = b.calls;
    savePrefs({ ...prefs, assistant: next });
    res.json(view());
  });
}

module.exports = { mount };
