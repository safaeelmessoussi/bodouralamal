/**
 * **Mints a real onboarding token, so a browser can reach the registration form.**
 *
 * ## Why this exists
 *
 * The sibling of `issue-dev-session.ts`, for the same reason and with the same
 * guards. §4.1b's only issuer of an onboarding token is the Google OAuth
 * callback, which a headless browser cannot complete — so without this, the
 * registration form is unreachable in a browser and **the one journey a
 * beneficiary actually performs cannot be regression-tested at all.** That is
 * how a 500 on `POST /registrations` reached an Owner instead of a harness.
 *
 * ## What it does NOT do
 *
 * It bypasses nothing. It calls `issueOnboardingToken` — **the production code
 * path**, the same one the callback calls — so the signature, the TTL, the
 * single-use `jti` and the verified-identity binding are all the real ones.
 * What it replaces is the *identity provider*, and only in a development
 * database. The registration transaction still extracts identity fields
 * exclusively from the verified token payload and ignores the request body
 * (§20 rule 9), which is precisely the protection this must not weaken.
 *
 *   bash scripts/dev/issue-dev-onboarding.sh <email> <provider-subject-id>
 */
import { loadConfig } from '../src/lib/config.js';
import { issueOnboardingToken } from '../src/lib/onboarding-token.js';

const config = loadConfig();
if (process.env['NODE_ENV'] === 'production') {
  throw new Error('refusing to mint an onboarding token in production');
}
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(config.DATABASE_URL)) {
  throw new Error('refusing to mint an onboarding token against a non-loopback database');
}

const email = process.argv[2];
const subject = process.argv[3];
if (!email || !subject) {
  throw new Error('usage: issue-dev-onboarding.ts <email> <provider-subject-id>');
}

const { token } = issueOnboardingToken(
  { email, providerSubjectId: subject },
  config.ONBOARDING_TOKEN_KEY,
);
process.stdout.write(`${token}\n`);
