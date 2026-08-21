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
  // SUPER_ADMIN_EMAIL is deliberately NOT here (TD-13, Revision 23): it is a
  // bootstrap value consumed by the seed, never by the running API, so demanding
  // it at boot would force operators to keep a line that no longer does anything.
  // The seed requires it only while no active Super Administrator exists, and
  // fails loudly naming it in that case.
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
/**
 * An operator "removing" an optional variable usually leaves `NAME=` in `.env`,
 * which arrives as an empty string rather than as absent — and `.optional()`
 * alone then fails validation, so the API refuses to boot on a variable it does
 * not even use. Revision 23 promises the value MAY be removed, so blank and
 * absent must mean the same thing. Found by running the real image, not the
 * unit test, which passed `undefined`.
 */
const blankAsAbsent = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema);

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
  SUPER_ADMIN_EMAIL: blankAsAbsent(z.string().min(1).optional()),
  NODE_ENV: z.enum(['production', 'development', 'test']),
  BACKUP_TARGET_SSH: blankAsAbsent(z.string().min(1).optional()),
  /**
   * **R98 — the online-class media provider** (TD-13, `online-class-provider.md`).
   *
   * Optional as a **group**: an association that runs no online classes leaves
   * all three unset and the API boots exactly as before, answering
   * `503 SERVICE_UNAVAILABLE` on the one route that needs them. It is a
   * capability, not a dependency of the platform.
   *
   * **Half-configured is a boot error**, though — see `loadConfig`. A deployment
   * with a URL and no secret would boot, look configured, and fail at the moment
   * a مؤطِّرة tries to open her class.
   *
   * The secret never leaves this process: tokens are minted server-side and the
   * browser receives a participant token and a URL, never a key (R98.9).
   */
  LIVEKIT_URL: blankAsAbsent(z.string().min(1).optional()),
  /**
   * **R99 — the address the SERVER calls the provider on**, which is not
   * necessarily the address the browser connects to.
   *
   * `LIVEKIT_URL` is handed to the client, so in development it is the
   * host-published `ws://127.0.0.1:7880`. Deriving the server's API URL from it
   * gives `http://127.0.0.1:7880`, which inside the API container is **the
   * container's own loopback** — so every recording request failed with
   * «fetch failed» while the media itself worked perfectly.
   *
   * R98 never noticed because it only ever *handed the URL to a browser*; the
   * conflation became wrong the moment the server had to call the provider
   * itself. Optional, and defaulted from `LIVEKIT_URL`, because in production
   * both really are the same public host — this exists for the split-horizon
   * case, which is every local setup.
   */
  LIVEKIT_API_URL: blankAsAbsent(z.string().min(1).optional()),
  LIVEKIT_API_KEY: blankAsAbsent(z.string().min(1).optional()),
  LIVEKIT_API_SECRET: blankAsAbsent(z.string().min(1).optional()),
  /**
   * **R99 — where the recording facility leaves its output.**
   *
   * A bucket the platform owns but **does not serve**: neither `public` nor
   * `private`. It is staging, and R99.13 makes the distinction load-bearing —
   * what the provider produced is temporary integration state, and only after
   * verification does an object enter the content lifecycle. Defaulted rather
   * than required, because it is infrastructure with one sensible name and no
   * secret in it.
   */
  RECORDING_STAGING_BUCKET: z.string().min(1).default('recordings-staging'),
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
  for (const key of [
    'TZ',
    'PORT',
    'LOG_LEVEL',
    'BACKUP_TARGET_SSH',
    'LIVEKIT_URL',
    'LIVEKIT_API_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'RECORDING_STAGING_BUCKET',
  ]) {
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

  /**
   * **R98 — the three LiveKit variables are all-or-nothing** (TD-13).
   *
   * None set is a complete, valid configuration: online classes are a
   * capability the association may not use, and `POST /sessions/{id}/online-join`
   * answers `503 SERVICE_UNAVAILABLE` naming the missing setting.
   *
   * **Some set is not.** A URL with no secret boots, reads as configured to
   * anyone inspecting `.env`, and fails at the one moment that matters — a
   * مؤطِّرة opening her class in front of her students. TD-13's fail-fast rule
   * exists for exactly that shape, so the partial case is refused at boot and
   * names the variables that are missing rather than the ones that are present
   * (values never appear in logs).
   */
  const livekit = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;
  const livekitSet = livekit.filter((key) => !isBlank(parsed.data[key]));
  if (livekitSet.length > 0 && livekitSet.length < livekit.length) {
    throw new InvalidEnvValueError(
      livekit
        .filter((key) => isBlank(parsed.data[key]))
        .map(
          (key) =>
            `${key}: the LiveKit settings are all-or-nothing — set every one of ${livekit.join(', ')} or none (TD-13)`,
        ),
    );
  }

  return parsed.data;
}
