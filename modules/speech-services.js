'use strict';

/**
 * The expressive voice as an inference service (asked 2026-10-08: "anything slightly close to ElevenLabs V4 that
 * offers nuance in the voice?"). Qwen3-TTS — Apache-2.0, ten languages with Italian and English among them, nine
 * voices that take a spoken instruction ("whisper", "excited") — served by vLLM-Omni's OpenAI-compatible
 * `/v1/audio/speech`, which streams its first audio in about 50 ms and speaks a sentence at roughly four times real
 * time on one RTX 5060 Ti (measured 2026-10-08 against Chatterbox, Chatterbox Turbo and Kokoro; AGENTS.md "The
 * expressive voice" has the comparison and why the others lost: licence, Italian, or no control of tone).
 *
 * Nothing installs or starts it by itself: it is a row of the Services tab and a suggestion of the guided set-up
 * (guided/suggested-models.json), started on a click. Kokoro stays the default voice.
 *
 * What it costs a GPU is two engines in one container — the talker (the 1.7B model, ~3.9 GB of weights plus its cache)
 * and the codec that turns its codes into sound — each given a share of the GPU's memory. vLLM counts a share of the
 * whole card, so the shares are worked out from the gigabytes it needs and the card it lands on.
 */

const IMAGE = 'vllm/vllm-omni:v0.30.0';
const MODEL = 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice';
const SERVED = 'qwen3-tts';   // the name the speech requests send as `model` (the server refuses any other)
const DEPLOY = '/usr/local/lib/python3.12/dist-packages/vllm_omni/deploy/qwen3_tts.yaml';
const NEEDS_GB = { talker: 5.2, codec: 1.6 };   // measured on a 16 GB card: 5.1 GB talker + 1.6 GB codec in use
const LANGUAGES = ['English', 'Italian', 'Spanish', 'French', 'German', 'Portuguese', 'Russian', 'Chinese', 'Japanese', 'Korean'];

const ROW = {
  id: 'qwentts', label: 'Qwen3-TTS (expressive voice)', image: IMAGE, port: 8881, internalPort: 8091, apiPath: '/v1', multiGpu: false,
  description: 'An expressive voice: whispers, laughs and excitement on request, in ten languages with Italian and English (Qwen3-TTS 1.7B on vLLM-Omni, Apache-2.0). Needs an NVIDIA GPU with about 7 GB free, and 38 GB of disk for the image and the model.',
  // What the voice is, for tts-engines.js: how to ask for it, which voice it starts with, and that it takes tone as words.
  speech: { model: SERVED, voice: 'serena', tags: 'instructions', languages: LANGUAGES },
};

/** A share of a card of `totalGB` that holds `gb` (vLLM's gpu_memory_utilization), within what vLLM accepts. */
function share(gb, totalGB) {
  const t = Number(totalGB) > 0 ? Number(totalGB) : 16;
  return Math.min(0.9, Math.max(0.05, Math.round((gb / t) * 100) / 100));
}

/** The GPU's memory in GB for the selection ('0', '1', 'all' = the first), or null when this host cannot say. */
async function cardGB(gpu) {
  try {
    const list = (await require('./gpu').read()) || [];
    const card = list[Number(gpu) > 0 ? Number(gpu) : 0];
    return card?.memTotal ? Number(card.memTotal) / 1024 : null;
  } catch { return null; }
}

/**
 * Everything after `docker run -d --name … -p … --gpus …`: the model cache, the image and its command. The cache is
 * mounted as the hub cache itself (HF_HUB_CACHE), so a model already downloaded on this machine is not fetched again.
 */
function args({ hfCache, hfToken, modelId, totalGB }) {
  const overrides = { 0: { gpu_memory_utilization: share(NEEDS_GB.talker, totalGB), max_num_seqs: 4, max_model_len: 2048 },
    1: { gpu_memory_utilization: share(NEEDS_GB.codec, totalGB), max_num_seqs: 4 } };
  return [
    '--ipc=host',   // its two engines pass audio through shared memory
    '-v', `${hfCache}:/hf`, '-e', 'HF_HUB_CACHE=/hf',
    ...(hfToken ? ['-e', `HF_TOKEN=${hfToken}`] : []),
    IMAGE,
    'vllm', 'serve', modelId || MODEL, '--omni', '--deploy-config', DEPLOY, '--port', String(ROW.internalPort),
    '--served-model-name', SERVED, '--trust-remote-code', '--stage-overrides', JSON.stringify(overrides),
  ];
}

module.exports = { ROW, IMAGE, MODEL, SERVED, NEEDS_GB, LANGUAGES, share, cardGB, args };
