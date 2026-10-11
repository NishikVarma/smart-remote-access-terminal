import type { ZodType } from 'zod';

export interface GenerateRequest {
  system: string;
  user: string;
  /** The shape the answer must have. Adapters pass it to the provider's structured-output feature. */
  schema: ZodType;
  signal: AbortSignal;
}

/**
 * The only thing the rest of the project knows about an LLM provider. Returns the raw structured
 * output (unvalidated: callers validate it again) or throws a ProviderError.
 */
export interface StructuredModel {
  generate(request: GenerateRequest): Promise<unknown>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** True for rate limits, timeouts, connection problems and 5xx: worth another attempt. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
