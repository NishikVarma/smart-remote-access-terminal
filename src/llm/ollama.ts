import { z } from 'zod';
import { ModelDiagnosisSchema } from '../diagnosis/schema.js';
import { ProviderError, type DiagnosisModel, type GenerateRequest } from './provider.js';

export interface OllamaModelOptions {
  host?: string;
  model?: string;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

const SCHEMA = z.toJSONSchema(ModelDiagnosisSchema);

/**
 * Adapter for a local Ollama server (free, runs on your own machine, nothing leaves it).
 * Uses Ollama's structured-output support: the JSON Schema is passed as `format`, which
 * constrains decoding to that shape. Content quality depends heavily on the local model.
 */
export class OllamaModel implements DiagnosisModel {
  private host: string;
  private model: string;
  private fetchFn: typeof fetch;

  constructor(options: OllamaModelOptions = {}) {
    this.host = (options.host ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = options.model ?? 'llama3.2';
    this.fetchFn = options.fetch ?? fetch;
  }

  async generate({ system, user, signal }: GenerateRequest): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: SCHEMA,
          options: { temperature: 0 },
          messages: [
            // Small models follow the shape better when it is also stated in the prompt.
            {
              role: 'system',
              content: `${system}\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(SCHEMA)}`,
            },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderError(`cannot reach Ollama at ${this.host}: ${reason}`, true);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        `Ollama ${response.status}: ${body.slice(0, 200)}`,
        response.status >= 500,
      );
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    try {
      return JSON.parse(payload.message?.content ?? '');
    } catch {
      return null; // not JSON: diagnose() reports invalid_output
    }
  }
}
