import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../lib/config.js';
import { FLOW_STATE_COOKIE, sealFlowState } from '../lib/oauth.js';
import { oauthCallback } from './auth.controller.js';

const CONFIG: AppConfig = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  GOOGLE_CLIENT_ID: 'client-123',
  GOOGLE_CLIENT_SECRET: 'secret',
  JWT_SIGNING_KEY: 'test-jwt-signing-key-at-least-32-chars-long',
  ONBOARDING_TOKEN_KEY: 'test-onboarding-key',
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
    const res = { append, redirect } as unknown as Response;
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
