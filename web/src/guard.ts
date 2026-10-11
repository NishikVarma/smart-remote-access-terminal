// DOM-free logic for the dangerous-command guard, so it can be unit tested.
import { classifyCommand } from '../../src/diagnosis/command-risk.js';

// Known prompt shapes, most specific first. Each captures what follows the prompt.
const PROMPTS: RegExp[] = [
  /^PS [^>]*>\s?(.*)$/, // PowerShell
  /^[A-Za-z]:\\[^>]*>(.*)$/, // cmd.exe
  /^[^\s@]+@[^\s:]+:[^$#]*[$#]\s(.*)$/, // bash: user@host:path$
  /^.{0,60}[$#%]\s(.*)$/, // anything that ends a short prefix with $ # or %
];

/** The command typed after the prompt on a terminal line, or null when the prompt is not recognised. */
export function commandFromPromptLine(line: string): string | null {
  for (const pattern of PROMPTS) {
    const match = pattern.exec(line);
    if (match) return match[1] ?? '';
  }
  return null;
}

const ESC = 0x1b;
const DEL = 0x7f;
const BACKSPACE = 0x08;
const CTRL_C = 0x03;
const CTRL_U = 0x15;
const TAB = 0x09;

/**
 * What the user has typed on the current line, tracked locally from the keystrokes themselves.
 *
 * The terminal screen only shows keystrokes after the shell echoes them, so when typing is fast
 * the screen can lag behind the Enter key. Tracking the keystrokes closes that gap. History
 * recall, tab completion and cursor movement cannot be followed, so the text becomes unreliable
 * (null) until the next Enter or an explicit clear; the screen is the fallback in that case.
 */
export class TypedLine {
  private text = '';
  private reliable = true;

  /** The typed text, or null when it can no longer be followed. */
  snapshot(): string | null {
    return this.reliable ? this.text : null;
  }

  /** Call with every chunk of input that is actually sent to the shell. */
  observe(data: string): void {
    // A lone Escape clears the line in PSReadLine; any longer escape sequence is a cursor key etc.
    if (data.length > 1 && data.codePointAt(0) === ESC) {
      this.reliable = false;
      return;
    }
    for (const ch of data) {
      const code = ch.codePointAt(0)!;
      if (ch === '\r' || ch === '\n') {
        this.text = '';
        this.reliable = true;
      } else if (code === DEL || code === BACKSPACE) {
        this.text = this.text.slice(0, -1);
      } else if (code === ESC || code === CTRL_C || code === CTRL_U) {
        this.text = '';
        this.reliable = true;
      } else if (code === TAB) {
        this.reliable = false;
      } else if (code >= 0x20) {
        this.text += ch;
      } else {
        this.reliable = false; // some other control key (Ctrl+W, Ctrl+R, ...)
      }
    }
  }
}

/**
 * Looks at input that is about to be sent to the shell and returns the first command in it that the
 * risk rules call dangerous, or null.
 *
 * Two views of the text already on the line are checked: the screen (`currentLine`, including the
 * prompt, which covers history recall and completion) and the locally tracked keystrokes
 * (`typed`, which covers typing that has not been echoed yet). Pasted text with line breaks is
 * checked line by line.
 *
 * This is a typo guard, not a security boundary: aliases, scripts, and unrecognised prompts get past it.
 */
export function dangerousCommandIn(
  data: string,
  currentLine: string | null,
  typed: string | null = null,
): string | null {
  const parts = data.split(/\r\n|\r|\n/);
  if (parts.length < 2) return null; // nothing is being submitted

  // The tracked keystrokes come first: they are exact, while the screen may still be catching up.
  const bases: string[] = [];
  if (typed !== null) bases.push(typed);
  if (currentLine !== null) bases.push(commandFromPromptLine(currentLine) ?? '');
  if (bases.length === 0) bases.push('');

  const first = parts[0] ?? '';
  const later = parts.slice(1, -1);
  const submitted = [...bases.map((base) => base + first), ...later];
  return submitted.find((command) => classifyCommand(command.trim()) === 'dangerous') ?? null;
}
