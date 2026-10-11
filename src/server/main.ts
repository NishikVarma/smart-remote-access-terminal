import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProviderRegistry } from '../llm/registry.js';
import { buildIndex } from '../retrieval/corpus.js';
import { createSmartServer } from './app.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8788);

// There is no authentication here, so refuse to listen beyond loopback unless explicitly allowed.
if (!LOOPBACK.has(host) && process.env.ALLOW_INSECURE_BIND !== 'true') {
  console.error(`HOST ${host} is not loopback; set ALLOW_INSECURE_BIND=true to accept the risk.`);
  process.exit(1);
}

const extraOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (extraOrigins.includes('*')) {
  console.error('ALLOWED_ORIGINS must not contain "*".');
  process.exit(1);
}

const builtWeb = fileURLToPath(new URL('../../web/dist', import.meta.url));
const webDir = existsSync(builtWeb) ? builtWeb : undefined;

const providers = new ProviderRegistry();
const server = createSmartServer({
  providers,
  index: buildIndex(fileURLToPath(new URL('../../docs-corpus', import.meta.url))),
  allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extraOrigins],
  engineUrl: process.env.ENGINE_URL ?? 'http://127.0.0.1:8787',
  webDir,
  log: (line) => console.log(line),
});

server.listen(port, host, () => {
  const names = providers
    .list()
    .filter((p) => p.available)
    .map((p) => `${p.name}(${p.privacy})`);
  console.log(`smart server on http://${host}:${port}; providers: ${names.join(', ')}`);
  console.log(`default provider: ${providers.defaultProvider()}`);
  console.log(webDir ? `serving web app from ${webDir}` : 'web app not built (npm run build:web)');
});
