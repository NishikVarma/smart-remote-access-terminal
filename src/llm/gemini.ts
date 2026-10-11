import { z } from 'zod';
import { ProviderError, type GenerateRequest, type StructuredModel } from './provider.js';

export interface GeminiModelOptions {
  apiKey: string;
  /** A stable model code from the Gemini API model list. */
  model?: string;
  baseUrl?: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { status?: string; message?: string };
}

/**
 * Adapter for the Gemini API (generateContent) with a JSON response schema.
 *
 * PRIVACY: on the free (unpaid) tier Google may use prompts and responses to improve its products
 * and human reviewers may read them. Callers must make that visible and require explicit consent.
 * The API key is sent in a header, never in the URL, and never included in error messages.
 */
export class GeminiModel implements StructuredModel {
  private model: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(private options: GeminiModelOptions) {
    this.model = options.model ?? 'gemini-2.5-flash';
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
      /\/$/,
      '',
    );
    this.fetchFn = options.fetch ?? fetch;
  }

  async generate({ system, user, schema, signal }: GenerateRequest): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            // `responseJsonSchema` takes standard JSON Schema; the older `responseSchema` field
            // rejects keys such as $schema and additionalProperties.
            responseJsonSchema: z.toJSONSchema(schema),
          },
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('request aborted (timeout)', true);
      }
      throw new ProviderError('cannot reach the Gemini API', true);
    }

    const body = (await response.json().catch(() => ({}))) as GenerateContentResponse;

    if (!response.ok) {
      const status = body.error?.status ?? String(response.status);
      const message = (body.error?.message ?? '').slice(0, 200);
      // 429 (quota / rate limit) and 5xx are worth another attempt; other 4xx are not.
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(`Gemini ${response.status} ${status}: ${message}`, retryable);
    }

    if (body.promptFeedback?.blockReason) {
      throw new ProviderError(
        `blocked by the provider (${body.promptFeedback.blockReason})`,
        false,
      );
    }
    const candidate = body.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new ProviderError(`generation stopped early (${candidate.finishReason})`, false);
    }

    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      return JSON.parse(text);
    } catch {
      return null; // not JSON: callers report invalid output
    }
  }
}
