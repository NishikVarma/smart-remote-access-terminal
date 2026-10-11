# Architecture

## Components

```
Browser
  web/  xterm terminal  +  AI panel  +  guard  +  approval gate
    |  one origin (http://localhost:8788)
smart server (src/server)
  guard.ts         Host + Origin allow-list on every request and WebSocket upgrade
  engine-proxy.ts  /engine/*  ->  remote-terminal-access   (no credentials of its own)
  app.ts           /api/providers  /api/diagnose  /api/suggest  /api/summary
    |
  src/diagnosis, src/suggest, src/summary   (pure logic, no HTTP)
  src/llm           StructuredModel interface, adapters, registry, callStructured
  src/retrieval     BM25 over docs-corpus
```

## Trust boundaries

| Boundary                       | What crosses it                       | Control                                                                 |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------------------------- |
| Browser -> smart server        | Selected text, instructions           | Host/Origin guard; loopback bind; body size limits                      |
| Smart server -> cloud provider | Redacted text                         | Explicit `confirmCloud` per request; label in every response            |
| Smart server -> engine         | The browser's own cookie and requests | Plain pass-through; engine authenticates and authorizes                 |
| Model output -> UI             | Text only                             | Rendered with `textContent`; schema-validated; claims grounded          |
| Suggestion -> terminal         | One safe line of text                 | `normalizeCommand`, `prepareInput`, trusted click, confirm if dangerous |

The model never receives tools and never holds a credential. The smart server cannot run a command
by itself: only the browser, on a user's click, types into the engine's WebSocket.

## Flows

**Explain** `selection -> POST /api/diagnose -> redact -> BM25 top 3 -> model (timeout, retries) -> validate -> ground (quotes, sources) -> risk-label steps -> render`.
Failures become an explicit abstention with a cause (`provider_error`, `invalid_output`, `ungrounded`,
`insufficient_evidence`, `empty_input`); nothing throws to the user.

**Ask** `instruction (+ optional last output) -> POST /api/suggest -> redact -> model -> drop unsafe/duplicate commands -> risk-label -> render`.
User presses Insert (types, no Enter) or Run (types + Enter; dangerous needs a second confirmation).

**Summary** `last 200 lines -> POST /api/summary -> redact -> model -> keep only commands present in the output and problems with verbatim quotes`.

**Guard** `onData with Enter -> command from screen line and tracked keystrokes -> classifyCommand -> confirm or swallow Enter`.

## Decisions

- Smart client over the engine through a same-origin proxy, not a fork (no duplicated security code; engine unchanged).
- One-method provider interface with schema parameter; consent and privacy class are properties of the provider.
- Grounding and risk classification are code, never model judgement.
- Local model by default; cloud is explicit, per request.
- Evaluation includes a hard set that was frozen before the baseline ran, and results report failures and
  provider errors separately.

## Known gaps

See the README "Limitations". The largest: tiny author-written evaluation sets, keyword-only retrieval,
a guard that is advisory, and no live Anthropic test.
