import type { CATEGORIES } from '../diagnosis/schema.js';

type Category = (typeof CATEGORIES)[number];

// Order matters: the first matching rule wins, most specific first.
const RULES: Array<[Category, RegExp]> = [
  ['syntax', /\bSyntaxError\b|\bunexpected token\b|\bparse error\b/i],
  [
    'dependency',
    /ModuleNotFoundError|Cannot find module|ERR_MODULE_NOT_FOUND|No module named|ImportError/i,
  ],
  ['permission', /\bEACCES\b|\bEPERM\b|permission denied|access is denied|PermissionError/i],
  [
    'resource',
    /EADDRINUSE|address already in use|heap out of memory|OutOfMemoryError|MemoryError|\bENOSPC\b|no space left/i,
  ],
  [
    'network',
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|getaddrinfo|could not resolve host|certificate|timed out/i,
  ],
  [
    'configuration',
    /missing required|environment variable|invalid configuration|config(uration)? (file )?not found/i,
  ],
  [
    'runtime',
    /\bTypeError\b|\bReferenceError\b|\bRangeError\b|\bNullPointerException\b|\bException\b/,
  ],
];

/** Keyword baseline: the thing any model-based diagnosis has to beat to be worth its cost. */
export function ruleBasedCategory(log: string): Category {
  for (const [category, pattern] of RULES) if (pattern.test(log)) return category;
  return 'unknown';
}
