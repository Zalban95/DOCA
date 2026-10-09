# Experiment: Library — search the files on this machine by meaning

**Flag:** `experiments.library` (Settings → Developer), off by default, and inert until an embedding model is set
(`library.model`, Field → Models → Library) and a folder is chosen. **Asked:** 2026-10-08 ("find an audio that says
something specific in my library, or find the video or picture… and create a database to index the files I have on
the machine"). **Since:** the release that merges it.

## Hypothesis

A person remembers a file by what is in it — "the voice note where I said the boiler code", "the photo with the red
bike", "the clip at the beach" — not by its name or folder. A multimodal embedding model puts text, pictures and
sound in one space, so a sentence typed in the search box can be compared with a picture, a stretch of audio or a
video's frames directly. With the words of audio and video also transcribed (the hub's whisper) and kept with their
times, "an audio that says X" matches the words as well as the sound, and the result can open at the moment it was
said. One index in doca.db, kept up to date by what changed, makes this a search rather than a crawl.

## The model, from its card and Ollama (checked 2026-10-08)

EmbeddingGemma 2 (Google DeepMind): 740M parameters, one shared 768-dimension space for text, code, images, audio
and video; modular encoders (text 270M, vision 170M, audio 300M — Ollama also has `270m` text-only and `570m`
text-and-audio tags). Matryoshka: 768, 512, 256 or 128 dimensions. Ollama tags `embeddinggemma-2:740m` (nvfp4,
1.33 GB), `740m-mxfp8` (1.39 GB) and `740m-bf16` (1.52 GB). What the files in Ollama's registry say:

- **Ollama ≥ 0.36.0** (`"requires": "0.36.0"`, capabilities `embedding`, `vision`, `audio`). It runs on Ollama's
  MLX engine (Apple silicon, and NVIDIA with the `-mlx` Linux bundle).
- **How each kind is passed** (Ollama's `api/types.go` `EmbedRequest` and `mlxrunner/embed.go`): `POST /api/embed`
  with `input` a string, a list, or a map `{text, image, audio}` per item, media base64. Images: PNG, JPEG, GIF or
  WebP; audio: WAV or Ogg (16 kHz is what the feature extractor reads: `sampling_rate: 16000`, 40 ms per token).
  **Video is not taken** by Ollama (`input.video not supported`, `server/routes.go`) although the processor has one
  (1 frame a second, at most 32) — so a video is indexed as frames (images) plus its audio track. The
  OpenAI-compatible `/v1/embeddings` is text only.
- **Prefixes** (`config_sentence_transformers.json`): a query `task: search result | query: `, a document
  `title: none | text: ` — Library writes the file's name as the title. Media items carry no prefix.
- **Context:** 8,192 tokens ("minutes of audio or video"); an image is 280 soft tokens, a video frame 140.
- **Safety:** "a pre-trained embedding model without post-training alignment, safety tuning or output-level
  moderation". Library therefore finds whatever is in the folders it was given — the person's own files — and its
  results are filtered only by who may search which folder (below), never by a judgement of the content.

## What happens when it is on

1. The owner picks folders inside the Files tab's roots (never above them, never the protected files or DOCA's own
   data), the kinds to index (documents, images, audio, video), and when: on demand, every N hours, or while the
   panel is open with the folders watched.
2. Indexing walks the folders (no symlinks followed, hidden folders and build output skipped, at most
   `library.maxFiles` files) one file at a time, and only while the machine is not busy (`library.idleLoad`). A file
   whose size and modified time are unchanged is skipped; one whose content hash is unchanged only has its time
   updated; a file that is gone is removed with its pieces. Stopping and starting again resumes where it was.
3. Each file becomes pieces, each with its vector, the model, and a mechanical description (name, size, duration,
   dimensions, the EXIF date, the first transcript words — never a model-written summary):
   - **documents**: text, Markdown and code read directly, PDF through `pdftotext`, office files through
     LibreOffice when present — cut in overlapping pieces;
   - **images**: the picture itself (converted and scaled by ffmpeg when present);
   - **audio**: 16 kHz windows of the sound itself (ffmpeg), and the words through the hub's speech-to-text with
     their times;
   - **video**: a frame every `library.frameEverySec` seconds (ffmpeg) and the audio track as above.
   What cannot be read is said per file (`note`), and what a kind needs is said in the Library section.
4. Search embeds the query with the query prefix, ranks every piece the person may see by cosine, merges that with
   a keyword ranking of the words kept (transcripts, text, names) by reciprocal rank, and returns each file once
   with its best piece — for audio and video the moment it matched.
5. Who may search what: a host every folder; anyone else only the folders the owner opened to everyone
   (`library.open`). The agent's `library_search` searches as the person the turn acts for, and its results are
   framed as the person's own files (data, not instructions).

## Measured

`npm run experiment -- library`: a labelled set made on the spot — spoken clips through the hub's TTS saying known
sentences, pictures drawn with known shapes and words (resvg), short videos made by ffmpeg from those pictures with a
spoken track, and a few documents — indexed into a throwaway copy of the settings; then one query per file in other
words, and recall@5 per kind (is the wanted file among the first five). The test files are deleted afterwards.

| Date | Model | text→audio, recall@5 | text→image | text→video | text→document | Index | Per search | Tags |
|---|---|---|---|---|---|---|---|---|
| 2026-10-08 | embeddinggemma-2:740m-mxfp8 (first cut: raw cosine, keywords by substring) | 3/8 sound alone · 7/8 with words | 7/10 | 4/4 | 5/6 | 18 s, 40 pieces (28 files) | 18 ms | 17/24 kept tags right; 14/28 files tagged |
| 2026-10-08 | embeddinggemma-2:740m-mxfp8 (as shipped) | 8/8 sound alone · 8/8 with words | 10/10 | 4/4 | 5/6 | 15 s, 40 pieces (28 files) | 18 ms | 17/24 kept tags right; 14/28 files tagged |

How it was run: the hub's own Ollama is 0.32.13, older than the model needs, so the measurement ran Ollama 0.40.1 (the
Linux bundle with its MLX/CUDA runner) as a separate server on 127.0.0.1:11534 on GPU 0 of the hub (two RTX 5060 Ti
16 GB, shared with the llama.cpp model and the voice services), its files in a temporary folder removed afterwards;
transcripts from the hub's faster-whisper, clips from its Kokoro. The first request after loading took 107 s (the
runner compiles its GPU kernels on first use; the first sound 56 s more); after that a piece embeds in 10–20 ms.

What the first cut taught, and what changed:

- **Keywords by substring and with stop words** put every document above every picture and recording: "a voice
  note…" matched "invoice", and "the", "about", "where" matched every text. Whole words without stop words fixed it.
- **The modality gap**: a text query scores text pieces higher than pictures or sound. Taking each family's scores
  relative to its own mean before choosing a file's best piece (search.js `bestByFile`) — first place over the 28
  queries: raw cosine 26 sound alone / 22 with transcripts; z-scores 19 / 19 (a family's best is lifted however far
  it is); offset from the mean 25 / 24, kept.
- Within its own kind (the kind filter) every query finds its file: audio 8/8, images 10/10, video 4/4, documents
  6/6. The one miss overall is "minutes of a work meeting", where the drawn "MEETING TOMORROW AT 3 PM" note outranks
  the document — a fair reading.
- **Captions** (`--captions qwen3-vl:4b`, a thinking vision model on the same Ollama): 13 of 14 written in 338 s
  (≈24 s each; it spends ~400 tokens thinking before a ten-word line, so a caption call has room for 1,500); recall
  unchanged (it was already full), first place 25/28. Good captions ("Invoice for coffee beans 12.00 and delivery
  4.50 totaling 16.50 EUR"); worth it for real photos more than for these drawings — measured on a real library next.
- **Tags** without a writing model: 24 tags kept on 14 of 28 files, 17 of them right by the files' labels (71%) —
  e.g. receipt on the invoice, chart on the bar chart, night and sky on the moon, car on the car video; wrong ones
  such as "map" on a landscape. Recordings got none: the sound tags (speech, music, noise) stand out too little in
  this space for a margin of 0.06 — a calibration for sound, or a lower margin there, is a next step.

## What each kind needs installed

- **documents**: nothing for text, Markdown, code and data; `pdftotext` (poppler) for PDF; LibreOffice for office files
  and EPUB.
- **images**: nothing for PNG, JPEG, GIF and WebP (sent as they are, up to 20 MB); ffmpeg for every other format and
  to scale large pictures down; exiftool for the date a photo was taken.
- **audio**: ffmpeg to embed the sound itself (16 kHz windows); the hub's speech-to-text (Settings → Voice) for its
  words — without ffmpeg the words are still read, from the file as it is.
- **video**: ffmpeg for frames and the audio track; speech-to-text for its words.
- **captions**: a vision model (Settings → Harness → Vision) and the switch.
- **the model**: Ollama 0.36 or newer for EmbeddingGemma 2 (the section says the version it found), or any endpoint
  speaking Ollama's `/api/embed` with media; an OpenAI-shaped `/embeddings` indexes text only.

## Built beside search (asked 2026-10-08: "a description generator that also functions as a search tool")

An embedding model writes no sentence, so the descriptions come in two layers:

1. **Tags, mechanically** (`library/tags.js`, vocabulary `library/tags.json` + `library.tags`): the file's pictures,
   sound and text compared with a fixed list of phrases; a tag is kept when it scores `library.tagMargin` above the
   file's average, at most five, with its score. Chips in Files and the section; a filter in search and in
   `library_search {tags}`. No model writes them, so the same file always gets the same tags.
2. **Captions, only when switched on** (`library.captions`, `library/captions.js`): one line per picture and per
   video's middle frame from the vision model, counted per run (`library.captionsPerRun`), kept as a text piece and
   marked in the panel as the model's.
3. **Files like this one** (`GET /api/library/similar`, "Like this"): a file's pieces averaged and compared with every
   other file's, near-duplicates (≥ 0.95) marked.

## Next steps (not built)

- Grouping photos into events by visual similarity and date (the vectors and EXIF dates are there).
- Calibrating the sound tags (speech, music, noise) so recordings get tags too.
- Skill and recipe matching by meaning for the agent's "Likely fits" (`turn/fits.js`, keyword-based today).
- The retrieval experiment going multimodal over conversation attachments, with this model.
- pgvector for libraries past a few hundred thousand pieces; Matryoshka 256-dimension vectors to cut memory by 3×.
- A device's own `/api/v1` search (today a device searches through the agent).

## Cost

- An embedding call per piece: a picture is one, a minute of audio two windows plus its transcript pieces, a video
  up to 32 frames plus its audio. The model is 1.4 GB and runs on a GPU or a CPU.
- Speech-to-text for every audio and video file (the hub's whisper), the largest cost of indexing sound.
- Storage: a vector per piece (768 floats ≈ 4 KB as stored) in doca.db, at most `library.maxPieces` pieces.
- Search is a scan in process over vectors kept in memory while searches come (≈3 KB a piece): fine at tens of
  thousands of pieces; past that, pgvector with PostgreSQL (docs/design/database.md) is the path.

## Risks

- **No moderation in the model** (its card). Results are the person's own files filtered by their rights; nothing
  in Library judges content.
- **What it reads leaves only to the embedding provider.** With Ollama on this machine nothing leaves; pointing
  Library at a hosted endpoint sends file content there — the section says which.
- **The machine's load**: indexing waits while the machine is busy and handles one file at a time; a person can stop
  it, and it resumes.
- **A folder opened to everyone** lets every person who may chat find its files by meaning, and open them through
  Library. That is the owner's decision per folder.

## Rollback

Switch the flag off: nothing indexes, nothing is searched, the tool is absent. "Empty the index" deletes the rows;
nothing else is changed.
