import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderInfo, ProviderName } from '../llm/registry.js';
import { ScriptedModel } from '../llm/scripted.js';
import { createSmartServer, type Providers } from './app.js';

const SUGGESTION = {
  commands: [
    { command: 'Get-Process', explanation: 'Lists processes.' },
    { command: 'Remove-Item C:\\x -Recurse', explanation: 'Deletes the folder.' },
  ],
  clarification: null,
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
      if (!models.has(name)) models.set(name, new ScriptedModel([SUGGESTION]));
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
  fetch(`${base}/api/suggest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/suggest', () => {
  it('returns candidates with code-computed risk and names the provider that handled it', async () => {
    await start();
    const res = await post({ instruction: 'list processes' });
    const body = (await res.json()) as {
      provider: ProviderInfo;
      result: { ok: boolean; suggestions: Array<{ command: string; risk: string }> };
    };

    expect(res.status).toBe(200);
    expect(body.provider).toMatchObject({ name: 'ollama', privacy: 'local' });
    expect(body.result.suggestions.map((s) => [s.command, s.risk])).toEqual([
      ['Get-Process', 'review'],
      ['Remove-Item C:\\x -Recurse', 'dangerous'],
    ]);
  });

  it('applies the same cloud-consent rule as /api/diagnose', async () => {
    await start();

    const refused = await post({ instruction: 'list files', provider: 'gemini' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: 'cloud_confirmation_required' });
    expect(models.get('gemini')?.requests ?? []).toHaveLength(0);

    const allowed = await post({
      instruction: 'list files',
      provider: 'gemini',
      confirmCloud: true,
    });
    expect(allowed.status).toBe(200);
    expect(models.get('gemini')!.requests).toHaveLength(1);
  });

  it('answers 503 for a provider that is not configured', async () => {
    await start();
    const res = await post({ instruction: 'x', provider: 'anthropic', confirmCloud: true });
    expect(res.status).toBe(503);
  });

  it('validates the body', async () => {
    await start();
    expect((await post({ instruction: '' })).status).toBe(400);
    expect((await post({ instruction: 'x', shell: 'zsh' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});
