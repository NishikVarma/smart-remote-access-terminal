import { AnthropicModel } from './anthropic.js';
import { OllamaModel } from './ollama.js';
import type { DiagnosisModel } from './provider.js';

/**
 * Chooses a provider from environment variables.
 *   LLM_PROVIDER=ollama     (default) free, local; OLLAMA_MODEL (default llama3.2), OLLAMA_HOST
 *   LLM_PROVIDER=anthropic  needs ANTHROPIC_API_KEY or an `ant auth login` profile; LLM_MODEL, LLM_EFFORT
 */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): {
  model: DiagnosisModel;
  label: string;
} {
  const provider = env.LLM_PROVIDER ?? 'ollama';
  if (provider === 'anthropic') {
    const effort =
      env.LLM_EFFORT === 'low' || env.LLM_EFFORT === 'high' ? env.LLM_EFFORT : 'medium';
    const name = env.LLM_MODEL ?? 'claude-opus-5-5';
    return { model: new AnthropicModel({ model: name, effort }), label: `anthropic:${name}` };
  }
  if (provider === 'ollama') {
    const name = env.OLLAMA_MODEL ?? 'llama3.2';
    return {
      model: new OllamaModel({ model: name, host: env.OLLAMA_HOST }),
      label: `ollama:${name}`,
    };
  }
  throw new Error(`Unknown LLM_PROVIDER "${provider}" (use "ollama" or "anthropic")`);
}
