# Experiment: search memory and conversations by meaning

**Flag:** `experiments.retrieval` (Settings → Experiments), off by default, and inert until an embedding model is
set (`retrieval.model`, Settings → Harness → Retrieval). **TODO:** H10.2. **Since:** 2.181.0.

## Hypothesis

`memory_search` and `recall_conversations` match words. A person rarely uses the words they used last time: "the
printer" when the entry says "Prusa", "the backups" when it says "snapshots of the NAS". Merging the keyword
ranking with one by meaning (embeddings) finds those without losing the exact-word hits — so the agent rediscovers
less and asks less, which is what memory is for.

## What happens when it is on

1. `memory_search` and `recall_conversations` (search) embed the query with the configured model.
2. Before that, the source is brought up to date: each memory entry, and each conversation's title, topics and
   summary, is cut into pieces (about 1200 characters, overlapping), hashed, and only pieces whose hash changed are
   embedded; pieces of what is gone are dropped. Vectors live in doca.db (`embeddings`, per piece and model).
3. The pieces are ranked by cosine similarity, and that ranking is merged with the keyword one by reciprocal rank.
   Only what the keyword search may see is searched: memory, and the conversations the person may open.
4. When the embedding call fails, the keyword result is returned with a line saying so.

## Measured

`npm run experiment -- retrieval`, with `retrieval.model` set on the machine running it: twelve memory entries and
twelve questions that ask for one of them in other words (and four that use the entry's own words), answered by
keyword alone and by keyword + meaning. Reported: how often the wanted entry is first and in the top three, the
time to index and per search, and how many pieces were embedded.

| Date | Embedding model | Keyword: first / top 3 | Hybrid: first / top 3 | Index (12 entries) | Per search |
|---|---|---|---|---|---|
| — | — | not measured yet: needs an embedding model on the machine running it (e.g. `ollama pull nomic-embed-text`, 274 MB) | — | — | — |

## Cost

- One embedding call per search (the query), plus one per changed piece. An embedding model is small: on Ollama,
  `nomic-embed-text` is 274 MB and embeds a piece in milliseconds on a GPU; a hosted provider bills fractions of a
  cent per thousand pieces.
- Storage: a vector per piece (768 floats ≈ 4 KB as stored) in doca.db.
- Ranking is a scan in process: fine at thousands of pieces, slow at hundreds of thousands — that is where pgvector
  with PostgreSQL (docs/design/database.md) takes over.

## Risks

- **Meaning outranks a fact.** A near-miss by meaning can push a weaker entry into the results; the reciprocal-rank
  merge keeps an exact-word hit near the top, and the results are still the agent's to read.
- **The model changes**: vectors from two models do not compare. Each piece is stored per model, so a new model
  builds its own index; the old one stays until "Empty the index".
- **Privacy**: the texts go to the embedding provider. With a hosted provider that is memory and conversation
  summaries leaving the machine — choose a local model (Ollama) to keep them here.

## Rollback

Switch the flag off, or clear the model: searches are keyword-only again, at once. "Empty the index" (Settings →
Harness → Retrieval) deletes the vectors; nothing else is changed.
