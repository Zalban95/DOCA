'use strict';

/**
 * The panel's wake-word routes (Field → Models → Wake words). Setting up, recording and training are an admin's —
 * downloads, GPU hours and a microphone's audio; a screen reads a kept model and the runtime's shared models with
 * `read`, since every signed-in screen may listen for its name.
 */
const express = require('express');
const ww = require('./index');
const samples = require('./samples');
const actions = require('./actions');
const job = require('./job');

function mount(app) {
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const word = req => String(req.query.word || req.body?.word || '');
  app.get('/api/wakeword', h(req => ({ ...ww.state(), samples: word(req) ? samples.counts(word(req)) : null })));
  app.post('/api/wakeword/setup', h(() => actions.setup()));
  app.post('/api/wakeword/train', h(req => actions.train(req.body || {})));
  app.post('/api/wakeword/stop', h(() => job.stop()));
  app.get('/api/wakeword/voice-messages', h(() => ({ messages: samples.voiceMessages() })));
  app.post('/api/wakeword/samples', express.raw({ type: () => true, limit: '20mb' }), h(req => samples.add(word(req), String(req.query.kind || ''), req.body, req.headers['content-type'])));
  app.post('/api/wakeword/samples/import', h(req => samples.importFrom(word(req), String(req.body?.kind || ''), req.body?.names)));
  app.delete('/api/wakeword/samples/:word/:kind', h(req => samples.clear(req.params.word, req.params.kind)));
  app.delete('/api/wakeword/models/:name', h(req => ww.remove(req.params.name)));
  app.get('/api/wakeword/models/:name/model.onnx', (req, res) => {
    const f = ww.modelFile(req.params.name);
    if (!require('fs').existsSync(f)) return res.status(404).json({ error: 'No model for that word.' });
    res.type('application/octet-stream').sendFile(f);
  });
  app.get('/api/wakeword/runtime/:file', (req, res) => {
    const f = ww.runtimeFile(req.params.file);
    if (!f) return res.status(404).json({ error: 'Not part of the runtime here (set up the trainer).' });
    res.type('application/octet-stream').sendFile(f);
  });
}

module.exports = { mount };
