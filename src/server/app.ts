import { createServer, type Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { diagnose } from '../diagnosis/diagnose.js';
import type { StructuredModel } from '../llm/provider.js';
import type { ProviderInfo, ProviderName } from '../llm/registry.js';
import type { Bm25Index } from '../retrieval/bm25.js';
import { SHELLS, suggestCommands } from '../suggest/suggest.js';
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
  /** Folder with the built web app (web/dist); served without login, it only holds the pairing form. */
  webDir?: string;
  log?: (line: string) => void;
}

const providerFields = {
  provider: z.enum(['ollama', 'gemini', 'anthropic']).optional(),
  /** Must be true to use a provider that sends the text to a third party. */
  confirmCloud: z.boolean().optional(),
};

const diagnoseBody = z.object({ log: z.string().min(1).max(200_000), ...providerFields });

const suggestBody = z.object({
  instruction: z.string().min(1).max(2_000),
  shell: z.enum(SHELLS).optional(),
  /** Recent terminal output, sent only when the user chose to include it. */
  context: z.string().max(50_000).optional(),
  ...providerFields,
});

export function createSmartServer({
  providers,
  index,
  allowedOrigins,
  allowedHosts = [],
  engineUrl,
  webDir,
  log = () => {},
}: AppDeps): Server {
  const isAllowed = makeGuard({ allowedOrigins, allowedHosts });

  // Picks the provider and enforces the consent rule: text only goes to a third party when the
  // request says the user confirmed it. Sends the error response itself when it cannot proceed.
  function choose(
    body: { provider?: ProviderName; confirmCloud?: boolean },
    res: Response,
  ): { model: StructuredModel; info: ProviderInfo; name: ProviderName } | undefined {
    const name = body.provider ?? providers.defaultProvider();
    const info = providers.info(name);
    const model = providers.get(name);
    if (!model) {
      res.status(503).json({ error: 'provider_not_configured', provider: info });
      return undefined;
    }
    if (info.privacy === 'cloud' && body.confirmCloud !== true) {
      res.status(400).json({ error: 'cloud_confirmation_required', provider: info });
      return undefined;
    }
    return { model, info, name };
  }

  const timeoutFor = (info: ProviderInfo) => (info.privacy === 'local' ? 120_000 : 60_000);

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => (isAllowed(req) ? next() : void res.sendStatus(403)));
  // The proxy streams request bodies, so it must come before any body parser.
  if (engineUrl) app.use(ENGINE_PREFIX, engineHttpProxy(engineUrl));
  if (webDir) app.use(express.static(webDir));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/providers', (_req, res) => {
    res.json({ default: providers.defaultProvider(), providers: providers.list() });
  });

  app.post('/api/diagnose', async (req, res) => {
    const body = diagnoseBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'invalid_request' });
    const chosen = choose(body.data, res);
    if (!chosen) return;

    const started = Date.now();
    const result = await diagnose(body.data.log, {
      model: chosen.model,
      index,
      timeoutMs: timeoutFor(chosen.info),
    });
    // Metadata only: never the log text, never keys.
    log(
      `diagnose provider=${chosen.name} privacy=${chosen.info.privacy} chars=${body.data.log.length} ` +
        `outcome=${result.abstained ? `abstained:${result.cause}` : 'ok'} ms=${Date.now() - started}`,
    );
    res.json({ provider: chosen.info, result });
  });

  app.post('/api/suggest', async (req, res) => {
    const body = suggestBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'invalid_request' });
    const chosen = choose(body.data, res);
    if (!chosen) return;

    const started = Date.now();
    const result = await suggestCommands(body.data.instruction, {
      model: chosen.model,
      shell: body.data.shell,
      context: body.data.context,
      timeoutMs: timeoutFor(chosen.info),
    });
    log(
      `suggest provider=${chosen.name} privacy=${chosen.info.privacy} ` +
        `chars=${body.data.instruction.length} context=${body.data.context?.length ?? 0} ` +
        `outcome=${result.ok ? `ok:${result.suggestions.length}` : result.cause} ` +
        `ms=${Date.now() - started}`,
    );
    res.json({ provider: chosen.info, result });
  });

  // Last in the chain: bad JSON and other errors get a status code, never a stack trace.
  app.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.sendStatus(err.status ?? 500);
  });

  const server = createServer(app);
  if (engineUrl) attachEngineWebSocketProxy(server, engineUrl, isAllowed);
  return server;
}
