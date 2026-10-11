import { z } from 'zod';

export const CATEGORIES = [
  'dependency',
  'permission',
  'network',
  'configuration',
  'resource',
  'syntax',
  'runtime',
  'unknown',
] as const;

/**
 * What the model is asked to produce. Kept free of min/max constraints because structured-output
 * schemas support only a subset of JSON Schema; size limits are enforced in code (see diagnose.ts).
 */
export const ModelDiagnosisSchema = z.object({
  summary: z.string(),
  category: z.enum(CATEGORIES),
  likely_causes: z.array(
    z.object({
      cause: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
      /** Exact quotes copied from the log that support this cause. */
      evidence: z.array(z.string()),
      /** Ids of reference documents that support this cause (may be empty). */
      sources: z.array(z.string()),
    }),
  ),
  suggested_steps: z.array(
    z.object({
      description: z.string(),
      /** A command the user could run. Never executed by this project. */
      command: z.string().nullable(),
    }),
  ),
  /** True when the log does not contain enough information to diagnose. */
  abstain: z.boolean(),
  abstain_reason: z.string().nullable(),
});
export type ModelDiagnosis = z.infer<typeof ModelDiagnosisSchema>;

export type CommandRisk = 'review' | 'dangerous';

/** The validated, annotated result handed to callers. */
export interface Diagnosis {
  summary: string;
  category: (typeof CATEGORIES)[number];
  likelyCauses: Array<{
    cause: string;
    confidence: 'low' | 'medium' | 'high';
    evidence: string[];
    sources: string[];
  }>;
  suggestedSteps: Array<{ description: string; command: string | null; risk: CommandRisk | null }>;
  /** Evidence quotes or source ids the model produced that could not be verified and were dropped. */
  droppedClaims: number;
  truncatedInput: boolean;
  redactions: number;
}

/**
 * insufficient_evidence: the model itself said the log is not enough.
 * ungrounded: the model answered, but no claim could be tied to the log.
 */
export type AbstainCause =
  'empty_input' | 'insufficient_evidence' | 'ungrounded' | 'provider_error' | 'invalid_output';

export type DiagnosisResult =
  | { abstained: false; diagnosis: Diagnosis }
  | { abstained: true; cause: AbstainCause; reason: string };
