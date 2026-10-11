# smart-remote-access-terminal

An AI troubleshooting companion for terminal output. Give it a log or an error; it returns a
structured, evidence-grounded diagnosis, or says it cannot tell. It is designed to sit next to
[remote-terminal-access](https://github.com/NishikVarma/remote-terminal-access), but it runs on
its own and never executes anything.

**Status: early.** Diagnosis pipeline, retrieval baseline and evaluation harness exist. The
Anthropic adapter has not been exercised against the live API in this repository's tests.

## What it does

1. Takes a log (file or stdin). Keeps the tail of very long logs.
2. **Redacts** obvious secrets (tokens, keys, passwords) before anything leaves the machine.
3. **Retrieves** relevant troubleshooting notes from `docs-corpus/` (BM25 keyword search).
4. Asks the model for a structured diagnosis (JSON validated with zod). Log text and documents are
   passed as untrusted data, delimited so they cannot close the prompt's own tags.
5. **Grounds** the answer in code: evidence quotes must appear verbatim in the log, cited sources
   must be documents that were actually retrieved. Unverifiable claims are dropped; if nothing is
   left it abstains.
6. **Classifies suggested commands** as `review` or `dangerous` with deterministic rules. The model
   never decides what is safe, and nothing is run.

Provider failures (timeouts, rate limits, refusals, invalid output) become an explicit abstention
with a cause, never a crash.

## Quick start

Default provider is **Ollama**: free, local, nothing leaves your machine.

```
ollama pull llama3.2            # or: ollama pull mistral
npm install
npm run diagnose -- path/to/error.log
```

Choose the provider and model with environment variables (see `.env.example`):

| Provider                                                                                | Variables                                                     | Cost                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `ollama` (default)                                                                      | `OLLAMA_MODEL` (default `llama3.2`), `OLLAMA_HOST`            | free, runs locally                              |
| `gemini`                                                                                | `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`) | free tier, small daily quota (see privacy note) |
|                                                                                         |
| Any other provider only needs to implement the one-method `DiagnosisModel` interface in |
| `src/llm/provider.ts`.                                                                  |

### Privacy of cloud providers

`ollama` keeps all text on your machine. `gemini` and `anthropic` send the (redacted) text to a third
party. On Google's free (unpaid) Gemini tier, prompts and responses may be used to improve Google's
products and may be read by human reviewers, and Google advises against sending sensitive or
confidential data. Redaction is best effort. For this reason the HTTP API refuses a cloud provider
unless the request carries `confirmCloud: true`, and every response states which provider handled it.

## HTTP API

```
npm run serve                  # http://127.0.0.1:8788, loopback only
GET  /api/providers            # which providers are configured, local vs cloud
POST /api/diagnose             # { log, provider?, confirmCloud? } -> { provider, result }
```

The server checks Host and Origin on every request so other web pages cannot spend your quota.

## Checks and evaluation

```
npm run typecheck && npm run lint && npm run format:check && npm test
npm run eval:retrieval      # BM25 baseline: Recall@k and MRR
npm run eval:baseline       # keyword-rules baseline for categories
npm run eval:llm            # runs the configured model over the labelled logs (writes eval/results/)
```

Current baseline numbers (author-written, small sets; see Limitations):

| Measure                                     | Result                                       |
| ------------------------------------------- | -------------------------------------------- |
| BM25 retrieval, 18 queries, document level  | Recall@1 0.944, Recall@3 1.000, MRR 0.972    |
| Rules baseline, category accuracy, easy set | 14 / 14                                      |
| Rules baseline, category accuracy, hard set | 3 / 8 (rules frozen before the hard set ran) |

Local models, same 22 labelled logs, run with `npm run eval:llm` (one machine, RTX 4060 8 GB, temperature 0;
two runs gave identical scores). A case counts as correct only if the model's category matches (for logs that
carry no information, abstaining is correct):

| Model (Ollama)                                                                                                     | Easy (14) | Hard (8) | Abstained               | Mean latency |
| ------------------------------------------------------------------------------------------------------------------ | --------- | -------- | ----------------------- | ------------ |
| llama3.2 (3B)                                                                                                      | 4         | 3        | 6                       | about 4.5 s  |
| mistral (7B)                                                                                                       | 9         | 5        | 2                       | about 7.5 s  |
| gemini-2.5-flash (cloud)                                                                                           | 13        | 5        | 4 (3 were quota errors) | about 8.6 s  |
|                                                                                                                    |
| Read this carefully: the rules were written while looking at the easy set, so 14/14 there is not                   |
| generalisation, and the sets are tiny. On the hard set mistral (5/8) beat the rules (3/8); on the easy set it did  |
| not. Every abstention was "ungrounded": the grounding check rejected the answer, the models never said "I cannot   |
| tell" by themselves, and both guessed a category for a log that contained no information. No hosted model has been |
| evaluated.                                                                                                         |

## Using it with remote-terminal-access

The smart server can sit in front of the [remote-terminal-access](https://github.com/NishikVarma/remote-terminal-access)
engine: requests under `/engine/*` (HTTP and WebSocket) are forwarded to it, so a browser talks to one
origin and no CORS is needed. The proxy has no credentials of its own and changes nothing: the browser's
device cookie and Origin go through, and the engine does all authentication.

1. Start the engine with this server's origin allowed: `ALLOWED_ORIGINS=http://localhost:8788`.
2. Start this server: `npm run serve` (engine address from `ENGINE_URL`, default `http://127.0.0.1:8787`).
3. Check the whole path with `npm run e2e:engine` (pairs through the proxy, opens a real shell, runs a command).

## Layout

```
src/diagnosis/   schema, prompt, redaction, grounding, command risk, diagnose()
src/llm/         provider interface, Anthropic adapter, scripted test double
src/retrieval/   chunking, BM25, metrics, corpus loader
src/baseline/    keyword-rules baseline
eval/            datasets (jsonl) and runners
docs-corpus/     troubleshooting notes used for retrieval
```

## Limitations

- Datasets are small and written by the author, who also wrote the corpus and the rules, so the
  easy-set numbers are optimistic. A held-out set of real logs is needed before any claim.
- Retrieval is keyword-only. Dense and hybrid retrieval (PostgreSQL full-text vs pgvector) are not
  built yet, so there is no measured comparison.
- Redaction is best effort and regex based; unusual secret formats pass through.
- No streaming, no caching, no cost or latency tracking yet.
