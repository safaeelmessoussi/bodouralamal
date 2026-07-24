import { describe, expect, it } from 'vitest';

import {
  InvalidEnvValueError,
  loadConfig,
  MissingRequiredEnvError,
  REQUIRED_ENV_VARS,
} from './config.js';

// Fixture values only — reserved example.com domain per SRS §15.2.
function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://app:fixture@localhost:5432/bodour_test',
    GOOGLE_CLIENT_ID: 'fixture-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'fixture-client-secret',
    JWT_SIGNING_KEY: 'fixture-jwt-signing-key',
    ONBOARDING_TOKEN_KEY: 'fixture-onboarding-token-key',
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ACCESS_KEY: 'fixture-access-key',
    MINIO_SECRET_KEY: 'fixture-secret-key',
    PUBLIC_BASE_URL: 'http://localhost',
    STORAGE_BASE_URL: 'http://localhost/storage',
    SUPER_ADMIN_EMAIL: 'admin@example.com',
    NODE_ENV: 'test',
    ...overrides,
  };
}

describe('loadConfig (TD-13 fail-fast)', () => {
  it('returns the typed config when every required variable is present', () => {
    const config = loadConfig(validEnv());
    expect(config.DATABASE_URL).toContain('bodour_test');
    expect(config.NODE_ENV).toBe('test');
  });

  it('applies TD-13 defaults for optional variables', () => {
    const config = loadConfig(validEnv());
    expect(config.TZ).toBe('Africa/Casablanca');
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('throws a named error listing exactly the missing required variables', () => {
    const env = validEnv({ DATABASE_URL: undefined, JWT_SIGNING_KEY: undefined });
    let caught: unknown;
    try {
      loadConfig(env);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingRequiredEnvError);
    const err = caught as MissingRequiredEnvError;
    expect(err.name).toBe('MissingRequiredEnvError');
    expect(err.missing).toEqual(['DATABASE_URL', 'JWT_SIGNING_KEY']);
  });

  it('treats blank/whitespace values as missing', () => {
    expect(() => loadConfig(validEnv({ MINIO_SECRET_KEY: '   ' }))).toThrow(
      MissingRequiredEnvError,
    );
  });

  it('checks every TD-13 required variable', () => {
    for (const key of REQUIRED_ENV_VARS) {
      expect(() => loadConfig(validEnv({ [key]: undefined }))).toThrow(MissingRequiredEnvError);
    }
  });

  it('requires BACKUP_TARGET_SSH in production only', () => {
    const production = validEnv({ NODE_ENV: 'production' });
    expect(() => loadConfig(production)).toThrow(MissingRequiredEnvError);

    const withBackup = loadConfig(
      validEnv({ NODE_ENV: 'production', BACKUP_TARGET_SSH: 'restic@backup.example.com:/srv/bodour' }),
    );
    expect(withBackup.BACKUP_TARGET_SSH).toBe('restic@backup.example.com:/srv/bodour');

    // Non-production boots fine without it.
    expect(loadConfig(validEnv()).BACKUP_TARGET_SSH).toBeUndefined();
  });

  it('rejects LOG_LEVEL=debug in production (TD-13)', () => {
    const env = validEnv({
      NODE_ENV: 'production',
      BACKUP_TARGET_SSH: 'restic@backup.example.com:/srv/bodour',
      LOG_LEVEL: 'debug',
    });
    expect(() => loadConfig(env)).toThrow(InvalidEnvValueError);

    // debug is fine outside production.
    expect(loadConfig(validEnv({ LOG_LEVEL: 'debug' })).LOG_LEVEL).toBe('debug');
  });

  it('rejects invalid enum and numeric values with a named error', () => {
    expect(() => loadConfig(validEnv({ NODE_ENV: 'staging' }))).toThrow(InvalidEnvValueError);
    expect(() => loadConfig(validEnv({ PORT: 'not-a-port' }))).toThrow(InvalidEnvValueError);
    expect(() => loadConfig(validEnv({ LOG_LEVEL: 'trace' }))).toThrow(InvalidEnvValueError);
  });
});
