import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { ScriptedModel } from '../llm/scripted.js';
import type { ProviderInfo } from '../llm/registry.js';
import { createSmartServer, type Providers } from './app.js';

const ORIGIN = 'http://localhost:5555';

interface Seen {
  path: string;
  host?: string;
  origin?: string;
  cookie?: string;
  body?: string;
}

/** Minimal stand-in for remote-terminal-access: pair -> cookie, cookie-protected routes, echo WS. */
function startFakeEngine() {
  const seen: Seen[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    seen.push({
      path: req.path,
      host: req.headers.host,
      origin: req.headers.origin,
      cookie: req.headers.cookie,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
    });
    next();
  });
  app.post('/pair', (_req, res) => {
    res.cookie('rta_device', 'tok123', { httpOnly: true, sameSite: 'strict' });
    res.status(201).json({ deviceId: 'dev1' });
  });
  app.get('/sessions/:id', (req, res) => {
    if (req.headers.cookie?.includes('rta_device=tok123'))
      return void res.json({ id: req.params.id });
    res.sendStatus(401);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!req.headers.cookie?.includes('rta_device=tok123')) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data, isBinary) => {
        if (data.toString() === 'revoke') ws.close(4001, 'revoked');
        else ws.send(data, { binary: isBinary });
      });
    });
  });
  return new Promise<{ server: http.Server; url: string; seen: Seen[] }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        seen,
      }),
    ),
  );
}

const providers: Providers = {
  defaultProvider: () => 'ollama',
  list: () => [],
  info: () => ({ name: 'ollama', label: 'x', privacy: 'local', available: true }) as ProviderInfo,
  get: () => new ScriptedModel([null]),
};

const open: http.Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function setup(engineUrl?: string) {
  const engine = await startFakeEngine();
  open.push(engine.server);
  const smart = createSmartServer({
    providers,
    allowedOrigins: [ORIGIN],
    engineUrl: engineUrl ?? engine.url,
  });
  await new Promise<void>((r) => smart.listen(0, '127.0.0.1', r));
  open.push(smart);
  const base = `127.0.0.1:${(smart.address() as AddressInfo).port}`;
  return { engine, base };
}

const wsOutcome = (url: string, headers: Record<string, string>) =>
  new Promise<{ status?: number; ws?: WebSocket }>((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolve({ ws }));
    ws.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
    ws.once('error', () => {});
  });

describe('engine HTTP proxy', () => {
  it('forwards method, body, cookie and Origin, and returns Set-Cookie to the browser', async () => {
    const { engine, base } = await setup();

    const pair = await fetch(`http://${base}/engine/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ code: '12345678', name: 'phone' }),
    });
    expect(pair.status).toBe(201);
    expect(await pair.json()).toEqual({ deviceId: 'dev1' });
    const setCookie = pair.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/rta_device=tok123/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const first = engine.seen[0]!;
    expect(first.path).toBe('/pair');
    expect(first.origin).toBe(ORIGIN);
    expect(first.host).toBe(new URL(engine.url).host); // rewritten to the engine's own host
    expect(JSON.parse(first.body!)).toEqual({ code: '12345678', name: 'phone' });
  });

  it('passes the engine status through (401 without cookie, 200 with)', async () => {
    const { base } = await setup();
    const denied = await fetch(`http://${base}/engine/sessions/abc`);
    expect(denied.status).toBe(401);

    const allowed = await fetch(`http://${base}/engine/sessions/abc`, {
      headers: { cookie: 'rta_device=tok123' },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ id: 'abc' });
  });

  it('answers 502 when the engine is unreachable', async () => {
    const { base } = await setup('http://127.0.0.1:1');
    const res = await fetch(`http://${base}/engine/sessions/abc`);
    expect(res.status).toBe(502);
  });

  it('rejects foreign Origins before anything reaches the engine', async () => {
    const { engine, base } = await setup();
    const res = await fetch(`http://${base}/engine/sessions/abc`, {
      headers: { origin: 'http://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(engine.seen).toHaveLength(0);
  });
});

describe('engine WebSocket proxy', () => {
  it('relays messages both ways when the cookie is valid', async () => {
    const { base } = await setup();
    const { ws } = await wsOutcome(`ws://${base}/engine/ws/s1`, {
      origin: ORIGIN,
      cookie: 'rta_device=tok123',
    });
    expect(ws).toBeDefined();

    const echoed = new Promise<string>((resolve) =>
      ws!.once('message', (d) => resolve(d.toString())),
    );
    ws!.send('hello engine');
    expect(await echoed).toBe('hello engine');
    ws!.close();
  });

  it('passes the engine refusal (401) through unchanged', async () => {
    const { base } = await setup();
    const { status } = await wsOutcome(`ws://${base}/engine/ws/s1`, { origin: ORIGIN });
    expect(status).toBe(401);
  });

  it('propagates the engine close code (4001 revoked)', async () => {
    const { base } = await setup();
    const { ws } = await wsOutcome(`ws://${base}/engine/ws/s1`, {
      origin: ORIGIN,
      cookie: 'rta_device=tok123',
    });
    const code = new Promise<number>((resolve) => ws!.once('close', (c) => resolve(c)));
    ws!.send('revoke');
    expect(await code).toBe(4001);
  });

  it('refuses a foreign Origin on the upgrade', async () => {
    const { engine, base } = await setup();
    const { status } = await wsOutcome(`ws://${base}/engine/ws/s1`, {
      origin: 'http://evil.example',
      cookie: 'rta_device=tok123',
    });
    expect(status).toBe(403);
    expect(engine.seen).toHaveLength(0);
  });
});
