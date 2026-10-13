'use strict';

/**
 * Which embedding model the Library suggests on this machine, and what it still needs here (asked 2026-10-12: "the
 * Library should suggest the model by what the machine can run"). Measured 2026-10-12 with Ollama 0.40.3: every
 * EmbeddingGemma 2 tag runs only on Ollama's MLX engine — built in on a Mac, a package of its own beside Ollama on an
 * NVIDIA card (System tools → Ollama's MLX runtime; Windows has one too, not wired in here yet) — and its GGUF is not
 * read by Ollama's other engine. 740m reads text, pictures and sound (440m text and pictures, 570m text and sound,
 * 270m text). Without MLX the first EmbeddingGemma reads text on any machine, the CPU included.
 *
 *   suggest({ platform, arch, gpus, mlx }) → { model, size, reads, needs: [{ id, label }], why }
 * Pure: the readings come in, so a test stands in any machine.
 */
const FULL = { model: 'embeddinggemma-2:740m-mxfp8', size: '1.39 GB', reads: ['documents', 'images', 'audio', 'video'] };
const TEXT = { model: 'embeddinggemma:300m', size: '0.62 GB', reads: ['documents'] };

function suggest({ platform = process.platform, arch = process.arch, gpus = [], mlx = false } = {}) {
  if (platform === 'darwin' && arch === 'arm64') return { ...FULL, needs: [], why: 'Ollama on a Mac runs EmbeddingGemma 2 with MLX.' };
  const nvidia = gpus.some(g => g.vendor === 'nvidia');
  if (nvidia && platform === 'linux' && arch === 'x64') {
    return { ...FULL, needs: mlx ? [] : [{ id: 'ollama-mlx', label: 'Ollama\'s MLX runtime' }],
      why: mlx ? 'EmbeddingGemma 2 runs on the NVIDIA card with Ollama\'s MLX runtime.' : 'EmbeddingGemma 2 runs on the NVIDIA card once Ollama\'s MLX runtime is installed (System tools; it asks for the administrator\'s password).' };
  }
  return { ...TEXT, needs: [], why: `EmbeddingGemma 2 needs Ollama's MLX engine — a Mac, or an NVIDIA card on Linux — which this machine does not have${nvidia ? ' wired in yet' : ''}; the first EmbeddingGemma reads documents here, and pictures and sound are left out.` };
}

/** This machine's readings, then the suggestion. Only when the Library's Ollama is this machine's own. */
async function here(ollamaLocal) {
  let gpus = [];
  try { gpus = await require('../gpu').read() || []; } catch { /* none read */ }
  let mlx = false;
  if (process.platform === 'linux' && ollamaLocal) {
    const row = require('../system-tools-catalog').SYSTEM_TOOLS.find(t => t.id === 'ollama-mlx');
    try { mlx = (await require('../detect').detect(row.detect)).detected; } catch { /* not found */ }
  }
  return { ...suggest({ gpus, mlx }), mlx };
}

module.exports = { suggest, here, FULL, TEXT };
