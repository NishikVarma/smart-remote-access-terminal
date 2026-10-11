import { describe, expect, it } from 'vitest';
import { abstainText, lastLines, privacyNotice } from './lib.js';

describe('lastLines', () => {
  it('returns the last n lines and ignores trailing blank terminal rows', () => {
    const lines = ['a', 'b', 'c', 'd', '', '   ', ''];
    expect(lastLines(lines, 2)).toBe('c\nd');
    expect(lastLines(lines, 10)).toBe('a\nb\nc\nd');
  });

  it('handles an empty screen', () => {
    expect(lastLines(['', ''], 5)).toBe('');
    expect(lastLines([], 5)).toBe('');
  });
});

describe('privacyNotice', () => {
  it('says local text stays on this computer', () => {
    const text = privacyNotice(
      { name: 'ollama', label: 'Ollama (llama3.2)', privacy: 'local' },
      120,
    );
    expect(text).toContain('on this computer');
    expect(text).not.toContain('internet');
  });

  it('makes cloud egress, the best-effort filter, and provider data use explicit', () => {
    const text = privacyNotice(
      { name: 'gemini', label: 'Gemini (gemini-2.5-flash)', privacy: 'cloud' },
      900,
    );
    expect(text).toContain('900 characters');
    expect(text).toContain('over the internet');
    expect(text).toContain('best effort');
    expect(text).toContain('improve its products');
  });
});

describe('abstainText', () => {
  it('has a message for every abstention cause', () => {
    for (const cause of [
      'empty_input',
      'insufficient_evidence',
      'ungrounded',
      'provider_error',
      'invalid_output',
    ] as const) {
      expect(abstainText(cause).length).toBeGreaterThan(10);
    }
  });
});
