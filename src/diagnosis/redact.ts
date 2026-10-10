const PATTERNS: Array<[name: string, pattern: RegExp]> = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  // key=value or key: value for obviously secret-looking names
  [
    'assignment',
    /\b(password|passwd|secret|api[_-]?key|token|authorization)\b(\s*[=:]\s*)(?!\[REDACTED)("[^"\n]+"|'[^'\n]+'|[^\s"',;]+)/gi,
  ],
];

/**
 * Removes obvious secrets before log text leaves the machine. This is a best-effort filter, not a
 * guarantee: unusual secret formats will pass through. Returns the cleaned text and a count.
 */
export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [name, pattern] of PATTERNS) {
    out = out.replace(pattern, (...args: unknown[]) => {
      count++;
      if (name === 'assignment') return `${String(args[1])}${String(args[2])}[REDACTED]`;
      return `[REDACTED:${name}]`;
    });
  }
  return { text: out, count };
}
