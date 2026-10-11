import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diagnose } from './diagnosis/diagnose.js';
import { modelFromEnv } from './llm/select.js';
import { buildIndex } from './retrieval/corpus.js';

// Usage: npm run diagnose -- <logfile>      (or pipe the log on stdin)
// Provider: LLM_PROVIDER=ollama (default, free and local) or anthropic. See .env.example.
async function readInput(): Promise<string> {
  const file = process.argv[2];
  if (file) return readFileSync(file, 'utf8');
  if (process.stdin.isTTY) {
    console.error('Usage: npm run diagnose -- <logfile>  (or pipe a log to stdin)');
    process.exit(2);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const { model, label } = modelFromEnv();
const index = buildIndex(fileURLToPath(new URL('../docs-corpus', import.meta.url)));

console.error(`provider: ${label}`);
const result = await diagnose(await readInput(), { model, index });
console.log(JSON.stringify(result, null, 2));
process.exit(result.abstained && result.cause === 'provider_error' ? 1 : 0);
