import { z } from 'zod';

/**
 * TD-13 environment inventory — boot-time fail-fast validation.
 *
 * The SRS TD-13 table is the single authoritative list of runtime environment
 * variables; `.env.example` is generated from it and must stay in lockstep.
 * The app fails fast at boot with a *named* error if any Required variable is
 * missing (TD-13). Secrets have no defaults by design.
 */

/** Required in every environment (TD-13 "Required: Yes"). */
export const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'JWT_SIGNING_KEY',
  'ONBOARDING_TOKEN_KEY',
  'MINIO_ENDPOINT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'PUBLIC_BASE_URL',
  'STORAGE_BASE_URL',
  'SUPER_ADMIN_EMAIL',
  'NODE_ENV',
] as const;

export class MissingRequiredEnvError extends Error {
  override readonly name = 'MissingRequiredEnvError';

  constructor(public readonly missing: readonly string[]) {
    // Variable *names* only — never values (secrets never appear in logs, TD-13).
    super(
      `Missing required environment variable(s): ${missing.join(', ')} — see .env.example / SRS TD-13`,
    );
  }
}

export class InvalidEnvValueError extends Error {
  override readonly name = 'InvalidEnvValueError';

  constructor(public readonly issues: readonly string[]) {
    super(`Invalid environment variable value(s): ${issues.join('; ')} — see SRS TD-13`);
  }
}

// NODE_ENV: TD-13 lists production | development; `test` is accepted as a
// non-production value for the §19.2 test runners (the §15.2 fixture guard
// checks NODE_ENV != production, which `test` satisfies).
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  JWT_SIGNING_KEY: z.string().min(1),
  ONBOARDING_TOKEN_KEY: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  PUBLIC_BASE_URL: z.string().min(1),
  STORAGE_BASE_URL: z.string().min(1),
  SUPER_ADMIN_EMAIL: z.string().min(1),
  NODE_ENV: z.enum(['production', 'development', 'test']),
  BACKUP_TARGET_SSH: z.string().min(1).optional(),
  TZ: z.string().min(1).default('Africa/Casablanca'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['info', 'debug']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * Validates the TD-13 inventory against `env` and returns the typed config.
 * Must be the first thing the boot path executes — nothing else may
 * initialize before it (fail-fast, TD-13).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const missing: string[] = REQUIRED_ENV_VARS.filter((key) => isBlank(env[key]));

  // BACKUP_TARGET_SSH is Required in production only (TD-13 "Prod only").
  if (env.NODE_ENV === 'production' && isBlank(env.BACKUP_TARGET_SSH)) {
    missing.push('BACKUP_TARGET_SSH');
  }
  if (missing.length > 0) {
    throw new MissingRequiredEnvError(missing);
  }

  // Blank optionals fall back to their TD-13 defaults rather than failing.
  const candidate: Record<string, string | undefined> = { ...env };
  for (const key of ['TZ', 'PORT', 'LOG_LEVEL', 'BACKUP_TARGET_SSH']) {
    if (isBlank(candidate[key])) delete candidate[key];
  }

  const parsed = envSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new InvalidEnvValueError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  if (parsed.data.NODE_ENV === 'production' && parsed.data.LOG_LEVEL === 'debug') {
    throw new InvalidEnvValueError(['LOG_LEVEL: `debug` is prohibited in production (TD-13)']);
  }

  return parsed.data;
}
