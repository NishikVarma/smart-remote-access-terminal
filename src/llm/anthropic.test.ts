import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicModel } from './anthropic.js';
import { ProviderError } from './provider.js';

// The adapter is exercised with a stand-in client; no network access is involved.
function modelWith(parse: () => Promise<unknown>): AnthropicModel {
  const client = { messages: { parse } } as unknown as Anthropic;
  return new AnthropicModel({ client });
}

const request = () => ({
  system: 's',
  user: 'u',
  schema: z.object({ summary: z.string() }),
  signal: new AbortController().signal,
});

const apiError = (status: number) =>
  Anthropic.APIError.generate(status, { error: { message: 'x' } }, 'x', new Headers());

describe('AnthropicModel', () => {
  it('returns the parsed output', async () => {
    const model = modelWith(async () => ({ stop_reason: 'end_turn', parsed_output: { ok: true } }));
    expect(await model.generate(request())).toEqual({ ok: true });
  });

  it('turns refusals and truncation into non-retryable provider errors', async () => {
    for (const stop_reason of ['refusal', 'max_tokens']) {
      const model = modelWith(async () => ({ stop_reason, parsed_output: null }));
      await expect(model.generate(request())).rejects.toMatchObject({
        name: 'ProviderError',
        retryable: false,
      });
    }
  });

  it('marks rate limits and server errors retryable, client errors not', async () => {
    const outcomes: Array<[number, boolean]> = [
      [429, true],
      [500, true],
      [529, true],
      [400, false],
      [401, false],
      [404, false],
    ];
    for (const [status, retryable] of outcomes) {
      const model = modelWith(async () => {
        throw apiError(status);
      });
      const error = await model.generate(request()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).retryable, `status ${status}`).toBe(retryable);
    }
  });

  it('marks an aborted request (timeout) retryable', async () => {
    const model = modelWith(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    await expect(model.generate(request())).rejects.toMatchObject({ retryable: true });
  });
});
