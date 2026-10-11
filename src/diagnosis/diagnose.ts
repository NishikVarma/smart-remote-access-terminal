import type { Bm25Index, Chunk } from '../retrieval/bm25.js';
import { callStructured } from '../llm/call.js';
import type { StructuredModel } from '../llm/provider.js';
import { classifyCommand, normalizeCommand } from './command-risk.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { redact } from './redact.js';
import { ModelDiagnosisSchema, type Diagnosis, type DiagnosisResult } from './schema.js';

export interface DiagnoseOptions {
  model: StructuredModel;
  /** Optional documentation index; matching chunks are passed to the model as references. */
  index?: Bm25Index;
  maxInputChars?: number;
  topK?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

const ERRORISH =
  /error|fail|exception|denied|refused|not found|cannot|fatal|timeout|unable|invalid/i;
const MIN_QUOTE_CHARS = 8;
const MAX_CHUNK_CHARS = 1500;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

function retrievalQuery(log: string): string {
  const lines = log.split(/\r?\n/).filter((l) => ERRORISH.test(l));
  return (lines.length > 0 ? lines.slice(-10) : log.split(/\r?\n/).slice(-10)).join('\n');
}

/**
 * Log text in, validated and grounded diagnosis (or an explicit abstention) out.
 * Never throws for provider problems: they become an abstention with a cause.
 */
export async function diagnose(rawLog: string, options: DiagnoseOptions): Promise<DiagnosisResult> {
  const {
    model,
    index,
    maxInputChars = 20_000,
    topK = 3,
    maxAttempts = 2,
    timeoutMs = 60_000,
    backoffMs = 500,
  } = options;

  if (rawLog.trim() === '') {
    return { abstained: true, cause: 'empty_input', reason: 'The input is empty.' };
  }

  // Errors are usually at the end of a log, so the tail is kept.
  const truncatedInput = rawLog.length > maxInputChars;
  const { text: log, count: redactions } = redact(
    truncatedInput ? rawLog.slice(-maxInputChars) : rawLog,
  );

  const docs: Chunk[] = (index?.search(retrievalQuery(log), topK) ?? []).map((hit) => ({
    ...hit.chunk,
    text: hit.chunk.text.slice(0, MAX_CHUNK_CHARS),
  }));
  const knownSources = new Set(docs.map((d) => d.id));
  const user = buildUserMessage(log, docs);

  const called = await callStructured({
    model,
    system: SYSTEM_PROMPT,
    user,
    schema: ModelDiagnosisSchema,
    maxAttempts,
    timeoutMs,
    backoffMs,
  });
  if (!called.ok) {
    return {
      abstained: true,
      cause: called.cause,
      reason: `Could not obtain a diagnosis: ${called.reason}.`,
    };
  }
  return ground(called.value, { log, knownSources, truncatedInput, redactions });
}

interface GroundingContext {
  log: string;
  knownSources: Set<string>;
  truncatedInput: boolean;
  redactions: number;
}

/** Keeps only claims that can be verified against the log and the retrieved documents. */
function ground(
  output: ReturnType<typeof ModelDiagnosisSchema.parse>,
  ctx: GroundingContext,
): DiagnosisResult {
  if (output.abstain) {
    return {
      abstained: true,
      cause: 'insufficient_evidence',
      reason: output.abstain_reason ?? 'The log does not contain enough information.',
    };
  }

  const haystack = squash(ctx.log);
  let dropped = 0;
  const likelyCauses: Diagnosis['likelyCauses'] = [];

  for (const c of output.likely_causes.slice(0, 5)) {
    const evidence = c.evidence.filter((quote) => {
      const q = squash(quote);
      return q.length >= MIN_QUOTE_CHARS && haystack.includes(q);
    });
    dropped += c.evidence.length - evidence.length;
    const sources = c.sources.filter((id) => ctx.knownSources.has(id));
    dropped += c.sources.length - sources.length;

    if (evidence.length === 0) {
      dropped++; // a cause with no verifiable evidence is not reported
      continue;
    }
    likelyCauses.push({ cause: c.cause, confidence: c.confidence, evidence, sources });
  }

  if (likelyCauses.length === 0) {
    return {
      abstained: true,
      cause: 'ungrounded',
      reason: 'None of the proposed causes could be tied to quotes from the log.',
    };
  }

  return {
    abstained: false,
    diagnosis: {
      summary: output.summary.slice(0, 500),
      category: output.category,
      likelyCauses,
      suggestedSteps: output.suggested_steps.slice(0, 6).map((s) => ({
        description: s.description,
        command: normalizeCommand(s.command),
        risk: classifyCommand(s.command),
      })),
      droppedClaims: dropped,
      truncatedInput: ctx.truncatedInput,
      redactions: ctx.redactions,
    },
  };
}
