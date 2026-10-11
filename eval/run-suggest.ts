import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProviderRegistry } from '../src/llm/registry.js';
import { suggestCommands, type Suggestion } from '../src/suggest/suggest.js';

interface Case {
  id: string;
  instruction: string;
  /** Regex (as text): at least one suggested command should match it. */
  accept: string;
  /** For destructive requests: a matching command must carry the `dangerous` label. */
  mustBeDangerous: boolean;
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Usage: LLM_PROVIDER=ollama OLLAMA_MODEL=llama3.2 npm run eval:suggest
const registry = new ProviderRegistry();
const providerName = registry.defaultProvider();
const model = registry.get(providerName);
if (!model) throw new Error(`Provider "${providerName}" is not configured`);
const label = `${providerName}:${registry.info(providerName).label.replace(/^.*\(|\)$/g, '')}`;

const cases: Case[] = readFileSync(here('./suggest.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Case)
  .filter((c) => !process.env.EVAL_IDS || process.env.EVAL_IDS.split(',').includes(c.id));

interface Row {
  id: string;
  instruction: string;
  commands: Array<Pick<Suggestion, 'command' | 'risk'>>;
  accepted: boolean;
  labelledDangerous: boolean | null;
  failure: string | null;
  droppedCommands: number;
  ms: number;
}

const rows: Row[] = [];
for (const c of cases) {
  const started = performance.now();
  const result = await suggestCommands(c.instruction, {
    model,
    shell: 'powershell',
    timeoutMs: 120_000,
    maxAttempts: 3,
    backoffMs: 5000,
  });
  const ms = Math.round(performance.now() - started);
  const accept = new RegExp(c.accept, 'i');

  const commands = result.ok ? result.suggestions : [];
  const matching = commands.filter((s) => accept.test(s.command));
  const row: Row = {
    id: c.id,
    instruction: c.instruction,
    commands: commands.map(({ command, risk }) => ({ command, risk })),
    accepted: matching.length > 0,
    labelledDangerous: c.mustBeDangerous ? matching.some((s) => s.risk === 'dangerous') : null,
    failure: result.ok ? null : result.reason,
    droppedCommands: result.ok ? result.droppedCommands : 0,
    ms,
  };
  rows.push(row);
  console.error(
    `${c.id} accepted=${row.accepted} dangerousLabel=${row.labelledDangerous} ${ms}ms ${row.failure ?? ''}`,
  );
}

const needDanger = rows.filter((r) => r.labelledDangerous !== null);
const summary = {
  provider: label,
  date: new Date().toISOString().slice(0, 10),
  cases: rows.length,
  acceptedCommands: rows.filter((r) => r.accepted).length,
  failures: rows.filter((r) => r.failure !== null).length,
  destructiveRequests: needDanger.length,
  destructiveLabelledDangerous: needDanger.filter((r) => r.labelledDangerous).length,
  droppedCommands: rows.reduce((a, r) => a + r.droppedCommands, 0),
  meanLatencyMs: Math.round(rows.reduce((a, r) => a + r.ms, 0) / Math.max(rows.length, 1)),
};

mkdirSync(here('./results'), { recursive: true });
const suffix = process.env.EVAL_IDS ? '-subset' : '';
const file = here(
  `./results/suggest-${label.replace(/[^a-z0-9.-]+/gi, '_')}-${summary.date}${suffix}.json`,
);
writeFileSync(file, JSON.stringify({ summary, rows }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
console.log(`wrote ${file}`);
