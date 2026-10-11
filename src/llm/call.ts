import type { ZodType } from 'zod';
import { ProviderError, type StructuredModel } from './provider.js';

export interface CallOptions<T> {
  model: StructuredModel;
  system: string;
  user: string;
  schema: ZodType<T>;
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

export type CallResult<T> =
  | { ok: true; value: T }
  | { ok: false; cause: 'provider_error' | 'invalid_output'; reason: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One structured model call with a per-attempt timeout, bounded retries for retryable provider
 * errors, and validation of the output. Never throws for provider problems.
 */
export async function callStructured<T>(options: CallOptions<T>): Promise<CallResult<T>> {
  const {
    model,
    system,
    user,
    schema,
    maxAttempts = 2,
    timeoutMs = 60_000,
    backoffMs = 500,
  } = options;

  let reason = 'no attempt made';
  let cause: 'provider_error' | 'invalid_output' = 'provider_error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await model.generate({
        system,
        user,
        schema,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed = schema.safeParse(raw);
      if (parsed.success) return { ok: true, value: parsed.data };
      cause = 'invalid_output';
      reason = 'the model output did not match the expected structure';
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      cause = 'provider_error';
      reason = error.message;
      if (!error.retryable) break;
      if (attempt < maxAttempts) await sleep(backoffMs * attempt);
    }
  }
  return { ok: false, cause, reason };
}
