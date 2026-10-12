'use strict';

/** The settings of how a computer's screen or a picture is read (settings-schema.js `vision`), declared beside vision/. */
const p = (label, note = '', extra = {}) => ({ label, note, ...extra });   // settings-schema.js's own

module.exports = { is: 'travels', home: 'hive', note: 'how a computer\'s screen is read: a vision model, a detector, OCR or OpenCV (modules/vision; the switch is experiments.visionPass)',
    propose: p('Vision', 'Which reader looks at a computer\'s screen when there is nothing to number, and its model'),
    keys: { backend: { type: 'string', default: 'model', hint: 'The reader computer_look uses unless the agent picks one: model, detector, text or template.' },
      provider: { type: 'string', default: 'ollama', hint: 'The provider serving the vision model; ollama by default.' },
      model: { type: 'string', default: '', hint: 'A model that reads images, e.g. qwen2.5vl or llava on Ollama. Empty: no vision model.' },
      // A smaller model that answers while the main one is not loaded (vision/pick.js; asked 2026-10-12).
      quickProvider: { type: 'string', default: '', hint: 'The provider serving the quick vision model. Empty: the vision model\'s own provider.' },
      quickModel: { type: 'string', default: '', hint: 'A smaller model that reads images, used while the vision model is not loaded on its server (see when). Empty: none.' },
      quickWhen: { type: 'string', default: 'cold', hint: 'When the quick model answers: cold — while the vision model is not in memory on its own server; always; or never.' },
      quickThinking: { type: 'boolean', default: false, hint: 'Let the quick vision model think before answering: better positions, many seconds slower. Off, it answers what is on the screen in about a second.' },
      // A model trained to point at things on screens (vision/locate.js; asked 2026-10-12).
      locatorProvider: { type: 'string', default: '', hint: 'The provider serving the locator. Empty: the vision model\'s own provider.' },
      locatorModel: { type: 'string', default: '', hint: 'A model trained to point at things on screens (GUI grounding), asked "where is …" and answering a point. Empty: none.' },
      locatorPrompt: { type: 'string', default: 'Localize an element on the GUI image according to my instructions and output a click position as Click(x, y) with x num pixels from the left edge and y num pixels from the top edge. Instruction: {what}', hint: 'What the locator is asked, {what} standing for the thing to find. Each such model is trained on its own instruction: its model card says which.' },
      locateWhen: { type: 'string', default: 'where', hint: 'where — a question asking where something is (or where to click) goes to the locator; asked — only when the agent asks for it (how: locate).' },
      maxSide: { type: 'number', min: 256, max: 8192, default: 1024, hint: 'A screen is shrunk by a whole factor until its longer side is at most this many pixels before a vision model reads it; positions come back in the screen\'s own pixels.' },
      warmMain: { type: 'boolean', default: true, hint: 'When the quick model answers, wake the vision model in the background so the next look is its.' },
      detectorUrl: { type: 'string', default: 'http://127.0.0.1:9001', hint: 'Roboflow Inference: the local server (Settings → Services) or https://detect.roboflow.com.' },
      detectorModel: { type: 'string', default: '', hint: 'The detection model, as project/version (Roboflow Universe or your own). Empty: no detector.' },
      apiKey: { type: 'string', default: '', hint: 'The Roboflow API key, when the model or the hosted API needs one.' },
      ocrLang: { type: 'string', default: 'eng', hint: 'Tesseract\'s languages, e.g. eng or eng+ita (each needs its language pack).' } } };
