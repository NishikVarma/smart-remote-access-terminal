import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ModelDiagnosisSchema } from '../diagnosis/schema.js';
import { ProviderError, type DiagnosisModel, type GenerateRequest } from './provider.js';

export interface AnthropicModelOptions {
  /** Defaults to ANTHROPIC_API_KEY or an `ant auth login` profile via the SDK. */
  client?: Anthropic;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}

/**
 * Adapter for the Anthropic Messages API using structured outputs.
 * NOTE: not exercised against the real API in this repository's tests (no key available in CI).
 */
export class AnthropicModel implements DiagnosisModel {
  private client: Anthropic;
  private model: string;
  private effort: 'low' | 'medium' | 'high';
  private maxTokens: number;

  constructor(options: AnthropicModelOptions = {}) {
    // Retries are owned by diagnose(), so the SDK's own retries are turned off.
    this.client = options.client ?? new Anthropic({ maxRetries: 0 });
    this.model = options.model ?? 'claude-opus-5-5';
    this.effort = options.effort ?? 'medium';
    this.maxTokens = options.maxTokens ?? 8000;
  }

  async generate({ system, user, signal }: GenerateRequest): Promise<unknown> {
    try {
      const response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort: this.effort, format: zodOutputFormat(ModelDiagnosisSchema) },
        },
        { signal },
      );
      if (response.stop_reason === 'refusal') throw new ProviderError('model refused', false);
      if (response.stop_reason === 'max_tokens') throw new ProviderError('output truncated', false);
      return response.parsed_output;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (
        error instanceof Anthropic.APIConnectionError ||
        error instanceof Anthropic.RateLimitError
      ) {
        throw new ProviderError(error.message, true);
      }
      if (error instanceof Anthropic.APIError) {
        throw new ProviderError(
          `API error ${error.status}: ${error.message}`,
          (error.status ?? 0) >= 500,
        );
      }
      // AbortError from our own timeout/cancel surfaces here.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('request aborted (timeout)', true);
      }
      throw error;
    }
  }
}
