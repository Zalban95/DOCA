# Suggested models: where they come from, how they stay current, who decides

*Written 2026-10-08, when the owner found the guided set-up's suggestions weak: the model they run — Qwen3.8 27B
quantized by IST Austria's DASLab with GSQ and RCO, at IQ3_S, on two 16 GB cards — was the strongest at its size that
fits, and it was not on the list. The list had been written from memory once and never looked at again.*

## What the list is

`modules/guided/suggested-models.json` — data, not code, versioned. One entry per model and role:

- what it is: `id`, `label`, `quant`, `released`, `licence`, `toolCalling` (how well it calls tools, with the numbers);
- what it needs, in GiB as the panel reads a machine: `needs.vramGB` is the model file plus its vision projector, its
  context cache at `context.at` tokens (16k for chat) and about 0.3 for the runtime — the picker adds 15% on top;
  `ramGB` and `diskGB` likewise;
- how it installs, through what the panel already has (`install`, an `installs.KINDS` row): an Ollama library tag, or
  `hf.co/<repo>:<quant>` for a GGUF on Hugging Face, which Ollama pulls from Hugging Face's registry. `gguf` names the
  file for someone running llama.cpp themselves;
- `rank`: its quality against the others, from the evidence. The same model at a quantization measured lossless keeps
  the same rank;
- `alsoFor`: the other roles the same model serves (a vision-language agent model is also the coder and the reader);
- `sources`: every claim's page, and the day it was checked.

`watching` lists models that would be picks but cannot be installed through the panel yet, and why.

Fields an older list lacks are read with defaults (`suggestions.expand`: rank 0, no sources), so a version-1 list
still loads.

## How a pick is made

`guided/pick.js`, pure, tested on made-up machines (`guided/classes.js`: one 8, 12, 16, 24, 32 or 48 GB card, two
16 or two 24 GB cards, a Mac with 16, 32 or 64 GB, no card with 16, 32 or 64 GB). For each role it keeps what fits —
on one card with 15% to spare; split over the cards of one maker (Ollama and llama.cpp do this) with 10% more; on the
processor only for what is marked `cpuOk` — and orders it: on a card before on the processor, then rank, then one card
before a split at the same rank, then the larger quantization. `test/model-suggestions.test.js` holds every class to
its pick; two 16 GB cards pick the owner's build on one card, with the same model split over both offered beside it.

## Where the October 2026 list came from

A search per role and class on 2026-10-08: the model cards' own benchmarks for agent work and tool calls (BFCL-V4,
tau-bench, SWE-bench, Terminal-Bench, MCP-Atlas), Hugging Face trending, Ollama's library and community write-ups,
each linked from its entry. What decided the less obvious ones:

- **Qwen3.8 27B** (2026-08-05, Apache-2.0) leads every agent benchmark on its card against Qwen3.6 27B and Qwen3.7
  Plus; at 16 GB its GSQ-RCO IQ3_S build measures the same as BF16 on AIME25 and LiveCodeBench v6, so it ranks with
  the Q4_K_M.
- **Through Ollama, a GGUF's template matters.** A Hugging Face repository can ship an Ollama chat template; when it
  does not, Ollama uses its built-in renderer for the architecture. That was checked on 2026-10-08 with a Qwen3.5 GGUF
  in an isolated Ollama: tool calls came back. Ornith 1.5 9B, strong on paper, ships a template without tools — so it
  is under `watching`, not a pick.
- **A dense model on a processor** is not what someone meets first; a mixture of experts with 3B active parameters
  (Qwen3.6 35B-A3B) is usable on 32 GB of memory and is the one chat pick without a card.

## How it stays current

1. **The model scout** (`modules/scout`, experiment `modelScout`) looks daily at Hugging Face's trending models per
   function — for the agent's model that now includes vision-language models (where Qwen3.8 is listed) and GGUF
   releases (where quantized builds like GSQ-RCO appear first).
2. When it finds a model that would beat a class's pick, it files a suggestion of kind **`suggested-model`**
   (`model_scout {action: "suggest", kind: "suggested-model", class, entry, evidence}`); `model_scout {action:
   "suggestions"}` shows it the list, the day it was checked and the pick per class. The entry is checked when filed:
   the shape the picker reads, https sources, and an install that is a model pull or one of the panel's services.
3. **Set-up says the day the list was checked**, and "Check for newer models" asks the scout to look now (a brief in
   its own conversation, `scout/model-suggestion.js CHECK`). With the experiment off it reaches nothing and says how to
   turn it on.
4. A newer list from the project's hub (`suggestions.refresh`, only when the owner shares with the project) replaces
   the shipped one when its version is higher — the route on the project's side is still to build.

## Who decides

A person, every time. A filed suggestion changes nothing. Accepting it (Settings → Harness → Scout, "Accept →
suggested models") writes the entry into this install's overlay (`DATA_DIR`, store `guided/suggestions-local`,
`guided/overlay.js`), laid over whichever list is in use: an entry with the same role and id replaces the list's, any
other is added. `POST /api/guided/suggestions/forget` takes one back. Even then nothing is installed: Set-up proposes
the install, and that waits for its own click. The shipped file changes only in a release, after a search like the
one above, with its version and `checked` date moved on.

## Not built

- An install kind for llama.cpp from a Hugging Face file (download one GGUF, make a llama.cpp instance from it). Ollama
  covers the same files today; llama.cpp would take models whose Ollama template is wrong (Ornith) and split GGUFs.
  Adding one widens what an install proposal can do, so it is the owner's decision first.
- Installs reporting what they measured (tokens per second, memory) back to the project, with consent.
