import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SignInButton } from './auth-buttons.js';
import HEADER from './application-header.tsx?raw';
import MOBILE from './mobile-menu.tsx?raw';
import LANDING from '../../pages/landing.tsx?raw';
import LOGIN_PAGE from '../../pages/public.tsx?raw';
import { SessionContext } from '../../contexts/session.js';

/**
 * **R175 §2 — a deployment may decline to OFFER the way in, while the way in
 * stays open** (the Owner, 2026-09-26).
 *
 * The temporary Production tier publishes a public calendar and a public
 * library while registration is not yet announced. What must hold: the shared
 * control disappears from the public chrome, and NOTHING else moves — the
 * `/login` page keeps its own control, and no file smuggles a second raw link
 * to the OAuth entry past the shared component.
 */
function render(signInOffered: boolean | null): string {
  return renderToStaticMarkup(
    <SessionContext.Provider
      value={{
        status: 'anonymous',
        me: null,
        accessToken: null,
        setAccessToken: () => undefined,
        signInOffered,
      }}
    >
      <SignInButton />
    </SessionContext.Provider>,
  );
}

describe('the shared sign-in control follows the deployment', () => {
  it('renders where sign-in is offered — the platform’s own behaviour', () => {
    expect(render(true)).toContain('/api/v1/auth/google');
  });

  it('renders NOTHING where it is not offered', () => {
    expect(render(false)).toBe('');
  });

  it('renders nothing before the answer arrives, so it never flashes into view', () => {
    // A control that appears and then vanishes is the one thing worse than a
    // control that is there: it tells a reader the door exists.
    expect(render(null)).toBe('');
  });
});

describe('the public chrome has no second way to offer it', () => {
  it('header, mobile menu and landing all go through the shared control', () => {
    for (const [name, source] of [
      ['application-header', HEADER],
      ['mobile-menu', MOBILE],
      ['landing', LANDING],
    ] as const) {
      expect(source, name).toContain('SignInButton');
      expect(source, name).not.toContain('/api/v1/auth/google');
    }
  });

  it('the /login page keeps its own control — the Owner’s explicit choice', () => {
    // Nothing links to that page while sign-in is not offered; it is where an
    // OAuth failure lands with its retry (§14.4), and it is the Owner's way in.
    expect(LOGIN_PAGE).toContain('/api/v1/auth/google');
  });
});
