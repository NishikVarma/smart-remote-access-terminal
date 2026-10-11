import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OllamaModel } from './ollama.js';

const request = () => ({
  system: 's',
  user: 'u',
  schema: z.object({ summary: z.string() }),
  signal: new AbortController().signal,
});

const respond = (status: number, body: unknown) =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })) as unknown as typeof fetch;

describe('OllamaModel', () => {
  it('sends the schema as `format`, with temperature 0, and returns the parsed content', async () => {
    let sent: { format?: unknown; options?: unknown; model?: string; stream?: boolean } = {};
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ message: { content: '{"summary":"x"}' } }));
    }) as unknown as typeof fetch;

    const model = new OllamaModel({ fetch: fake, model: 'llama3.2' });
    expect(await model.generate(request())).toEqual({ summary: 'x' });
    expect(sent.model).toBe('llama3.2');
    expect(sent.stream).toBe(false);
    expect(sent.options).toEqual({ temperature: 0 });
    expect(sent.format).toMatchObject({ type: 'object' });
  });

  it('returns null when the content is not JSON, so diagnose() reports invalid_output', async () => {
    const model = new OllamaModel({ fetch: respond(200, { message: { content: 'sorry, no' } }) });
    expect(await model.generate(request())).toBeNull();
  });

  it('marks server errors retryable and client errors not', async () => {
    const retryable = await new OllamaModel({ fetch: respond(503, 'busy') })
      .generate(request())
      .catch((e: unknown) => e);
    expect(retryable).toMatchObject({ name: 'ProviderError', retryable: true });

    const notRetryable = await new OllamaModel({ fetch: respond(404, 'model not found') })
      .generate(request())
      .catch((e: unknown) => e);
    expect(notRetryable).toMatchObject({ name: 'ProviderError', retryable: false });
  });

  it('reports an unreachable server as a retryable provider error with the address', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const error = await new OllamaModel({ fetch: down, host: 'http://127.0.0.1:1' })
      .generate(request())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ retryable: true });
    expect((error as Error).message).toContain('http://127.0.0.1:1');
  });
});
