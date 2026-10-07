'use strict';

/* Alternatives kept beside what replaced them (CONSTITUTION W14: nothing ever coded is lost). Each names the feature
   it stands beside (`beside`) and the counter of its own use (`uses`, features/usage.js); the feature beside it counts
   its own, so "unused for 30 days while the replacement ran 50 times" can be read (features/review.js). An unused one
   may be hidden from the default by the admin — it keeps working, and stays here for the agents to find. */
const alt = (id, name, beside, uses, use, extra = {}) => ({ id, name, beside, uses, use, state: 'alternative', ...extra });

module.exports = [
  alt('show-image', 'show_image (the old name of show_media)', 'show-media', 'tool:show_image',
    'The name show_media had before audio, video and 3D: old transcripts and recipes still run with it.', { tools: ['show_image'] }),
  alt('scout-alias', 'scout (the old name of model_scout)', 'model-scout', 'tool:scout',
    'The model scout\'s first tool name, still run as model_scout for old transcripts.'),
  alt('search-duckduckgo', 'Web search through DuckDuckGo', 'web-search', 'search:duckduckgo',
    'No key needed: DuckDuckGo\'s HTML page, the fallback when no other provider is set.', { settings: ['search.provider'] }),
  alt('search-searxng', 'Web search through SearXNG', 'web-search', 'search:searxng',
    'A SearXNG instance the owner runs (search.url), no key.', { settings: ['search.provider', 'search.url'] }),
  alt('search-brave', 'Web search through Brave', 'web-search', 'search:brave',
    'Brave\'s search API with the owner\'s key.', { settings: ['search.provider'] }),
  alt('search-tavily', 'Web search through Tavily', 'web-search', 'search:tavily',
    'Tavily\'s search API with the owner\'s key.', { settings: ['search.provider'] }),
  alt('vision-model', 'Screen reader: a vision model', 'vision-pass', 'vision:model',
    'A vision model answers in words with positions — the most general reader, the slowest.', { settings: ['vision.model'] }),
  alt('vision-detector', 'Screen reader: a detector (Roboflow Inference)', 'vision-pass', 'vision:detector',
    'Labelled boxes from a detection model: fast and exact for what it was trained on.', { settings: ['vision.detectorModel'] }),
  alt('vision-text', 'Screen reader: text (Tesseract OCR)', 'vision-pass', 'vision:text',
    'Every word on the screen and where, with no model — finds a button by its words.', { settings: ['vision.ocrLang'] }),
  alt('vision-template', 'Screen reader: a template (OpenCV)', 'vision-pass', 'vision:template',
    'Finds a cropped picture of an element wherever it is on the screen, with no model.'),
  alt('oneshot-gateway', 'Chat through OpenClaw\'s gateway', 'harness', 'oneshot:gateway',
    'When OpenClaw is the default harness, the floating chat asks it through its gateway.', { since: '2.201.0' }),
  alt('oneshot-cli', 'Chat through a CLI harness, one question at a time', 'harness', 'oneshot:argv',
    'When a CLI agent (claude, codex, gemini…) is the default harness, the chat asks it by its one-question mode; the scout\'s implementer too.', { since: '2.201.0' }),
];
