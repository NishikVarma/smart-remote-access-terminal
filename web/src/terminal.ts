import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { engine, NotPaired } from './api.js';
import { dangerousCommandIn, TypedLine } from './guard.js';
import { lastLines } from './lib.js';

const SESSION_KEY = 'sessionId';

type ClientMessage =
  { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };
type ServerMessage = { type: 'output'; data: string } | { type: 'exit'; exitCode: number };

export interface TerminalHandle {
  /** Text currently selected in the terminal, or an empty string. */
  selection(): string;
  /** The last `count` lines on screen and in scrollback. */
  tail(count: number): string;
  /** Sends text to the shell exactly as if it had been typed. Callers must have user approval. */
  type(data: string): void;
  /** Turns the "confirm before sending a dangerous command" guard on or off. */
  setGuard(enabled: boolean): void;
}

/** The logical line under the cursor (wrapped rows joined), including the prompt. */
function currentLineText(term: Terminal): string | null {
  const buffer = term.buffer.active;
  let start = buffer.baseY + buffer.cursorY;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;

  let text = '';
  for (let y = start; ; y++) {
    const row = buffer.getLine(y);
    if (!row) return text === '' ? null : text;
    const continues = buffer.getLine(y + 1)?.isWrapped === true;
    text += row.translateToString(!continues);
    if (!continues) return text;
  }
}

async function sessionId(cols: number, rows: number): Promise<string> {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved && (await engine(`/sessions/${saved}`)).ok) return saved;

  const res = await engine('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
  if (!res.ok) throw new Error(`could not start a session (HTTP ${res.status})`);
  const { id } = (await res.json()) as { id: string };
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

/** Opens a terminal in `root`, connected to the engine's shell session through /engine. */
export function openTerminal(
  root: HTMLElement,
  onNeedPairing: () => void,
  onReconnected: () => void = () => {},
): TerminalHandle {
  const term = new Terminal({ cursorBlink: true, fontSize: 14 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(root);
  fit.fit();
  window.addEventListener('resize', () => fit.fit());

  const status = (text: string) => term.write(`\r\n[${text}]\r\n`);

  let ws: WebSocket | undefined;
  const send = (m: ClientMessage) =>
    ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  let guardEnabled = true;
  const typed = new TypedLine();
  term.onData((data) => {
    // A typo guard for phone typing: ask before a dangerous command is submitted. Declining
    // swallows the Enter, so the text stays on the prompt line for editing. Both the screen and
    // the locally tracked keystrokes are checked, because the screen lags behind fast typing.
    if (guardEnabled) {
      const risky = dangerousCommandIn(data, currentLineText(term), typed.snapshot());
      if (risky && !confirm(`This command looks dangerous:\n\n${risky}\n\nSend it?`)) return;
    }
    typed.observe(data);
    send({ type: 'input', data });
  });
  term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));

  let connectedBefore = false;

  // The engine replays buffered output on every attach, so the screen is reset first.
  const connect = (id: string) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = (ws = new WebSocket(`${proto}://${location.host}/engine/ws/${id}`));
    let exited = false;

    socket.onopen = () => {
      if (connectedBefore) onReconnected();
      connectedBefore = true;
      term.reset();
      send({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === 'output') return term.write(msg.data);
      exited = true;
      sessionStorage.removeItem(SESSION_KEY);
      status(`process exited with code ${msg.exitCode}`);
    };
    socket.onclose = (e) => {
      if (exited) return;
      if (e.code === 4001) return onNeedPairing();
      status('disconnected, reconnecting...');
      setTimeout(() => void reconnect(id), 1000);
    };
  };

  // Only retry while the session still exists; otherwise report why we stopped.
  const reconnect = async (id: string): Promise<void> => {
    try {
      const res = await engine(`/sessions/${id}`);
      if (res.status === 404) {
        sessionStorage.removeItem(SESSION_KEY);
        return status('session ended');
      }
      if (!res.ok) return status(`stopped (engine returned ${res.status})`);
      connect(id);
    } catch (error) {
      if (error instanceof NotPaired) return onNeedPairing();
      setTimeout(() => void reconnect(id), 2000); // server unreachable
    }
  };

  sessionId(term.cols, term.rows)
    .then(connect)
    .catch((e: Error) => (e instanceof NotPaired ? onNeedPairing() : status(e.message)));

  return {
    setGuard: (enabled) => {
      guardEnabled = enabled;
    },
    type: (data) => {
      send({ type: 'input', data });
      term.focus();
    },
    selection: () => term.getSelection(),
    tail: (count) => {
      const buffer = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
      }
      return lastLines(lines, count);
    },
  };
}
