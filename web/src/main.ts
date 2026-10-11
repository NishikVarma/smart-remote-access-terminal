import { engine } from './api.js';
import { mountAiPanel } from './ai-panel.js';
import { openTerminal } from './terminal.js';

const terminalRoot = document.getElementById('terminal')!;
const aiRoot = document.getElementById('ai')!;

function showPairing(): void {
  document.getElementById('ai-toggle')?.remove();
  aiRoot.hidden = true;
  terminalRoot.replaceChildren();

  const form = document.createElement('form');
  form.className = 'pair';
  const help = document.createElement('p');
  help.textContent = 'Enter the pairing code shown in the remote-terminal-access console.';
  const input = document.createElement('input');
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.placeholder = '12345678';
  const button = document.createElement('button');
  button.textContent = 'Pair this device';
  const error = document.createElement('p');
  error.className = 'muted';
  form.append(help, input, button, error);
  terminalRoot.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await fetch('/engine/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: input.value.trim(), name: navigator.userAgent.slice(0, 50) }),
    });
    if (res.ok) location.reload();
    else error.textContent = 'Wrong or expired code.';
  });
}

// Pairing is the engine's job; this page only shows its form when the engine says "unauthorized".
engine('/sessions/none')
  .then(() => {
    // The terminal exists before the panel does, so the reconnect hook is filled in afterwards.
    const hooks = { onReconnected: () => {} };
    const terminal = openTerminal(terminalRoot, showPairing, () => hooks.onReconnected());
    hooks.onReconnected = mountAiPanel(aiRoot, terminal).notifyReconnected;
  })
  .catch(() => showPairing());
