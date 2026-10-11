import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../src/diagnosis/diagnose.js';
import { ProviderRegistry } from '../src/llm/registry.js';
import { buildIndex } from '../src/retrieval/corpus.js';
import { ruleBasedCategory } from '../src/baseline/rules.js';

interface Case {
  id: string;
  category: string;
  log: string;
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Usage: LLM_PROVIDER=ollama OLLAMA_MODEL=llama3.2 npm run eval:llm
const registry = new ProviderRegistry();
const providerName = registry.defaultProvider();
const model = registry.get(providerName);
if (!model) throw new Error(`Provider "${providerName}" is not configured`);
const label = `${providerName}:${registry.info(providerName).label.replace(/^.*\(|\)$/g, '')}`;
const index = buildIndex(here('../docs-corpus'));
const cases: Case[] = readFileSync(here('./diagnosis.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Case)
  .filter((c) => !process.env.EVAL_IDS || process.env.EVAL_IDS.split(',').includes(c.id));

interface Row {
  id: string;
  set: 'easy' | 'hard';
  expected: string;
  got: string;
  correct: boolean;
  rules: string;
  abstainCause: string | null;
  reason: string | null;
  droppedClaims: number | null;
  ms: number;
}

const rows: Row[] = [];
for (const c of cases) {
  const start = performance.now();
  const result = await diagnose(c.log, {
    model,
    index,
    timeoutMs: 120_000,
    maxAttempts: 3,
    backoffMs: 5000,
  });
  const ms = Math.round(performance.now() - start);

  // For logs that carry no information ("unknown"), abstaining is the correct behaviour.
  const got = result.abstained ? 'abstained' : result.diagnosis.category;
  const correct =
    c.category === 'unknown'
      ? result.abstained || got === 'unknown'
      : !result.abstained && got === c.category;

  rows.push({
    id: c.id,
    set: c.id.startsWith('h') ? 'hard' : 'easy',
    expected: c.category,
    got,
    correct,
    rules: ruleBasedCategory(c.log),
    abstainCause: result.abstained ? result.cause : null,
    reason: result.abstained ? result.reason : null,
    droppedClaims: result.abstained ? null : result.diagnosis.droppedClaims,
    ms,
  });
  console.error(`${c.id} expected=${c.category} got=${got} ${correct ? 'ok' : 'WRONG'} ${ms}ms`);
}

const summarize = (set: string) => {
  const subset = rows.filter((r) => r.set === set);
  return {
    total: subset.length,
    correct: subset.filter((r) => r.correct).length,
    rulesCorrect: subset.filter((r) => r.rules === r.expected).length,
  };
};
const summary = {
  provider: label,
  date: new Date().toISOString().slice(0, 10),
  easy: summarize('easy'),
  hard: summarize('hard'),
  abstained: rows.filter((r) => r.got === 'abstained').length,
  abstainCauses: rows.reduce<Record<string, number>>((acc, r) => {
    if (r.abstainCause) acc[r.abstainCause] = (acc[r.abstainCause] ?? 0) + 1;
    return acc;
  }, {}),
  meanLatencyMs: Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length),
};

mkdirSync(here('./results'), { recursive: true });
const suffix = process.env.EVAL_IDS ? '-subset' : '';
const file = here(
  `./results/${label.replace(/[^a-z0-9.-]+/gi, '_')}-${summary.date}${suffix}.json`,
);
writeFileSync(file, JSON.stringify({ summary, rows }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
console.log(`wrote ${file}`);
