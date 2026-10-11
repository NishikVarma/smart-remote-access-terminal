// End-to-end check: the real remote-terminal-access engine behind this repo's proxy.
//
//   npm run e2e:engine
//
// Needs the engine built (`npm run build` in that repo). Set ENGINE_DIR to its apps/server folder if
// it is not a sibling folder named pc-terminal-on-phone. Uses ports 8797 (engine) and 8798 (smart).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const SMART_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_DIR =
  process.env.ENGINE_DIR ?? resolve(SMART_DIR, '../pc-terminal-on-phone/apps/server');
const SMART_ORIGIN = 'http://localhost:8798';

const children = [];
const stop = () => children.forEach((c) => c.kill());
const fail = (message) => {
  console.log('FAIL:', message);
  stop();
  process.exit(1);
};
setTimeout(() => fail('timeout'), 90_000);

function start(args, cwd, env) {
  const child = spawn('node', args, { cwd, env: { ...process.env, ...env } });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return () => out;
}

const engineOut = start(['dist/main.js'], ENGINE_DIR, {
  PORT: '8797',
  DB_PATH: join(mkdtempSync(join(tmpdir(), 'rta-e2e-')), 'e2e.db'),
  ALLOWED_ORIGINS: SMART_ORIGIN,
});
const smartOut = start(
  [join(SMART_DIR, 'node_modules/tsx/dist/cli.mjs'), 'src/server/main.ts'],
  SMART_DIR,
  { PORT: '8798', ENGINE_URL: 'http://127.0.0.1:8797' },
);

async function until(check, what, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fail(`waiting for ${what}`);
}

const code = await until(
  () => /Pairing code: (\d{8})/.exec(engineOut())?.[1],
  'engine pairing code',
);
await until(() => /smart server on/.test(smartOut()), 'smart server');

const headers = { 'content-type': 'application/json', origin: SMART_ORIGIN };
const results = [];
const check = (name, ok) => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
};

const pair = await fetch('http://localhost:8798/engine/pair', {
  method: 'POST',
  headers,
  body: JSON.stringify({ code, name: 'e2e-proxy-test' }),
});
check('pair through the proxy returns 201', pair.status === 201);
const cookie = pair.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
check('device cookie is passed back to the browser', cookie.startsWith('rta_device='));

const created = await fetch('http://localhost:8798/engine/sessions', {
  method: 'POST',
  headers: { ...headers, cookie },
  body: JSON.stringify({ cols: 100, rows: 30 }),
});
check('session can be created', created.status === 201);
const { id } = await created.json();

const unauth = await fetch(`http://localhost:8798/engine/sessions/${id}`, {
  headers: { origin: SMART_ORIGIN },
});
check('session without the cookie is refused by the engine (401)', unauth.status === 401);

const marker = 'smart-proxy-e2e-ok';
const echoed = await new Promise((resolveEcho) => {
  const ws = new WebSocket(`ws://localhost:8798/engine/ws/${id}`, {
    headers: { origin: SMART_ORIGIN, cookie },
  });
  let text = '';
  ws.on('open', () =>
    setTimeout(() => ws.send(JSON.stringify({ type: 'input', data: `echo ${marker}\r` })), 1500),
  );
  ws.on('message', (m) => {
    const msg = JSON.parse(m.toString());
    if (msg.type === 'output') text += msg.data;
    // The command line itself echoes once; the command's output is the second occurrence.
    if (text.split(marker).length > 2) {
      ws.close();
      resolveEcho(true);
    }
  });
  ws.on('unexpected-response', () => resolveEcho(false));
  setTimeout(() => resolveEcho(false), 15_000);
});
check('a command typed through the proxy runs in a real shell', echoed === true);

const del = await fetch(`http://localhost:8798/engine/sessions/${id}`, {
  method: 'DELETE',
  headers: { ...headers, cookie },
});
check('session can be deleted', del.status === 204);

stop();
process.exit(results.every(Boolean) ? 0 : 1);
