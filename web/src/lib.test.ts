import { describe, expect, it } from 'vitest';
import { abstainText, lastLines, prepareInput, privacyNotice } from './lib.js';

const ENTER = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const ESC = String.fromCharCode(27);

describe('prepareInput (the only path from a suggestion to the terminal)', () => {
  const never = () => {
    throw new Error('should not ask for confirmation');
  };

  it('insert types the command without Enter', () => {
    expect(prepareInput('Get-Process', 'insert', 'review', never)).toBe('Get-Process');
  });

  it('run types the command and presses Enter', () => {
    expect(prepareInput('Get-Process', 'run', 'review', never)).toBe(`Get-Process${ENTER}`);
  });

  it('a dangerous command is only run after the user confirms again', () => {
    let asked = 0;
    const deny = () => (asked++, false);
    const accept = () => (asked++, true);

    expect(prepareInput('rm -rf build', 'run', 'dangerous', deny)).toBeNull();
    expect(prepareInput('rm -rf build', 'run', 'dangerous', accept)).toBe(`rm -rf build${ENTER}`);
    expect(asked).toBe(2);
  });

  it('inserting a dangerous command needs no extra step because the user still has to press Enter', () => {
    expect(prepareInput('rm -rf build', 'insert', 'dangerous', never)).toBe('rm -rf build');
  });

  it('refuses anything that is not exactly one safe line', () => {
    expect(prepareInput(`ls${LF}rm -rf /`, 'run', 'review', never)).toBeNull();
    expect(prepareInput(`echo ${ESC}[2J`, 'insert', 'review', never)).toBeNull();
    expect(prepareInput('null', 'run', 'review', never)).toBeNull();
    expect(prepareInput('  ls  ', 'run', 'review', never)).toBeNull(); // must already be normalised
  });
});

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
