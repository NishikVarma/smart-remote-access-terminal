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

/**
 * Every suggested command needs a human decision; some are flagged as dangerous so a UI can warn.
 * Returns null when there is no command.
 */
export function classifyCommand(command: string | null): CommandRisk | null {
  if (command === null || command.trim() === '') return null;
  return DANGEROUS.some((pattern) => pattern.test(command)) ? 'dangerous' : 'review';
}
