/**
 * A process that starts a real registration transaction and then **stops
 * inside it**, waiting to be killed.
 *
 * This exists for the §18 acceptance check *"kill the process mid-transaction
 * in a test — nothing partial persists"*. That check is not the same as
 * "an error rolls the transaction back", which `registration.integration.test`
 * already proves deterministically: this one proves the **crash** case, where
 * no error is ever raised and no handler runs. What must save the database then
 * is not application code at all — it is PostgreSQL discarding an uncommitted
 * transaction when its client connection dies.
 *
 * The real `register()` runs, unmodified. A Prisma client extension parks the
 * **last** write of the transaction, by which point the token has been consumed
 * and the parent, child, link and consent rows all exist but are uncommitted.
 * The parent test then sends `SIGKILL` — which no `finally`, no `process.on`
 * and no Prisma teardown can intercept.
 *
 * Run as a child process; it prints `READY <pid>` on stdout once parked.
 */
import { loadConfig } from '../lib/config.js';
import { issueOnboardingToken } from '../lib/onboarding-token.js';
import { createPrismaClient } from '../lib/prisma.js';
import { register } from '../services/registration.service.js';
import type { RegistrationInput } from '../validators/registration.validators.js';

const tag = process.argv[2];
const email = process.argv[3];
const subject = process.argv[4];
/** §4.1 Revision 39 — the applicant's chosen branch, passed in by the parent
 *  test so this process creates no reference data of its own. */
const branchId = process.argv[5];
if (!tag || !email || !subject || !branchId) {
  throw new Error('usage: registration-victim <tag> <email> <subject> <branchId>');
}

const config = loadConfig();
const base = createPrismaClient(config.DATABASE_URL, 1);

/**
 * Park on `userIdentity.create` — the final write of TD-4.1's transaction. The
 * pause is inside the transaction, so everything before it is written and
 * nothing is committed.
 */
const prisma = base.$extends({
  query: {
    userIdentity: {
      create({ args, query }) {
        process.stdout.write(`READY ${process.pid}\n`);
        // Long enough that the parent's kill always lands first; if it somehow
        // does not, the process exits without committing anyway.
        return new Promise((resolve) => {
          setTimeout(() => resolve(query(args)), 60_000);
        });
      },
    },
  },
});

const input: RegistrationInput = {
  kind: 'parent_child',
  parent: { first_name_arabic: `${tag}`, last_name_arabic: `والدة`, phone: '+212 600 000 009', sex: 'female' },
  child: { first_name_arabic: `${tag}`, last_name_arabic: `طفلة`, sex: 'female' },
  branch_id: branchId,
  consents: { data_processing: true, media_release: true },
};

const { token } = issueOnboardingToken({ email, providerSubjectId: subject }, config.ONBOARDING_TOKEN_KEY);

// No catch and no finally: this process is meant to die, and adding either
// would only disguise whether the database cleaned up on its own.
await register(prisma as never, token, input, config.ONBOARDING_TOKEN_KEY);
