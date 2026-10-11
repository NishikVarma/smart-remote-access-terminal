import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { RequestHandler } from 'express';
import WebSocket, { WebSocketServer } from 'ws';

// Headers that describe one network hop and must not be forwarded.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

export const ENGINE_PREFIX = '/engine';

/**
 * Plain pass-through to the remote-terminal-access engine: same-origin for the browser (no CORS),
 * no credentials of its own. The browser's cookie and Origin are forwarded as they are, so the
 * engine does all authentication and authorization.
 */
export function engineHttpProxy(engineUrl: string): RequestHandler {
  const base = new URL(engineUrl);

  return async (req, res) => {
    const target = new URL(req.originalUrl.slice(ENGINE_PREFIX.length) || '/', base);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(name)) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }

    try {
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: hasBody ? (req as unknown as ReadableStream) : undefined,
        // @ts-expect-error `duplex` is required by Node's fetch for streamed request bodies.
        duplex: 'half',
        redirect: 'manual',
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        // fetch has already decoded the body, so these two no longer describe it.
        if (HOP_BY_HOP.has(name) || name === 'content-encoding' || name === 'content-length')
          return;
        if (name !== 'set-cookie') res.setHeader(name, value);
      });
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length > 0) res.setHeader('set-cookie', cookies);

      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.status(502).json({ error: 'engine_unreachable' });
    }
  };
}

function reject(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\n\r\n`);
}

/**
 * Proxies WebSocket upgrades on /engine/... to the engine. The upstream connection is opened
 * first, so the engine's own refusal (401, 403, 404) reaches the browser unchanged.
 */
export function attachEngineWebSocketProxy(
  server: Server,
  engineUrl: string,
  isAllowed: (req: IncomingMessage) => boolean,
): void {
  const base = new URL(engineUrl);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith(`${ENGINE_PREFIX}/`)) return; // not ours: other handlers may take it
    if (!isAllowed(req)) return reject(socket, '403 Forbidden');

    const target = new URL(req.url.slice(ENGINE_PREFIX.length), base);
    target.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';

    const upstream = new WebSocket(target, {
      headers: {
        ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
        ...(req.headers.origin ? { origin: req.headers.origin } : {}),
      },
    });

    upstream.once('unexpected-response', (_req, response) => {
      reject(socket, `${response.statusCode ?? 502} ${response.statusMessage ?? 'Bad Gateway'}`);
      upstream.terminate();
    });
    upstream.once('error', () => {
      if (!socket.destroyed && !socket.writableEnded) reject(socket, '502 Bad Gateway');
    });

    upstream.once('open', () => {
      wss.handleUpgrade(req, socket, head, (client) => {
        client.on('message', (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        });
        upstream.on('message', (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });

        // Close codes (for example the engine's 4001 "revoked") are passed through.
        const closeBoth = (code: number, reason: Buffer) => {
          const safe = code === 1005 || code === 1006 || code > 4999 ? 1000 : code;
          for (const peer of [client, upstream]) {
            if (peer.readyState === WebSocket.OPEN || peer.readyState === WebSocket.CONNECTING) {
              peer.close(safe, reason);
            }
          }
        };
        client.on('close', closeBoth);
        upstream.on('close', closeBoth);
        client.on('error', () => upstream.terminate());
        upstream.on('error', () => client.terminate());
      });
    });
  });
}
