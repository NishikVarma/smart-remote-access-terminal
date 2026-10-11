import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedModel } from '../llm/scripted.js';
import type { ProviderInfo, ProviderName } from '../llm/registry.js';
import type { ModelDiagnosis } from '../diagnosis/schema.js';
import { createSmartServer, type Providers } from './app.js';

const LOG = "npm ERR! Error: EACCES: permission denied, mkdir '/usr/lib/node_modules/foo'";

const answer: ModelDiagnosis = {
  summary: 'Permission problem.',
  category: 'permission',
  likely_causes: [
    {
      cause: 'Folder owned by another user',
      confidence: 'high',
      evidence: ["EACCES: permission denied, mkdir '/usr/lib/node_modules/foo'"],
      sources: [],
    },
  ],
  suggested_steps: [],
  abstain: false,
  abstain_reason: null,
};

function fakeProviders(configured: ProviderName[]) {
  const models = new Map<ProviderName, ScriptedModel>();
  const infos: ProviderInfo[] = [
    { name: 'ollama', label: 'Ollama (test)', privacy: 'local', available: true },
    { name: 'gemini', label: 'Gemini (test)', privacy: 'cloud', available: true },
    { name: 'anthropic', label: 'Anthropic (test)', privacy: 'cloud', available: false },
  ];
  for (const info of infos) info.available = info.available && configured.includes(info.name);
  const providers: Providers = {
    defaultProvider: () => 'ollama',
    list: () => infos,
    info: (name) => infos.find((i) => i.name === name)!,
    get: (name) => {
      if (!infos.find((i) => i.name === name)!.available) return undefined;
      if (!models.has(name)) models.set(name, new ScriptedModel([answer]));
      return models.get(name);
    },
  };
  return { providers, models };
}

let server: http.Server;
let base: string;

async function start(configured: ProviderName[] = ['ollama', 'gemini']) {
  const fake = fakeProviders(configured);
  server = createSmartServer({
    providers: fake.providers,
    allowedOrigins: ['http://localhost:5555'],
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/diagnose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('request guard', () => {
  it('rejects a foreign Origin and a foreign Host', async () => {
    await start();
    expect((await post({ log: LOG }, { origin: 'http://evil.example' })).status).toBe(403);

    const status = await new Promise((resolve) =>
      http
        .get(`${base}/api/providers`, { headers: { host: 'evil.example' } }, (res) =>
          resolve(res.statusCode),
        )
        .on('error', () => resolve(undefined)),
    );
    expect(status).toBe(403);
  });

  it('accepts a configured Origin', async () => {
    await start();
    expect((await post({ log: LOG }, { origin: 'http://localhost:5555' })).status).toBe(200);
  });
});

describe('GET /api/providers', () => {
  it('lists providers with their privacy class and availability', async () => {
    await start(['ollama']);
    const body = (await (await fetch(`${base}/api/providers`)).json()) as {
      default: string;
      providers: ProviderInfo[];
    };
    expect(body.default).toBe('ollama');
    expect(body.providers.map((p) => [p.name, p.privacy, p.available])).toEqual([
      ['ollama', 'local', true],
      ['gemini', 'cloud', false],
      ['anthropic', 'cloud', false],
    ]);
  });
});

describe('POST /api/diagnose', () => {
  it('uses the local provider by default and returns a grounded diagnosis', async () => {
    const { models } = await start();
    const res = await post({ log: LOG });
    const body = (await res.json()) as {
      provider: ProviderInfo;
      result: { abstained: boolean; diagnosis?: { category: string } };
    };
    expect(res.status).toBe(200);
    expect(body.provider.name).toBe('ollama');
    expect(body.result.diagnosis?.category).toBe('permission');
    expect(models.get('ollama')!.requests).toHaveLength(1);
  });

  it('refuses a cloud provider without explicit confirmation and does not call it', async () => {
    const { models } = await start();
    const res = await post({ log: LOG, provider: 'gemini' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'cloud_confirmation_required',
      provider: { name: 'gemini', privacy: 'cloud' },
    });
    expect(models.get('gemini')?.requests ?? []).toHaveLength(0); // never called
  });

  it('calls the cloud provider once the user has confirmed', async () => {
    const { models } = await start();
    const res = await post({ log: LOG, provider: 'gemini', confirmCloud: true });
    expect(res.status).toBe(200);
    expect(models.get('gemini')!.requests).toHaveLength(1);
  });

  it('answers 503 for a provider that is not configured', async () => {
    await start(['ollama']);
    const res = await post({ log: LOG, provider: 'gemini', confirmCloud: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'provider_not_configured' });
  });

  it('rejects invalid bodies and bad JSON without a stack trace', async () => {
    await start();
    expect((await post({ log: '' })).status).toBe(400);
    expect((await post({ provider: 'nope', log: 'x' })).status).toBe(400);
    const bad = await post('{bad');
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toMatch(/SyntaxError|node_modules/);
  });
});
