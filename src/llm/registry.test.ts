import { describe, expect, it } from 'vitest';
import { GeminiModel } from './gemini.js';
import { OllamaModel } from './ollama.js';
import { ProviderRegistry } from './registry.js';

describe('ProviderRegistry', () => {
  it('defaults to the local provider and marks cloud providers unavailable without keys', () => {
    const registry = new ProviderRegistry({});
    expect(registry.defaultProvider()).toBe('ollama');
    expect(registry.list().map((p) => [p.name, p.privacy, p.available])).toEqual([
      ['ollama', 'local', true],
      ['gemini', 'cloud', false],
      ['anthropic', 'cloud', false],
    ]);
    expect(registry.get('gemini')).toBeUndefined();
    expect(registry.get('ollama')).toBeInstanceOf(OllamaModel);
  });

  it('enables Gemini when a key is present and puts the model in the label', () => {
    const registry = new ProviderRegistry({
      GEMINI_API_KEY: 'k',
      GEMINI_MODEL: 'gemini-2.5-flash',
    });
    expect(registry.info('gemini')).toMatchObject({
      available: true,
      label: 'Gemini (gemini-2.5-flash)',
    });
    expect(registry.get('gemini')).toBeInstanceOf(GeminiModel);
  });

  it('never puts a key in a label', () => {
    const registry = new ProviderRegistry({
      GEMINI_API_KEY: 'super-secret',
      ANTHROPIC_API_KEY: 'also-secret',
    });
    expect(JSON.stringify(registry.list())).not.toMatch(/secret/);
  });

  it('honours LLM_PROVIDER for the default', () => {
    expect(new ProviderRegistry({ LLM_PROVIDER: 'gemini' }).defaultProvider()).toBe('gemini');
    expect(new ProviderRegistry({ LLM_PROVIDER: 'bogus' }).defaultProvider()).toBe('ollama');
  });
});
