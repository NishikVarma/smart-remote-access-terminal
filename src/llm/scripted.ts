import type { GenerateRequest, StructuredModel } from './provider.js';

/**
 * Deterministic stand-in for a real model: returns (or throws) queued responses in order and
 * records every request. Used by tests and by offline demos; it makes no claims about quality.
 */
export class ScriptedModel implements StructuredModel {
  readonly requests: GenerateRequest[] = [];
  private next = 0;

  constructor(private responses: Array<unknown | Error>) {}

  async generate(request: GenerateRequest): Promise<unknown> {
    this.requests.push(request);
    const response = this.responses[Math.min(this.next++, this.responses.length - 1)];
    if (response instanceof Error) throw response;
    return response;
  }
}
