import type { DiagnosisResult } from '../../src/diagnosis/schema.js';
import type { Shell, SuggestResult } from '../../src/suggest/suggest.js';
import type { SummaryResult } from '../../src/summary/summarize.js';
import type { ProviderView } from './lib.js';

export interface ProviderInfo extends ProviderView {
  available: boolean;
}

export interface DiagnoseResponse {
  provider: ProviderInfo;
  result: DiagnosisResult;
}

export interface SuggestResponse {
  provider: ProviderInfo;
  result: SuggestResult;
}

export interface SummaryResponse {
  provider: ProviderInfo;
  result: SummaryResult;
}

export class NotPaired extends Error {}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Same-origin calls to the smart server; the engine is reached through /engine. */
export async function getProviders(): Promise<{ default: string; providers: ProviderInfo[] }> {
  const res = await fetch('/api/providers');
  if (!res.ok) throw new Error(`providers: HTTP ${res.status}`);
  return res.json();
}

export function diagnose(
  log: string,
  provider: string,
  confirmCloud: boolean,
): Promise<DiagnoseResponse> {
  return postJson('/api/diagnose', { log, provider, confirmCloud });
}

export function suggest(
  instruction: string,
  options: { provider: string; confirmCloud: boolean; shell: Shell; context?: string },
): Promise<SuggestResponse> {
  return postJson('/api/suggest', { instruction, ...options });
}

export function summarize(
  output: string,
  options: { provider: string; confirmCloud: boolean },
): Promise<SummaryResponse> {
  return postJson('/api/summary', { output, ...options });
}

export async function engine(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/engine${path}`, init);
  if (res.status === 401) throw new NotPaired();
  return res;
}
