/** 1 if any relevant doc appears in the first k results, else 0. */
export function hitAtK(rankedDocIds: string[], relevant: Set<string>, k: number): number {
  return rankedDocIds.slice(0, k).some((id) => relevant.has(id)) ? 1 : 0;
}

/** Reciprocal rank of the first relevant result (0 if none). */
export function reciprocalRank(rankedDocIds: string[], relevant: Set<string>): number {
  const index = rankedDocIds.findIndex((id) => relevant.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, v) => a + v, 0) / values.length;
}

/** Ranked, de-duplicated doc ids from chunk-level hits (best chunk per document wins). */
export function docRanking(hits: Array<{ chunk: { docId: string } }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { chunk } of hits) {
    if (!seen.has(chunk.docId)) {
      seen.add(chunk.docId);
      out.push(chunk.docId);
    }
  }
  return out;
}
