import type { IncomingMessage } from 'node:http';

export interface GuardOptions {
  /** Browser origins allowed to call the server (its own origin at minimum). */
  allowedOrigins: string[];
  /** Hostnames (no port) accepted in the Host header, in addition to loopback names. */
  allowedHosts?: string[];
}

/**
 * Blocks DNS rebinding (Host) and cross-site requests (Origin). The server can spend the user's
 * provider quota and proxies to a shell, so a random web page must not be able to call it.
 * Non-browser clients send no Origin and are allowed; a browser page always sends one.
 */
export function makeGuard({ allowedOrigins, allowedHosts = [] }: GuardOptions) {
  const hostnames = new Set(['127.0.0.1', 'localhost', '[::1]', ...allowedHosts]);
  return (req: IncomingMessage): boolean => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    const origin = req.headers.origin;
    return hostnames.has(host) && (!origin || allowedOrigins.includes(origin));
  };
}
