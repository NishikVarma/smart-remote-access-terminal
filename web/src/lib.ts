// DOM-free helpers, so they can be unit tested.
import { normalizeCommand } from '../../src/diagnosis/command-risk.js';
import type { AbstainCause, CommandRisk } from '../../src/diagnosis/schema.js';

/** The last `count` non-trailing-blank lines of a list of terminal lines. */
export function lastLines(lines: string[], count: number): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === '') end--;
  return lines.slice(Math.max(0, end - count), end).join('\n');
}

export interface ProviderView {
  name: string;
  label: string;
  privacy: 'local' | 'cloud';
}

/** The sentence the user sees before text is sent. Cloud text must be unmistakable. */
export function privacyNotice(provider: ProviderView, chars: number): string {
  if (provider.privacy === 'local') {
    return `${chars} characters will be analysed by ${provider.label} on this computer.`;
  }
  return (
    `${chars} characters will be sent over the internet to ${provider.label}. ` +
    'Obvious secrets are filtered first, but the filter is best effort. ' +
    'On free tiers the provider may use submitted text to improve its products. Continue?'
  );
}

const ABSTAIN_TEXT: Record<AbstainCause, string> = {
  empty_input: 'There was nothing to analyse. Select some terminal output first.',
  insufficient_evidence: 'The model says the output does not contain enough information to tell.',
  ungrounded:
    'The model gave an answer, but none of it could be tied to quotes from the output, so it was discarded.',
  provider_error: 'The model provider could not be reached or refused the request.',
  invalid_output: 'The model answered in an unusable format.',
};

export const abstainText = (cause: AbstainCause): string => ABSTAIN_TEXT[cause];

export type ApprovalMode = 'insert' | 'run';

const ENTER = String.fromCharCode(13);

/**
 * The only place that turns an AI-suggested command into terminal input.
 *
 * - `insert` types the command without Enter: the user reviews it in the terminal and presses Enter.
 * - `run` types it and presses Enter.
 * Returns null (send nothing) when the text is not exactly a safe single-line command, or when it is
 * dangerous and the user does not confirm. The caller must only call this from a user's own click.
 */
export function prepareInput(
  command: string,
  mode: ApprovalMode,
  risk: CommandRisk | null,
  confirmDangerous: () => boolean,
): string | null {
  // Defence in depth: the server already normalised it, but the client re-checks what it will type.
  if (normalizeCommand(command) !== command) return null;
  if (mode === 'run' && risk === 'dangerous' && !confirmDangerous()) return null;
  return mode === 'run' ? command + ENTER : command;
}
