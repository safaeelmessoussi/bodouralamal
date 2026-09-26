import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { FLOW_STATE_COOKIE, sealFlowState } from '../lib/oauth.js';
import { oauthCallback, startOAuth } from './auth.controller.js';

const CONFIG: AppConfig = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  GOOGLE_CLIENT_ID: 'client-123',
  GOOGLE_CLIENT_SECRET: 'secret',
  JWT_SIGNING_KEY: 'test-jwt-signing-key-at-least-32-chars-long',
  ONBOARDING_TOKEN_KEY: 'test-onboarding-key',
  EMAIL_LOCK_KEY: 'email-lock-isolated-fixture-key-at-least-32-bytes',
  MINIO_ENDPOINT: 'http://127.0.0.1:1',
  MINIO_ACCESS_KEY: 'unused',
  MINIO_SECRET_KEY: 'unused',
  RECORDING_STAGING_BUCKET: 'recordings-staging',
  PUBLIC_BASE_URL: 'https://example.test',
  STORAGE_BASE_URL: 'https://example.test/storage',
  NODE_ENV: 'test',
  TZ: 'Africa/Casablanca',
  PORT: 3000,
  LOG_LEVEL: 'info',
};

describe('Google OAuth callback identity boundary', () => {
  it('redirects before account resolution when a valid-looking token fails verification', async () => {
    const flow = { state: 'expected-state', codeVerifier: 'expected-verifier' };
    const sealed = sealFlowState(flow, CONFIG.JWT_SIGNING_KEY);
    const forgedToken = `header.${Buffer.from(
      JSON.stringify({
        aud: CONFIG.GOOGLE_CLIENT_ID,
        sub: 'attacker-subject',
        email: 'attacker@example.com',
        email_verified: true,
      }),
    ).toString('base64url')}.signature`;
    const verifyIdToken = vi.fn(async () => ({
      ok: false as const,
      reason: 'oauth_unavailable' as const,
    }));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id_token: forgedToken }),
    })) as unknown as typeof fetch;
    const req = {
      query: { state: flow.state, code: 'authorization-code' },
      header: vi.fn((name: string) =>
        name === 'cookie'
          ? `${FLOW_STATE_COOKIE}=${encodeURIComponent(sealed)}`
          : undefined,
      ),
      requestId: 'request-1',
    } as unknown as Request;
    const append = vi.fn();
    const redirect = vi.fn();
    const set = vi.fn();
    const res = { append, redirect, set } as unknown as Response;
    const prisma = new Proxy(
      {},
      {
        get() {
          throw new Error('account resolution must not run');
        },
      },
    ) as PrismaClient;

    await oauthCallback(prisma, CONFIG, { fetchImpl, verifyIdToken })(req, res);

    expect(verifyIdToken).toHaveBeenCalledWith(forgedToken, CONFIG.GOOGLE_CLIENT_ID);
    expect(redirect).toHaveBeenCalledWith(
      302,
      'https://example.test/login?error=oauth_unavailable',
    );
    expect(append).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining(`${FLOW_STATE_COOKIE}=; Max-Age=0`),
    );
  });
});

/**
 * R175 §5 — neither redirect may be stored.
 *
 * The entry redirect carries a one-time `state` and the flow cookie that must
 * match it; the callback's redirect reports one exchange. A reused response
 * would present a dead flow, and the symptom — a login that fails with
 * `state_mismatch` for no visible reason — reads as a server fault.
 */
describe('Google OAuth redirects are never stored', () => {
  it('sends no-store when beginning the flow', async () => {
    const set = vi.fn();
    const redirect = vi.fn();
    const req = { header: vi.fn(() => undefined) } as unknown as Request;
    const res = { append: vi.fn(), redirect, set } as unknown as Response;
    const prisma = new Proxy(
      {},
      {
        get() {
          throw new Error('an anonymous visitor must not reach the database');
        },
      },
    ) as PrismaClient;

    await startOAuth(prisma, CONFIG)(req, res);

    expect(set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(redirect).toHaveBeenCalledWith(302, expect.stringContaining('accounts.google.com'));
  });

  it('sends no-store when reporting the outcome', async () => {
    const set = vi.fn();
    const req = {
      query: { error: 'access_denied' },
      header: vi.fn(() => undefined),
      requestId: 'request-2',
    } as unknown as Request;
    const res = { append: vi.fn(), redirect: vi.fn(), set } as unknown as Response;

    await oauthCallback({} as PrismaClient, CONFIG)(req, res);

    expect(set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
