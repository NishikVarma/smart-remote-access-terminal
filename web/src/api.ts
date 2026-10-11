import type { DiagnosisResult } from '../../src/diagnosis/schema.js';
import type { ProviderView } from './lib.js';

export interface ProviderInfo extends ProviderView {
  available: boolean;
}

export interface DiagnoseResponse {
  provider: ProviderInfo;
  result: DiagnosisResult;
}

export class NotPaired extends Error {}

/** Same-origin calls to the smart server; the engine is reached through /engine. */
export async function getProviders(): Promise<{ default: string; providers: ProviderInfo[] }> {
  const res = await fetch('/api/providers');
  if (!res.ok) throw new Error(`providers: HTTP ${res.status}`);
  return res.json();
}

export async function diagnose(
  log: string,
  provider: string,
  confirmCloud: boolean,
): Promise<DiagnoseResponse> {
  const res = await fetch('/api/diagnose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ log, provider, confirmCloud }),
  });
  if (!res.ok) throw new Error(`diagnose: HTTP ${res.status}`);
  return res.json();
}

export async function engine(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/engine${path}`, init);
  if (res.status === 401) throw new NotPaired();
  return res;
}
