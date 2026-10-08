/* What an install downloads, said before it starts (deep test B, R5: one click on OpenClaw cloned it into the home
   folder; nothing said how big Whisper, the Android SDK or a service's image is). Every Install button that downloads —
   System tools, Models' tools, the harness catalogue, a service's image — asks this one question, in the same modal as
   the machine-stop questions (lib/machine-ask.js), naming the size or "about N". The figures are approximate, for the
   usual download on a 64-bit machine; a vendor's installer may fetch more. */
const INSTALL_SIZES = {
  // Settings → System → System tools (modules/system-tools-catalog.js)
  'tool:git': 'about 10 MB', 'tool:tailscale': 'about 30 MB', 'tool:docker': 'about 100 MB (Docker Desktop: about 600 MB)',
  'tool:docker-compose': 'about 60 MB', 'tool:node-pty': 'about 5 MB, built here', 'tool:build-tools': 'about 200 MB',
  'tool:curl': 'about 1 MB', 'tool:ollama': 'about 1–2 GB (its GPU libraries); models are separate',
  'tool:llama-server': 'about 50–200 MB', 'tool:nvidia-ctk': 'about 10 MB', 'tool:uv': 'about 15 MB', 'tool:ffmpeg': 'about 80 MB',
  'tool:python3': 'about 30 MB', 'tool:pip': 'about 10 MB', 'tool:huggingface-cli': 'about 10 MB', 'tool:tesseract': 'about 30 MB',
  'tool:opencv': 'about 60 MB', 'tool:catt': 'about 10 MB', 'tool:libvirt': 'about 100 MB', 'tool:jdk': 'about 200 MB',
  'tool:jdk11': 'about 200 MB', 'tool:jdk21': 'about 200 MB', 'tool:android-sdk': 'about 1 GB', 'tool:android-emulator': 'about 2 GB',
  'tool:dotnet': 'about 250 MB',
  'tool:openclaw': 'a copy of its repository (about 50 MB) into your home folder; its container images, several GB, when it is started',
  // Models → tools (modules/models.js)
  'model-tool:whisper': 'about 2–3 GB (PyTorch), plus a model on first use', 'model-tool:faster-whisper': 'about 100 MB, plus a model on first use',
  'model-tool:piper': 'about 25 MB, plus a voice (about 60 MB)',
  // The harness catalogue (modules/harness/catalog.js)
  'harness:openclaw': 'a copy of its repository (about 50 MB) into your home folder; its container images, several GB, when it is started',
  'harness:opendots': 'a copy of its repository (about 100 MB); its containers, about 2 GB, when it is started',
  'harness:openhands': 'about 500 MB', 'harness:aider': 'about 150 MB',
  // Inference services' images (modules/services.js)
  'service:whisper': 'about 5 GB', 'service:kokoro': 'about 5 GB (CPU: about 2 GB)', 'service:vllm': 'about 10 GB',
  'service:sdwebui': 'about 10 GB, plus a checkpoint', 'service:comfyui': 'about 10 GB, plus a checkpoint',
  'service:roboflow': 'about 5 GB (CPU: about 2 GB)', 'service:qwentts': 'about 8 GB',
};
// A harness that is a CLI from npm or a vendor script: tens of megabytes.
const INSTALL_SIZE_CLI = 'about 20–100 MB';

/** The size said for `kind:id`, or null when none is known (the question then says so). */
function installSize(kind, id, fallback = null) { return INSTALL_SIZES[`${kind}:${id}`] || fallback; }

/** Ask, then `go()`. `label` is what is installed; `note` the row's own sentence; `size` overrides the table. */
function installAsk(kind, id, label, go, { note = '', size = null, verb = 'Install' } = {}) {
  const said = size || installSize(kind, id);
  appConfirm([`${verb} ${label}?`, said ? `It downloads ${said}.` : 'Its size is not known here: it downloads what its installer fetches.', note]
    .filter(Boolean).join('\n\n'), go);
}
