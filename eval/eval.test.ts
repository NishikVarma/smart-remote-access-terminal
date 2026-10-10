import { describe, expect, it } from 'vitest';
import { runBaselineEval } from './run-baseline.js';
import { runRetrievalEval } from './run-retrieval.js';

// Regression floors for the baselines. They guard against accidental breakage; they are not
// evidence of quality (the sets are small and written by the project author).
describe('baseline evaluations', () => {
  it('BM25 finds the expected document within the top 3 for the retrieval set', () => {
    const r = runRetrievalEval();
    expect(r.queries).toBeGreaterThanOrEqual(15);
    expect(r.recallAt3).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps the recorded rules-baseline scores (easy 14/14, hard 3/8)', () => {
    const r = runBaselineEval();
    expect(r.easy).toEqual({ total: 14, correct: 14 });
    expect(r.hard).toEqual({ total: 8, correct: 3 });
  });
});
