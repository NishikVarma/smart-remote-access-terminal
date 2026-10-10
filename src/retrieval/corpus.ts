import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Bm25Index, chunkMarkdown, type Chunk } from './bm25.js';

/** Loads every .md file in a folder; the document id is the file name without extension. */
export function loadCorpus(dir: string): Chunk[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .flatMap((name) => chunkMarkdown(basename(name, '.md'), readFileSync(join(dir, name), 'utf8')));
}

export const buildIndex = (dir: string) => new Bm25Index(loadCorpus(dir));
