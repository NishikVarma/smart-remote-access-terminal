# smart-remote-access-terminal

A smart client for a remote terminal. It puts a browser terminal and an AI side panel in front of
[remote-terminal-access](https://github.com/NishikVarma/remote-terminal-access) (the secure engine that
actually runs your shell) and adds: explain errors, turn plain English into reviewed commands, summarise
what happened while you were away, and warn before a dangerous command is sent.

**The AI never runs anything.** It only proposes. Commands reach the shell solely when you press
**Insert** (types it, you press Enter) or **Run** (types it and presses Enter, with a second confirmation if
it looks dangerous).

**Status:** working end to end on Windows with local models and Gemini. Tested with unit tests and a
real-browser script. See [Limitations](#limitations) before relying on it.

## How it fits together

```
Browser (xterm + AI panel)
   |  same origin
smart server  (this repo, 127.0.0.1:8788)
   |-- /engine/*   plain reverse proxy (HTTP + WebSocket)  ->  remote-terminal-access (127.0.0.1:8787)
   |-- /api/*      diagnose / suggest / summary / providers
   '-- providers:  ollama (local, default)  |  gemini (cloud, opt-in)  |  anthropic (cloud, opt-in)
```

The engine does pairing, authentication, sessions and the audit log, unchanged. This repo holds no
credentials for it: your browser's device cookie passes straight through the proxy.

## Quick start

Requirements: Node 22+, a built [remote-terminal-access](https://github.com/NishikVarma/remote-terminal-access),
and for free local AI [Ollama](https://ollama.com) with a model (`ollama pull llama3.2`).

```
# 1. engine (its repo): allow this app's origin, then start it
ALLOWED_ORIGINS=http://localhost:8788 npm run start -w @rta/server     # prints a pairing code

# 2. this repo
npm install
npm run build:web
npm run serve                      # http://localhost:8788
```

Open http://localhost:8788, enter the engine's pairing code, and use the terminal. Click **AI**.

Configuration is read from `.env` (see `.env.example`): `ENGINE_URL`, `PORT`, `LLM_PROVIDER`,
`OLLAMA_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `LLM_MODEL`.

## Features

| Feature                         | What happens                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explain selection / output      | Redacts secrets, retrieves matching troubleshooting notes, asks for a structured diagnosis, keeps only claims whose quotes appear in the text. May abstain. |
| Ask (plain English to commands) | Up to 3 candidates, one line each, risk label computed by code. Insert or Run. Unsafe characters are rejected.                                              |
| Summarize recent activity       | Commands that ran, problems (with exact quotes), and the terminal state. Offered after a reconnect, never automatic.                                        |
| Dangerous-command guard         | Before Enter, checks the screen line and your typed keystrokes against the same risk rules. A typo guard, not a security control.                           |

## Providers and privacy

| Provider           | Where text goes        | Cost                               |
| ------------------ | ---------------------- | ---------------------------------- |
| `ollama` (default) | stays on this computer | free                               |
| `gemini`           | sent to Google         | free tier with a small daily quota |
| `anthropic`        | sent to Anthropic      | paid                               |

On Google's free (unpaid) Gemini tier, prompts and responses may be used to improve Google's products
and may be read by human reviewers; Google advises against sending sensitive data. Redaction of
obvious secrets is best effort. So a cloud provider is never used silently: the API refuses unless the
request says `confirmCloud: true`, the UI shows a dialog stating how much text leaves the machine, and
every response says which provider handled it.

## HTTP API

```
GET  /api/providers    -> { default, providers: [{ name, label, privacy, available }] }
POST /api/diagnose     { log, provider?, confirmCloud? }                       -> { provider, result }
POST /api/suggest      { instruction, shell?, context?, provider?, confirmCloud? } -> { provider, result }
POST /api/summary      { output, provider?, confirmCloud? }                    -> { provider, result }
ANY  /engine/*         forwarded to remote-terminal-access
```

The server listens on loopback only and checks the Host and Origin headers of every request, so other
web pages cannot call it or spend your provider quota.

## Checks and evaluation

```
npm run typecheck && npm run lint && npm run format:check && npm test     # 115 tests
npm run e2e:engine      # real engine behind the proxy, real shell
npm run e2e:browser     # real Chrome: pairing, terminal, consent, suggest, guard, summary
npm run eval:retrieval | eval:baseline | eval:llm | eval:suggest
```

Measured results (small, author-written sets; one machine, RTX 4060 8 GB; temperature 0):

| Evaluation                                     | Result                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| BM25 retrieval, 18 queries                     | Recall@3 1.000, MRR 0.972                                                                                                            |
| Diagnosis category, 22 logs (14 easy / 8 hard) | rules 14/14 and 3/8; llama3.2 4/14 and 3/8; mistral 9/14 and 5/8; gemini-2.5-flash 13/14 and 5/8 (3 of its misses were quota errors) |
| Command suggestions, 12 requests               | llama3.2 10/12, mistral 9/12 matched an acceptable pattern; destructive requests labelled dangerous 3/3 and 2/3                      |

Details and caveats are in the files under `eval/results/`. Read them: the sets are tiny, written by the
author, and a "match" means a regular expression matched, not that the command is optimal.

## Limitations

- Evaluation sets are small and author-written; the keyword rules were written while looking at the
  easy set, so their 14/14 is not generalisation. No held-out set of real logs exists yet.
- Small local models give plain or occasionally wrong commands (for example a "force push" suggestion
  that never force-pushes). Gemini is stronger but its free daily quota ran out during evaluation.
- The dangerous-command guard is advisory: aliases, scripts, an unrecognised prompt, or switching it
  off bypass it. The risk rules are regular expressions.
- Secret redaction is pattern based and will miss unusual formats.
- Retrieval is keyword-only (BM25). PostgreSQL full-text vs pgvector vs hybrid is not built or compared.
- The Anthropic adapter has never called the live API. No mobile layout work or touch key toolbar here
  (the engine's own page has one).
- A half-typed line followed by **Run** concatenates; the guard and the Insert option exist for that.

## Layout

```
src/diagnosis/   schema, prompt, redaction, grounding, command risk, diagnose()
src/suggest/     plain English -> reviewed command candidates
src/summary/     grounded digest of recent output
src/llm/         provider interface, Ollama / Gemini / Anthropic adapters, registry, callStructured
src/retrieval/   chunking, BM25, metrics, corpus loader
src/server/      Express app, Host/Origin guard, /engine proxy
src/baseline/    keyword-rules baseline
web/             Vite + xterm client (terminal, AI panel, guard, approval gate)
eval/            labelled sets and runners (results in eval/results)
scripts/         end-to-end checks
docs-corpus/     troubleshooting notes used for retrieval
docs/            architecture
```
