import { createServer, type Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { diagnose } from '../diagnosis/diagnose.js';
import type { ProviderInfo, ProviderName } from '../llm/registry.js';
import type { StructuredModel } from '../llm/provider.js';
import type { Bm25Index } from '../retrieval/bm25.js';
import { attachEngineWebSocketProxy, ENGINE_PREFIX, engineHttpProxy } from './engine-proxy.js';
import { makeGuard } from './guard.js';

/** What the HTTP layer needs from the provider registry (ProviderRegistry implements it). */
export interface Providers {
  defaultProvider(): ProviderName;
  list(): ProviderInfo[];
  info(name: ProviderName): ProviderInfo;
  get(name: ProviderName): StructuredModel | undefined;
}

export interface AppDeps {
  providers: Providers;
  index?: Bm25Index;
  /** Browser origins allowed to call the API (the app's own origin at minimum). */
  allowedOrigins: string[];
  /** Hostnames (no port) accepted in the Host header, in addition to loopback names. */
  allowedHosts?: string[];
  /** Base URL of the remote-terminal-access engine; enables the /engine proxy when set. */
  engineUrl?: string;
  log?: (line: string) => void;
}

const diagnoseBody = z.object({
  log: z.string().min(1).max(200_000),
  provider: z.enum(['ollama', 'gemini', 'anthropic']).optional(),
  /** Must be true to use a provider that sends the text to a third party. */
  confirmCloud: z.boolean().optional(),
});

export function createSmartServer({
  providers,
  index,
  allowedOrigins,
  allowedHosts = [],
  engineUrl,
  log = () => {},
}: AppDeps): Server {
  const isAllowed = makeGuard({ allowedOrigins, allowedHosts });

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => (isAllowed(req) ? next() : void res.sendStatus(403)));
  // The proxy streams request bodies, so it must come before any body parser.
  if (engineUrl) app.use(ENGINE_PREFIX, engineHttpProxy(engineUrl));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/providers', (_req, res) => {
    res.json({ default: providers.defaultProvider(), providers: providers.list() });
  });

  app.post('/api/diagnose', async (req, res) => {
    const body = diagnoseBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'invalid_request' });

    const name = body.data.provider ?? providers.defaultProvider();
    const info = providers.info(name);
    const model = providers.get(name);
    if (!model) {
      return void res.status(503).json({ error: 'provider_not_configured', provider: info });
    }
    if (info.privacy === 'cloud' && body.data.confirmCloud !== true) {
      return void res.status(400).json({ error: 'cloud_confirmation_required', provider: info });
    }

    const started = Date.now();
    const result = await diagnose(body.data.log, {
      model,
      index,
      timeoutMs: info.privacy === 'local' ? 120_000 : 60_000,
    });
    // Metadata only: never the log text, never keys.
    log(
      `diagnose provider=${name} privacy=${info.privacy} chars=${body.data.log.length} ` +
        `outcome=${result.abstained ? `abstained:${result.cause}` : 'ok'} ms=${Date.now() - started}`,
    );
    res.json({ provider: info, result });
  });

  // Last in the chain: bad JSON and other errors get a status code, never a stack trace.
  app.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.sendStatus(err.status ?? 500);
  });

  const server = createServer(app);
  if (engineUrl) attachEngineWebSocketProxy(server, engineUrl, isAllowed);
  return server;
}
