/**
 * Minimal cookie parsing and serialization.
 *
 * Hand-rolled rather than adding `cookie-parser`: §3.1a Phase 1 permits patch
 * updates, not new components, and this is a dozen lines against a dependency.
 *
 * Cookie attributes are **identical in every environment** (§19.0) — there is no
 * dev/prod branch here, because environment-conditional downgrades (dropping
 * `Secure`, weakening `SameSite`) are prohibited. `http://localhost` is a secure
 * context in every modern browser, so `Secure` works unmodified in development.
 */

export interface CookieOptions {
  maxAgeSeconds: number;
  path: string;
  /** TD-12: `SameSite=Lax` everywhere. Never `None`. */
  sameSite?: 'Lax' | 'Strict';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAgeSeconds}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite ?? 'Lax'}`,
    'HttpOnly',
    'Secure',
  ].join('; ');
}

/** Expires a cookie by name, matching the path it was set on. */
export function clearCookie(name: string, path: string): string {
  return `${name}=; Max-Age=0; Path=${path}; SameSite=Lax; HttpOnly; Secure`;
}
