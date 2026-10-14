# Experiment: rewordings of the question, and a reranker

**Flag:** `experiments.retrievalRerank` (Settings → Developer), off by default. It works on top of
[`retrieval`](retrieval.md): with retrieval off, or no embedding model set, it does nothing. Each of its two steps
needs a model of its own and is skipped without one. **TODO:** fit audit 2026-10-14, item 8. **Since:** 3.76.0.

## Hypothesis

Retrieval merges a keyword ranking with one by meaning. Two things still miss: a question so short or so oblique that
neither ranking has much to hold on to ("where did yesterday's copies go"), and a merge that puts a near-miss above
the entry that answers. Searching two or three rewordings of the question gives both rankings more to hold on to, and
a reranking model — which reads the question and each candidate together, rather than comparing two vectors made
apart — puts the answer first more often. Together: the wanted entry first more often, at the cost of one small
model call and one rerank call per search.

## What happens when it is on

1. `memory_search` and `recall_conversations` (search) rank the question as retrieval does: keyword and meaning.
2. **Rewordings.** If assistant mode's quick model is set (`assistant.model`, Settings → Voice → Live call — the model
   the triage asks), it is asked once for three other ways to say the question (for a person, only when that model is
   allotted to them, as the triage's ask is). Each rewording is searched the same way — keyword and meaning, over the
   same entries — and every ranking is merged by reciprocal rank. No quick model: this step is skipped. A failed ask
   adds a one-line note and the search goes on without rewordings.
3. **Rerank.** If a reranking model is set (`retrieval.rerankModel`, with `retrieval.rerankProvider` or else the
   embedding model's provider; Settings → Harness → Retrieval → Advanced), the merged top 20 are sent with the
   question to the provider's OpenAI-compatible `POST /rerank` (llama.cpp's server, vLLM, Jina and Cohere answer it)
   and put in its order; what it did not rank keeps its merged place after. No reranking model: skipped. A failure
   keeps the merged order and the search says so in one line: `(not reranked, kept the merged order: …)`.
4. Only what the keyword search may see is reworded, searched and reranked: memory, and the conversations the person
   may open. The prompt's own memory block is not touched — it still matches by keyword, cheaply, on every step.

Off, the merge is exactly retrieval's.

## Measured

`npm run experiment -- retrieval-rerank`, with `retrieval.model` set and a quick model, a reranking model or both:
retrieval's own twelve memory entries and sixteen questions (`bin/experiments/retrieval.js`), each answered with this
experiment off and on. Reported: how often the wanted entry is first and in the top three, and the time per search.

| Date | Embedding model | Rewordings / rerank | Off: first / top 3 | On: first / top 3 | Per search (off → on) |
|---|---|---|---|---|---|

## Cost

- One quick-model call per search (a short answer: three lines), and the rewordings' searches: an embedding call
  each for the question's new words, and a keyword pass each.
- One rerank call per search, over at most 20 candidates. A reranker such as `bge-reranker-v2-m3` is about 600 MB and
  reads 20 short candidates in tens of milliseconds on a GPU; on a CPU, a few hundred.
- Latency: the steps run in order, so a search waits for both. The quick model is asked with a 20 s limit and the
  reranker with 30 s; past them the search goes on without that step.

## Risks

- **A rewording drifts.** A quick model can reword toward something the person did not mean; reciprocal rank keeps
  the question's own rankings in the merge, so an entry they find is not lost — but a drifted rewording can pull a
  wrong entry up. The measurement counts that.
- **The reranker's opinion wins.** Within the top 20 its order replaces the merge, an exact-word hit included. A weak
  reranker can make the results worse; that is what the off/on columns show.
- **Privacy:** the question, and the texts of up to 20 candidates (memory entries; conversation titles, topics and
  summaries), go to the reranking provider, and the question to the quick model's. With hosted providers they leave
  the machine — choose local ones to keep them here.

## Rollback

Switch the flag off: searches are retrieval's keyword + meaning merge again, at once. Clearing
`retrieval.rerankModel` turns off only the rerank; clearing the quick model only the rewordings. Nothing is stored
by this experiment.
