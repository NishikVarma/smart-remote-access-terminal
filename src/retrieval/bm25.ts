export interface Chunk {
  /** Stable id: `<file>#<index>`. */
  id: string;
  docId: string;
  title: string;
  text: string;
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
}

const STOPWORDS = new Set(
  'a an and are as at be but by for from has have in is it its of on or that the this to was were will with not no'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Splits a markdown document into chunks at headings, so each chunk is one topic. */
export function chunkMarkdown(docId: string, markdown: string): Chunk[] {
  const lines = markdown.split(/\r?\n/);
  const docTitle =
    lines
      .find((l) => l.startsWith('# '))
      ?.slice(2)
      .trim() ?? docId;
  const chunks: Chunk[] = [];
  let heading = docTitle;
  let body: string[] = [];

  const flush = () => {
    const text = body.join('\n').trim();
    if (text) {
      chunks.push({
        id: `${docId}#${chunks.length}`,
        docId,
        title: heading === docTitle ? docTitle : `${docTitle} / ${heading}`,
        text,
      });
    }
    body = [];
  };

  for (const line of lines) {
    const match = /^#{2,3}\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[1]!.trim();
    } else if (!line.startsWith('# ')) {
      body.push(line);
    }
  }
  flush();
  return chunks;
}

/** Okapi BM25 over in-memory chunks. Title words are included in the indexed text. */
export class Bm25Index {
  private termFreqs: Map<string, number>[] = [];
  private lengths: number[] = [];
  private docFreq = new Map<string, number>();
  private avgLength = 0;

  constructor(
    private chunks: Chunk[],
    private k1 = 1.5,
    private b = 0.75,
  ) {
    for (const chunk of chunks) {
      const tokens = tokenize(`${chunk.title} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.termFreqs.push(tf);
      this.lengths.push(tokens.length);
      for (const term of tf.keys()) this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }
    this.avgLength = this.lengths.reduce((a, n) => a + n, 0) / Math.max(chunks.length, 1);
  }

  search(query: string, k = 5): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    const n = this.chunks.length;
    const hits: SearchHit[] = [];

    this.chunks.forEach((chunk, i) => {
      let score = 0;
      for (const term of terms) {
        const f = this.termFreqs[i]!.get(term);
        if (!f) continue;
        const df = this.docFreq.get(term)!;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = 1 - this.b + (this.b * this.lengths[i]!) / this.avgLength;
        score += (idf * f * (this.k1 + 1)) / (f + this.k1 * norm);
      }
      if (score > 0) hits.push({ chunk, score });
    });

    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
