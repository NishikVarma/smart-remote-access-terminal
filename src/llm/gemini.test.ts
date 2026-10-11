import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GeminiModel } from './gemini.js';

const KEY = 'test-key-123456';

const request = () => ({
  system: 'sys',
  user: 'usr',
  schema: z.object({ summary: z.string() }),
  signal: new AbortController().signal,
});

const respond = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const ok = (text: string, finishReason = 'STOP') =>
  respond(200, { candidates: [{ content: { parts: [{ text }] }, finishReason }] });

describe('GeminiModel', () => {
  it('sends the key in a header, the schema as responseJsonSchema, and returns parsed JSON', async () => {
    let url = '';
    let headers: Record<string, string> = {};
    let sent: {
      generationConfig?: Record<string, unknown>;
      systemInstruction?: unknown;
      contents?: unknown;
    } = {};
    const fake = (async (u: string, init: RequestInit) => {
      url = u;
      headers = init.headers as Record<string, string>;
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"summary":"x"}' }] }, finishReason: 'STOP' }],
        }),
      );
    }) as unknown as typeof fetch;

    const model = new GeminiModel({ apiKey: KEY, model: 'gemini-2.5-flash', fetch: fake });
    expect(await model.generate(request())).toEqual({ summary: 'x' });

    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(url).not.toContain(KEY); // never in the URL
    expect(headers['x-goog-api-key']).toBe(KEY);
    expect(sent.generationConfig).toMatchObject({
      temperature: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
    });
    expect(sent.generationConfig).not.toHaveProperty('responseSchema');
  });

  it('returns null when the text is not JSON', async () => {
    const model = new GeminiModel({ apiKey: KEY, fetch: ok('sorry') });
    expect(await model.generate(request())).toBeNull();
  });

  it('retries 429 and 5xx, not other 4xx, and never leaks the key in messages', async () => {
    const cases: Array<[number, boolean]> = [
      [429, true],
      [503, true],
      [400, false],
      [403, false],
      [404, false],
    ];
    for (const [status, retryable] of cases) {
      const model = new GeminiModel({
        apiKey: KEY,
        fetch: respond(status, { error: { status: 'X', message: 'went wrong' } }),
      });
      const error = await model.generate(request()).catch((e: unknown) => e);
      expect(error).toMatchObject({ name: 'ProviderError', retryable });
      expect((error as Error).message).not.toContain(KEY);
    }
  });

  it('treats blocked prompts and early stops as non-retryable', async () => {
    const blocked = new GeminiModel({
      apiKey: KEY,
      fetch: respond(200, { promptFeedback: { blockReason: 'SAFETY' } }),
    });
    await expect(blocked.generate(request())).rejects.toMatchObject({ retryable: false });

    const truncated = new GeminiModel({ apiKey: KEY, fetch: ok('{"summary":"x"', 'MAX_TOKENS') });
    await expect(truncated.generate(request())).rejects.toMatchObject({ retryable: false });
  });

  it('reports network failure and abort as retryable', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      new GeminiModel({ apiKey: KEY, fetch: down }).generate(request()),
    ).rejects.toMatchObject({ retryable: true });

    const aborted = (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;
    await expect(
      new GeminiModel({ apiKey: KEY, fetch: aborted }).generate(request()),
    ).rejects.toMatchObject({ retryable: true });
  });
});
