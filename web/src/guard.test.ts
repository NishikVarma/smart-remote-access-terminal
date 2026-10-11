import { describe, expect, it } from 'vitest';
import { commandFromPromptLine, dangerousCommandIn, TypedLine } from './guard.js';

const ENTER = String.fromCharCode(13);
const BACKSPACE = String.fromCharCode(127);
const ESC = String.fromCharCode(27);
const TAB = String.fromCharCode(9);

describe('TypedLine', () => {
  it('follows typing, backspace and Enter', () => {
    const line = new TypedLine();
    line.observe('ls ');
    line.observe('-la');
    expect(line.snapshot()).toBe('ls -la');
    line.observe(BACKSPACE);
    expect(line.snapshot()).toBe('ls -l');
    line.observe(ENTER);
    expect(line.snapshot()).toBe('');
  });

  it('becomes unreliable after history recall or completion, and recovers on Enter', () => {
    const line = new TypedLine();
    line.observe('git ch');
    line.observe(TAB);
    expect(line.snapshot()).toBeNull();
    line.observe(ENTER);
    expect(line.snapshot()).toBe('');

    line.observe(`${ESC}[A`); // arrow up: a recalled command we cannot see
    expect(line.snapshot()).toBeNull();
  });

  it('treats a lone Escape as clearing the line', () => {
    const line = new TypedLine();
    line.observe('rm -rf x');
    line.observe(ESC);
    expect(line.snapshot()).toBe('');
  });
});

describe('typing that has not been echoed yet', () => {
  it('still catches a dangerous command when the screen shows only a harmless prefix', () => {
    const screen = 'PS D:\\x> Remove-Ite'; // the shell has echoed only part of what was typed
    const typed = 'Remove-Item -Recurse -Force .\\build';
    expect(dangerousCommandIn(ENTER, screen)).toBeNull(); // the screen alone is not enough
    expect(dangerousCommandIn(ENTER, screen, typed)).toBe(typed);
  });
});

describe('commandFromPromptLine', () => {
  it('extracts the command after common prompts', () => {
    expect(commandFromPromptLine('PS D:\\Projects\\app> Get-ChildItem -Force')).toBe(
      'Get-ChildItem -Force',
    );
    expect(commandFromPromptLine('C:\\Users\\me>dir /s')).toBe('dir /s');
    expect(commandFromPromptLine('me@host:~/code$ git status')).toBe('git status');
    expect(commandFromPromptLine('root# ls')).toBe('ls');
  });

  it('returns an empty command for a bare prompt and null for unknown text', () => {
    expect(commandFromPromptLine('PS D:\\x> ')).toBe('');
    expect(commandFromPromptLine('just some program output')).toBeNull();
  });
});

describe('dangerousCommandIn', () => {
  const prompt = 'PS D:\\x> ';

  it('flags a dangerous command already on the line when Enter is pressed', () => {
    expect(dangerousCommandIn(ENTER, `${prompt}Remove-Item .\\build -Recurse -Force`)).toBe(
      'Remove-Item .\\build -Recurse -Force',
    );
  });

  it('does not flag harmless commands or ordinary typing', () => {
    expect(dangerousCommandIn(ENTER, `${prompt}Get-ChildItem`)).toBeNull();
    expect(dangerousCommandIn('r', `${prompt}Remove-Item .\\build -Recurse`)).toBeNull(); // not submitted yet
    expect(dangerousCommandIn(ENTER, `${prompt}`)).toBeNull();
  });

  it('checks every line of pasted text', () => {
    const pasted = `echo hi${ENTER}git push origin main --force${ENTER}`;
    expect(dangerousCommandIn(pasted, prompt)).toBe('git push origin main --force');
  });

  it('combines text already typed with the first pasted line', () => {
    expect(dangerousCommandIn(`-rf /tmp/x${ENTER}`, 'me@host:~$ rm ')).toBe('rm -rf /tmp/x');
  });

  it('does nothing when the prompt is not recognised and nothing dangerous is pasted', () => {
    expect(dangerousCommandIn(ENTER, 'some unknown screen text rm -rf /')).toBeNull();
  });

  it('ignores control sequences such as arrow keys', () => {
    const up = String.fromCharCode(27) + '[A';
    expect(dangerousCommandIn(up, `${prompt}rm -rf x`)).toBeNull();
  });
});
