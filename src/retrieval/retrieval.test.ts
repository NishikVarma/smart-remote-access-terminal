import { describe, expect, it } from 'vitest';
import { Bm25Index, chunkMarkdown, tokenize } from './bm25.js';
import { docRanking, hitAtK, mean, reciprocalRank } from './metrics.js';

describe('chunkMarkdown', () => {
  it('splits at ## headings and keeps the document title', () => {
    const chunks = chunkMarkdown(
      'doc',
      '# Title\n\nintro text\n\n## Cause\nthe cause\n\n## Fix\nthe fix',
    );
    expect(chunks.map((c) => c.id)).toEqual(['doc#0', 'doc#1', 'doc#2']);
    expect(chunks[1]!.title).toBe('Title / Cause');
    expect(chunks[2]!.text).toBe('the fix');
  });
});

describe('Bm25Index', () => {
  const index = new Bm25Index([
    ...chunkMarkdown(
      'ports',
      '# Ports\n\n## Fix\nEADDRINUSE means the address is already in use by another process.',
    ),
    ...chunkMarkdown('disk', '# Disk\n\n## Fix\nENOSPC means no space is left on the device.'),
  ]);

  it('ranks the matching document first', () => {
    expect(index.search('listen EADDRINUSE already in use')[0]!.chunk.docId).toBe('ports');
    expect(index.search('no space left ENOSPC')[0]!.chunk.docId).toBe('disk');
  });

  it('returns nothing for a query with no shared terms', () => {
    expect(index.search('kubernetes ingress')).toEqual([]);
  });

  it('tokenizes case-insensitively and drops stopwords', () => {
    expect(tokenize('The ERROR is in the Module')).toEqual(['error', 'module']);
  });
});

describe('metrics', () => {
  it('computes hit@k, reciprocal rank and mean', () => {
    const relevant = new Set(['b']);
    expect(hitAtK(['a', 'b', 'c'], relevant, 1)).toBe(0);
    expect(hitAtK(['a', 'b', 'c'], relevant, 2)).toBe(1);
    expect(reciprocalRank(['a', 'b', 'c'], relevant)).toBe(0.5);
    expect(reciprocalRank(['a', 'c'], relevant)).toBe(0);
    expect(mean([1, 0, 0.5])).toBe(0.5);
  });

  it('deduplicates chunk hits into a document ranking', () => {
    const hits = [{ chunk: { docId: 'a' } }, { chunk: { docId: 'a' } }, { chunk: { docId: 'b' } }];
    expect(docRanking(hits)).toEqual(['a', 'b']);
  });
});
