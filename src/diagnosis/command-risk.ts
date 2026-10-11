import type { CommandRisk } from './schema.js';

// Deterministic, code-owned classification. The model's opinion about its own commands is never used.
const DANGEROUS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive|-r\b)/i,
  /\brm\s+-[a-z]*\s+\/(\s|$)/i,
  /\bdel\b.*\/[sq]\b/i,
  /\brmdir\b.*\/s\b/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\bformat\b\s+[a-z]:/i,
  /\bmkfs(\.|\s)/i,
  /\bdd\s+.*\bof=\/dev\//i,
  /\bdrop\s+(table|database)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force)/i,
  /\bchmod\s+(-R\s+)?[0-7]*7[0-7]*\s+\//i,
  /\bshutdown\b|\breboot\b|\bStop-Computer\b|\bRestart-Computer\b/i,
  /\|\s*(sh|bash|powershell|pwsh|iex)\b/i,
  /\bInvoke-Expression\b|\biex\b\s/i,
  /\bcurl\b[^|]*\|\s*\w+/i,
  /\bnpm\s+(publish|unpublish)\b/i,
  /\bsudo\b/i,
];

const NO_COMMAND = new Set(['', 'null', 'none', 'n/a', 'na', '-', 'no command']);

/** Models sometimes return the text "null" or "none" instead of a real null. */
export function normalizeCommand(command: string | null | undefined): string | null {
  if (command === null || command === undefined) return null;
  const trimmed = command.trim();
  return NO_COMMAND.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Every suggested command needs a human decision; some are flagged as dangerous so a UI can warn.
 * Returns null when there is no command.
 */
export function classifyCommand(command: string | null): CommandRisk | null {
  const normalized = normalizeCommand(command);
  if (normalized === null) return null;
  return DANGEROUS.some((pattern) => pattern.test(normalized)) ? 'dangerous' : 'review';
}
