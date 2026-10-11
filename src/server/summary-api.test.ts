import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderInfo, ProviderName } from '../llm/registry.js';
import { ScriptedModel } from '../llm/scripted.js';
import { createSmartServer, type Providers } from './app.js';

const OUTPUT = 'PS D:\\app> npm test\nError: expected 200 but received 500\nPS D:\\app> ';
const ANSWER = {
  overview: 'A test failed.',
  commands: ['npm test'],
  problems: [{ description: 'Test failed', evidence: 'Error: expected 200 but received 500' }],
  state: 'idle',
};

let server: http.Server;
let base: string;
const models = new Map<ProviderName, ScriptedModel>();

async function start() {
  models.clear();
  const infos: ProviderInfo[] = [
    { name: 'ollama', label: 'Ollama (test)', privacy: 'local', available: true },
    { name: 'gemini', label: 'Gemini (test)', privacy: 'cloud', available: true },
    { name: 'anthropic', label: 'Anthropic (test)', privacy: 'cloud', available: false },
  ];
  const providers: Providers = {
    defaultProvider: () => 'ollama',
    list: () => infos,
    info: (name) => infos.find((i) => i.name === name)!,
    get: (name) => {
      if (!infos.find((i) => i.name === name)!.available) return undefined;
      if (!models.has(name)) models.set(name, new ScriptedModel([ANSWER]));
      return models.get(name);
    },
  };
  server = createSmartServer({ providers, allowedOrigins: ['http://localhost:5555'] });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

const post = (body: unknown) =>
  fetch(`${base}/api/summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/summary', () => {
  it('returns a grounded summary from the local provider by default', async () => {
    await start();
    const res = await post({ output: OUTPUT });
    const body = (await res.json()) as {
      provider: ProviderInfo;
      result: { ok: boolean; summary: { commands: string[]; problems: unknown[] } };
    };

    expect(res.status).toBe(200);
    expect(body.provider.privacy).toBe('local');
    expect(body.result.summary.commands).toEqual(['npm test']);
    expect(body.result.summary.problems).toHaveLength(1);
  });

  it('applies the cloud-consent rule', async () => {
    await start();
    const refused = await post({ output: OUTPUT, provider: 'gemini' });
    expect(refused.status).toBe(400);
    expect(models.get('gemini')?.requests ?? []).toHaveLength(0);

    expect((await post({ output: OUTPUT, provider: 'gemini', confirmCloud: true })).status).toBe(
      200,
    );
  });

  it('validates the body', async () => {
    await start();
    expect((await post({ output: '' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});
