'use strict';

/** The settings of how a computer's screen or a picture is read (settings-schema.js `vision`), declared beside vision/. */
const p = (label, note = '', extra = {}) => ({ label, note, ...extra });   // settings-schema.js's own

module.exports = { is: 'travels', home: 'hive', note: 'how a computer\'s screen is read: a vision model, a detector, OCR or OpenCV (modules/vision; the switch is experiments.visionPass)',
    propose: p('Vision', 'Which reader looks at a computer\'s screen when there is nothing to number, and its model'),
    keys: { backend: { type: 'string', default: 'model', hint: 'The reader computer_look uses unless the agent picks one: model, detector, text or template.' },
      provider: { type: 'string', default: 'ollama', hint: 'The provider serving the vision model; ollama by default.' },
      model: { type: 'string', default: '', hint: 'A model that reads images, e.g. qwen2.5vl or llava on Ollama. Empty: no vision model.' },
      detectorUrl: { type: 'string', default: 'http://127.0.0.1:9001', hint: 'Roboflow Inference: the local server (Settings → Services) or https://detect.roboflow.com.' },
      detectorModel: { type: 'string', default: '', hint: 'The detection model, as project/version (Roboflow Universe or your own). Empty: no detector.' },
      apiKey: { type: 'string', default: '', hint: 'The Roboflow API key, when the model or the hosted API needs one.' },
      ocrLang: { type: 'string', default: 'eng', hint: 'Tesseract\'s languages, e.g. eng or eng+ita (each needs its language pack).' } } };
