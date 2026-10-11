import { AnthropicModel } from './anthropic.js';
import { GeminiModel } from './gemini.js';
import { OllamaModel } from './ollama.js';
import type { StructuredModel } from './provider.js';

export type ProviderName = 'ollama' | 'gemini' | 'anthropic';

export interface ProviderInfo {
  name: ProviderName;
  /** Human-readable, includes the model, e.g. "Ollama (llama3.2)". */
  label: string;
  /** "local": text stays on this machine. "cloud": text is sent to a third party. */
  privacy: 'local' | 'cloud';
  available: boolean;
}

/**
 * Knows which providers are configured and builds their adapters. Selection is explicit per
 * request; cloud providers additionally need user consent, enforced by the server.
 */
export class ProviderRegistry {
  constructor(private env: NodeJS.ProcessEnv = process.env) {}

  defaultProvider(): ProviderName {
    const configured = this.env.LLM_PROVIDER;
    return configured === 'gemini' || configured === 'anthropic' ? configured : 'ollama';
  }

  list(): ProviderInfo[] {
    return [
      {
        name: 'ollama',
        label: `Ollama (${this.env.OLLAMA_MODEL ?? 'llama3.2'})`,
        privacy: 'local',
        available: true, // assumed: reachability is only known when a request is made
      },
      {
        name: 'gemini',
        label: `Gemini (${this.env.GEMINI_MODEL ?? 'gemini-2.5-flash'})`,
        privacy: 'cloud',
        available: Boolean(this.env.GEMINI_API_KEY),
      },
      {
        name: 'anthropic',
        label: `Anthropic (${this.env.LLM_MODEL ?? 'claude-opus-5-5'})`,
        privacy: 'cloud',
        available: Boolean(this.env.ANTHROPIC_API_KEY),
      },
    ];
  }

  info(name: ProviderName): ProviderInfo {
    return this.list().find((p) => p.name === name)!;
  }

  /** The adapter for a provider, or undefined when it is not configured. */
  get(name: ProviderName): StructuredModel | undefined {
    if (!this.info(name).available) return undefined;
    switch (name) {
      case 'ollama':
        return new OllamaModel({
          model: this.env.OLLAMA_MODEL,
          host: this.env.OLLAMA_HOST,
        });
      case 'gemini':
        return new GeminiModel({
          apiKey: this.env.GEMINI_API_KEY!,
          model: this.env.GEMINI_MODEL,
        });
      case 'anthropic': {
        const effort = this.env.LLM_EFFORT;
        return new AnthropicModel({
          model: this.env.LLM_MODEL,
          effort: effort === 'low' || effort === 'high' ? effort : 'medium',
        });
      }
    }
  }
}
