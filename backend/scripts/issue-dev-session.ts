/**
 * **Mints a real session for a dev user, so a browser can reach an authenticated
 * screen.**
 *
 * ## Why this exists
 *
 * The only issuer of a session is Google OAuth (§4.1b), which a headless browser
 * on a developer machine cannot complete. Without one, every `/admin/*` screen
 * redirects to `/login` and **no admin surface can be verified in a browser at
 * all** — which is how a layout defect shipped twice already.
 *
 * ## What it does NOT do
 *
 * It does not bypass anything. It calls `issueNewSession` — **the production code
 * path**, the same one the OAuth callback calls — so the row, the hash, the TTL
 * and the rotation semantics are the real ones. Authorisation is untouched: the
 * user is an ordinary `super_admin` in the database, and every request it then
 * makes goes through the same TD-2 checks as any other. What it replaces is the
 * *identity provider*, and only in a development database.
 *
 * Guarded on `NODE_ENV !== 'production'` and refuses to run against a
 * non-loopback database, because a session minted without an identity check is
 * exactly what must never exist in production.
 *
 *   bash scripts/dev/issue-dev-session.sh              # a Super Admin
 *   bash scripts/dev/issue-dev-session.sh <user-uuid>  # an EXISTING user, as they are
 *
 * With a uuid it mints for that user **exactly as they already exist** — no role
 * is granted and none is checked. That is the point: verifying a student's own
 * screens must exercise a student's real authorisation, and a script that
 * quietly widened it would be verifying a session nobody has.
 */
import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { issueNewSession } from '../src/services/refresh-token.service.js';

const config = loadConfig();
if (process.env['NODE_ENV'] === 'production') {
  throw new Error('refusing to mint a session in production');
}
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(config.DATABASE_URL)) {
  throw new Error('refusing to mint a session against a non-loopback database');
}

const prisma = createPrismaClient(config.DATABASE_URL, 2);
const NAME = '[dev-session] مديرة النظام';
const requested = process.argv[2];

const user =
  requested === undefined
    ? ((await prisma.user.findFirst({ where: { nameArabic: NAME } })) ??
      (await prisma.user.create({ data: { nameArabic: NAME, accountStatus: 'active' } })))
    : await prisma.user.findUniqueOrThrow({ where: { id: requested } });

// The Super Admin role is granted only to the script's OWN default user. A user
// named on the command line is minted for as they are: verifying a student's
// screens must exercise a student's real authorisation, and widening it here
// would verify a session nobody has.
if (requested === undefined) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  const held = await prisma.userBranchRole.findFirst({
    where: { userId: user.id, roleId: role.id, branchId: null },
  });
  if (held === null) {
    await prisma.userBranchRole.create({
      data: { userId: user.id, roleId: role.id, branchId: null },
    });
  }
}

const issued = await issueNewSession(prisma, user.id);
process.stdout.write(`${issued.rawToken}\n`);
await prisma.$disconnect();
