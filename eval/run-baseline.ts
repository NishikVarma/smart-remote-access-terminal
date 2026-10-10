import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ruleBasedCategory } from '../src/baseline/rules.js';

interface Case {
  id: string;
  category: string;
  log: string;
}

export function runBaselineEval() {
  const cases: Case[] = readFileSync(
    fileURLToPath(new URL('./diagnosis.jsonl', import.meta.url)),
    'utf8',
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Case);

  const results = cases.map((c) => ({
    id: c.id,
    // ids starting with "h" are the deliberately hard cases, frozen before the rules were run on them
    set: c.id.startsWith('h') ? 'hard' : 'easy',
    expected: c.category,
    got: ruleBasedCategory(c.log),
  }));
  const score = (set: string) => {
    const rows = results.filter((r) => r.set === set);
    return { total: rows.length, correct: rows.filter((r) => r.expected === r.got).length };
  };

  return {
    easy: score('easy'),
    hard: score('hard'),
    wrong: results.filter((r) => r.expected !== r.got),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = runBaselineEval();
  console.log('Rules baseline (author-written samples, category accuracy)');
  console.log(`easy: ${r.easy.correct}/${r.easy.total}   hard: ${r.hard.correct}/${r.hard.total}`);
  if (r.wrong.length > 0) console.log('Wrong:', JSON.stringify(r.wrong));
}
