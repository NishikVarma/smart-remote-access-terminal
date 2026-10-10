import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../src/retrieval/corpus.js';
import { docRanking, hitAtK, mean, reciprocalRank } from '../src/retrieval/metrics.js';

interface Case {
  id: string;
  query: string;
  relevant: string[];
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export function runRetrievalEval() {
  const index = buildIndex(here('../docs-corpus'));
  const cases: Case[] = readFileSync(here('./retrieval.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Case);

  const rows = cases.map((c) => {
    const ranking = docRanking(index.search(c.query, 10));
    const relevant = new Set(c.relevant);
    return {
      id: c.id,
      rank: ranking.findIndex((d) => relevant.has(d)) + 1 || null,
      hit1: hitAtK(ranking, relevant, 1),
      hit3: hitAtK(ranking, relevant, 3),
      hit5: hitAtK(ranking, relevant, 5),
      rr: reciprocalRank(ranking, relevant),
    };
  });

  return {
    queries: rows.length,
    recallAt1: mean(rows.map((r) => r.hit1)),
    recallAt3: mean(rows.map((r) => r.hit3)),
    recallAt5: mean(rows.map((r) => r.hit5)),
    mrr: mean(rows.map((r) => r.rr)),
    misses: rows.filter((r) => r.rank !== 1).map((r) => ({ id: r.id, rank: r.rank })),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = runRetrievalEval();
  console.log(`BM25 baseline over ${r.queries} author-written queries (document level)`);
  console.log(
    `Recall@1 ${r.recallAt1.toFixed(3)}  Recall@3 ${r.recallAt3.toFixed(3)}  Recall@5 ${r.recallAt5.toFixed(3)}  MRR ${r.mrr.toFixed(3)}`,
  );
  console.log('Not rank 1:', JSON.stringify(r.misses));
}
