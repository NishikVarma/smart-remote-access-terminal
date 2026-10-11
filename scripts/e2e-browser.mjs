// Real-browser end-to-end check of the smart web app with the real engine.
//
//   npm run build:web && npm run e2e:browser
//
// Needs: the engine built (see scripts/e2e-engine.mjs), Chrome or Edge installed, and for the
// "Explain" step a local Ollama model. Ports 8797 (engine) and 8798 (smart server).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const SMART_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_DIR =
  process.env.ENGINE_DIR ?? resolve(SMART_DIR, '../pc-terminal-on-phone/apps/server');
const ORIGIN = 'http://localhost:8798';
const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) throw new Error('No Chrome/Edge found; set BROWSER_PATH');

const children = [];
const stop = () => children.forEach((c) => c.kill());
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
};

function start(args, cwd, env) {
  const child = spawn('node', args, { cwd, env: { ...process.env, ...env } });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return () => out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(150);
  }
  return null;
}

const engineOut = start(['dist/main.js'], ENGINE_DIR, {
  PORT: '8797',
  DB_PATH: join(mkdtempSync(join(tmpdir(), 'rta-ui-')), 'ui.db'),
  ALLOWED_ORIGINS: ORIGIN,
});
const smartOut = start(
  [join(SMART_DIR, 'node_modules/tsx/dist/cli.mjs'), 'src/server/main.ts'],
  SMART_DIR,
  {
    PORT: '8798',
    ENGINE_URL: 'http://127.0.0.1:8797',
    // A placeholder key only makes the cloud option appear; the consent step is cancelled, so it is never used.
    GEMINI_API_KEY: 'placeholder-never-sent',
  },
);

const code = await until(() => /Pairing code: (\d{8})/.exec(engineOut())?.[1]);
await until(() => /smart server on/.test(smartOut()));
if (!code || !/serving web app/.test(smartOut())) {
  console.log('FAIL: servers did not start (is web built? npm run build:web)');
  stop();
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 700 });
const diagnoseRequests = [];
page.on('request', (r) => r.url().includes('/api/diagnose') && diagnoseRequests.push(r.url()));
let lastDialog = '';
page.on('dialog', async (d) => {
  lastDialog = d.message();
  await d.dismiss(); // cancel consent prompts
});

try {
  await page.goto(`${ORIGIN}/`);
  const form = await page.waitForSelector('form.pair input', { timeout: 10_000 }).catch(() => null);
  check('unpaired browser sees the pairing form', Boolean(form));

  await page.type('form.pair input', code);
  await Promise.all([page.waitForNavigation({ timeout: 15_000 }), page.click('form.pair button')]);
  const termReady = await page.waitForSelector('.xterm', { timeout: 15_000 }).catch(() => null);
  check('after pairing the terminal appears', Boolean(termReady));

  const rows = () => page.evaluate(() => document.querySelector('.xterm-rows')?.textContent ?? '');
  const prompt = await until(async () => /PS .*>/.test(await rows()), 20_000);
  check('a PowerShell prompt is rendered', Boolean(prompt));

  await page.click('.xterm');
  await page.keyboard.type('echo ui-e2e-marker', { delay: 20 });
  await page.keyboard.press('Enter');
  const echoed = await until(async () => (await rows()).split('ui-e2e-marker').length > 2, 15_000);
  check('typed command runs and its output is shown', Boolean(echoed));

  await page.click('#ai-toggle');
  const options = await page.$$eval('#ai select', (selects) =>
    [...selects[0].options].map((x) => x.textContent),
  );
  check('provider list shows local and cloud options', options.length >= 2, options.join(' | '));

  // Cloud provider: the consent dialog must name the data leaving the machine, and cancel must send nothing.
  await page.select('#ai select', 'gemini');
  const before = diagnoseRequests.length;
  await page.evaluate(() => {
    [...document.querySelectorAll('#ai button')]
      .find((b) => b.textContent === 'Explain last output')
      ?.click();
  });
  await until(() => lastDialog !== '', 5_000);
  check('cloud use asks for consent first', /over the internet/.test(lastDialog));
  await sleep(500);
  check('cancelling the consent sends nothing', diagnoseRequests.length === before);

  // Local provider: runs without a dialog and renders an answer or an explicit abstention.
  await page.select('#ai select', 'ollama');
  await page.evaluate(() => {
    [...document.querySelectorAll('#ai button')]
      .find((b) => b.textContent === 'Explain last output')
      ?.click();
  });
  const answered = await until(
    async () =>
      page.evaluate(() => {
        const text = document.querySelector('#ai')?.textContent ?? '';
        return text.includes('Handled by') || text.includes('Could not');
      }),
    150_000,
  );
  check('local explanation returns a visible result', Boolean(answered));

  // Natural language -> command. Only "Insert" is exercised: it types the text without pressing Enter,
  // so nothing a model chose is ever executed by this test.
  const buttonByText = async (text) => {
    for (const handle of await page.$$('#ai button')) {
      if ((await handle.evaluate((b) => b.textContent)) === text) return handle;
    }
    return null;
  };
  const lastRow = () =>
    page.evaluate(() => {
      const rowsText = [...document.querySelectorAll('.xterm-rows > div')]
        .map((d) => (d.textContent ?? '').replace(/\s/g, ' '))
        .filter((t) => t.trim() !== '');
      return (rowsText.at(-1) ?? '').trimEnd(); // rows are padded with spaces
    });

  await page.type('#ai input:not([type=checkbox])', 'show the current directory');
  await (await buttonByText('Suggest commands')).click();
  // The Insert button only exists once suggestions are rendered (an explanation has no such button).
  const insertButton = await until(() => buttonByText('Insert'), 150_000);
  const suggested = insertButton
    ? await insertButton.evaluate((b) => b.parentElement?.querySelector('code')?.textContent ?? '')
    : '';
  check('suggestions appear with a command', Boolean(suggested), suggested || 'none');
  if (!suggested) {
    const panelText = await page.evaluate(() => document.querySelector('#ai')?.textContent ?? '');
    console.log('panel text:', panelText.slice(0, 400));
  }

  if (insertButton && suggested) {
    const labels = await page.$$eval('#ai .badge', (nodes) => nodes.map((n) => n.textContent));
    check(
      'each suggestion carries a risk label',
      labels.includes('review') || labels.includes('dangerous'),
    );

    await insertButton.click(); // a real, trusted click
    const typed = await until(async () => (await lastRow()).endsWith(suggested), 10_000);
    check('Insert types the command at the prompt', Boolean(typed), await lastRow());

    // If Enter had been pressed the shell would have printed output or a new prompt below the command.
    await sleep(1500);
    check('Insert alone does not press Enter', (await lastRow()).endsWith(suggested));
  }

  // Dangerous-command guard. The path does not exist, so even if the guard failed nothing would be deleted.
  await page.keyboard.press('Escape'); // PSReadLine: clear the line (drops the inserted text)
  await until(async () => (await lastRow()).endsWith('>'), 5_000); // wait for a clean prompt
  await page.click('.xterm');
  lastDialog = '';
  const risky = String.raw`Remove-Item -Recurse -Force .\e2e-guard-nonexistent-dir`;
  await page.keyboard.type(risky, { delay: 5 });
  await page.keyboard.press('Enter');
  await until(() => lastDialog !== '', 5_000);
  check(
    'a dangerous command triggers a confirmation naming it',
    lastDialog.includes('looks dangerous') && lastDialog.includes('e2e-guard-nonexistent-dir'),
    JSON.stringify(lastDialog.slice(0, 160)),
  );
  await sleep(1500);
  check(
    'declining keeps the command on the prompt line unexecuted',
    (await lastRow()).endsWith(risky),
  );
  await page.keyboard.press('Escape');

  // Catch-up summary on request (local model).
  await (await buttonByText('Summarize recent activity')).click();
  const summarised = await until(
    () =>
      page.evaluate(() => {
        const text = document.querySelector('#ai')?.textContent ?? '';
        return text.includes('Terminal state') || text.includes('Could not summarise');
      }),
    150_000,
  );
  check('summary of recent activity renders', Boolean(summarised));
} finally {
  await browser.close();
  stop();
}

process.exit(results.every(Boolean) ? 0 : 1);
