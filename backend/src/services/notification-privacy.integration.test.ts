import { describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';

/**
 * **A notification must never become a store of somebody else's personal data**
 * (SRS §4.10a, Revision 131).
 *
 * ## What the audit found, and why this guard exists
 *
 * §4.10a classifies `notification.subject_user_id` as **PRESERVE** — a message
 * in *Alice's* inbox whose subject is *Fatima* is **Alice's record**, and
 * destroying it because Fatima was deleted would take one person's data with
 * another's. §4.10a pairs that with a warning: a surviving notification must not
 * become a covert copy of what was deleted.
 *
 * **In the current schema that risk does not exist, and this test is why we can
 * say so.** A `Notification` row stores a `type` enum and foreign keys — session,
 * event, exam, subject user — and **no text whatsoever**. The title a reader
 * sees is composed at read time from the relation
 * (`subjectUser: { select: { nameArabic: true } }`), so de-identifying Fatima
 * de-identifies every notification about her **automatically**, with no
 * additional work: the same row then resolves to «حساب محذوف», exactly like
 * every other preserved relationship.
 *
 * **So this asserts the property the conclusion rests on**, not the conclusion.
 * The day somebody adds a `title`, `body` or `message` column — a reasonable
 * thing to want — the reasoning silently stops holding and a deleted person's
 * name is frozen into other people's inboxes. That is the failure this guard
 * exists to make loud, and no Owner decision is needed to keep it: it merely
 * preserves the property §4.10a already assumed.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);

describe('R131 — a notification stores references, never copied content', () => {
  it('has no free-text content column', async () => {
    const columns = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notification'`,
    );
    const names = columns.map((c) => c.column_name);

    // The shape the conclusion depends on: identifiers, a type, timestamps.
    expect(names).toContain('subject_user_id');
    expect(names).toContain('type');

    /**
     * **No column may hold prose.** `text`/`varchar` columns are where a name,
     * a message or an educational detail would be frozen. The row's only
     * non-identifier column is the enum, which PostgreSQL reports as
     * `USER-DEFINED`.
     */
    const textual = columns.filter(
      (c) => c.data_type === 'text' || c.data_type.includes('character'),
    );
    expect(
      textual.map((c) => c.column_name),
      'a notification gained a text column — the R131 conclusion that it cannot ' +
        'store deleted personal data no longer holds; re-open the classification',
    ).toEqual([]);
  });

  it('every user reference is a foreign key, so it follows de-identification', async () => {
    // A copied id would not resolve to the tombstone; a foreign key does.
    const fks = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'notification'
          AND ccu.table_name = 'user'`,
    );
    expect(fks.map((f) => f.column_name).sort()).toEqual(['subject_user_id', 'user_id']);
  });
});
