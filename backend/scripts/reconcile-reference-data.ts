import { loadConfig } from '../src/lib/config.js';
import { createPrismaClient } from '../src/lib/prisma.js';

/**
 * **NEW J/K/L — reconcile the canonical reference data in place.**
 *
 * This is a **reconciliation, not a seed.** The seed lays a baseline on a fresh
 * database and then never touches these tables again (`seed.initialized.*`), so
 * an installation that has already been initialized needs a deliberate,
 * one-command pass to bring its rows to the Owner's canonical list.
 *
 * ## The rule it follows, which is the one already approved for the Subjects
 *
 * read-only analysis → prove semantic identity → **normalize in place** →
 * preserve the id and every relationship → never create a near-duplicate beside
 * the historical row → **skip only the ambiguous row** and report it, rather
 * than stopping the whole batch.
 *
 * ## What it will not do
 *
 * It never deletes an Owner row, never renames one it cannot match by identity,
 * and never recreates something intentionally deleted — except the one row the
 * Owner named explicitly (الطفل's المستوى 0), which is a restore of a specific
 * row by id, not a resurrection by name.
 *
 * Idempotent: running it twice changes nothing the second time.
 */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL);

/**
 * NEW K — the Owner's Categories, in order, with the descriptions ratified on
 * 2026-08-27. The description is **normalized in place** like every other field
 * here: an Owner who has since edited one keeps their edit only if it is not
 * part of this canonical set, which is the point of a reconciliation.
 */
const CATEGORIES = [
  { name: 'المرأة', description: 'النساء من سن الجامعة الى ما فوق' },
  { name: 'اليافعات', description: 'البنات اليافعات من سن السنة الأولى اعدادي الى سن السنة الأخيرة ثانوي' },
  { name: 'الطفل', description: 'الأطفال اناثا و ذكورا من سن السنة الأخيرة من الروض الى سن السادسة ابتدائي' },
] as const;

const CATEGORY_ORDER = CATEGORIES.map((c) => c.name);

/**
 * NEW L — every Level's description is `المستوى N - برنامج X`, where N is its
 * position within its Category and X is the Category's own name. Derived rather
 * than listed, so the two can never disagree: a Level moved in the ordering
 * gets the description its new position implies.
 *
 * الطفل's المستوى 0 is deliberately included at N = 0.
 */
const levelDescription = (categoryName: string, position: number): string =>
  `المستوى ${position} - برنامج ${categoryName}`;

/** NEW L — the Owner's canonical Level sequence, per Category. */
const LEVELS: Record<string, string[]> = {
  المرأة: [
    'وميض الأمل',
    'نور الأمل',
    'ضياء الأمل',
    'بريق الأمل',
    'شعاع الأمل',
    'سراج الأمل',
    'نجمات الأمل',
  ],
  اليافعات: ['نسيم الأمل', 'عبير الأمل', 'أريج الأمل', 'شذى الأمل', 'المستوى 5', 'مسك الأمل'],
  الطفل: [
    'كتاكيت الأمل',
    'براعم الأمل',
    'أشبال الأمل',
    'أجيال الأمل',
    'سواعد الأمل',
    'أبطال الأمل',
    'نجوم الأمل',
  ],
};

/** NEW J — nine teaching rooms and one lecture hall, at each branch. */
const BRANCHES = ['مقر تاركة', 'مقر أمرشيش'] as const;
const ROOM_CAPACITY = 10;
const HALL = 'قاعة المحاضرات';
const HALL_CAPACITY = 100;
/**
 * The hall's historical name. `قاعة رئيسية` and `قاعة المحاضرات` are the same
 * single large room at each branch — the canonical list has exactly one, and so
 * does every branch today — so it is **renamed in place**, keeping its id and
 * any booking that references it. Creating the new name beside it would leave
 * the near-duplicate the protocol forbids.
 */
const HALL_ALIASES = ['قاعة رئيسية'];

const skipped: string[] = [];

async function reconcileCategories(): Promise<void> {
  for (const [index, name] of CATEGORY_ORDER.entries()) {
    const rows = await prisma.category.findMany({ where: { name, deletedAt: null } });
    if (rows.length === 0) {
      skipped.push(`category «${name}» — not present; not created by a reconciliation`);
      continue;
    }
    if (rows.length > 1) {
      skipped.push(`category «${name}» — ${rows.length} live rows, identity ambiguous`);
      continue;
    }
    const row = rows[0]!;
    const wanted = CATEGORIES[index]!.description;
    if (row.displayOrder !== index + 1 || row.description !== wanted) {
      await prisma.category.update({
        where: { id: row.id },
        data: { displayOrder: index + 1, description: wanted },
      });
      console.log(`  category ${name}: order → ${index + 1}, description set`);
    }
  }
}

async function reconcileLevels(): Promise<void> {
  for (const categoryName of CATEGORY_ORDER) {
    const category = await prisma.category.findFirst({
      where: { name: categoryName, deletedAt: null },
      select: { id: true },
    });
    if (!category) continue;

    /**
     * **الطفل's المستوى 0 is restored by id, never recreated by name.**
     *
     * The Owner named it explicitly. It is soft-deleted beside the six other
     * numbered Levels the named ones replaced, so this un-deletes exactly that
     * row — keeping whatever is filed against it — rather than inserting a
     * second «المستوى 0» beside the historical one.
     */
    if (categoryName === 'الطفل') {
      const zero = await prisma.level.findFirst({
        where: { categoryId: category.id, name: 'المستوى 0' },
        orderBy: { createdAt: 'asc' },
      });
      if (!zero) {
        skipped.push('الطفل «المستوى 0» — no such row to restore');
      } else if (zero.deletedAt !== null) {
        await prisma.level.update({
          where: { id: zero.id },
          data: {
            deletedAt: null,
            deletedById: null,
            displayOrder: 0,
            description: levelDescription('الطفل', 0),
          },
        });
        console.log('  الطفل المستوى 0: restored (same row, same id)');
      } else if (zero.displayOrder !== 0 || zero.description !== levelDescription('الطفل', 0)) {
        await prisma.level.update({
          where: { id: zero.id },
          data: { displayOrder: 0, description: levelDescription('الطفل', 0) },
        });
      }
    }

    // §2.2 scopes `display_order` within the Category, and R76.6 makes it
    // 1-based and contiguous. The names already match; only the numbering had
    // drifted (11–16, 20–26).
    for (const [index, name] of (LEVELS[categoryName] ?? []).entries()) {
      const rows = await prisma.level.findMany({
        where: { categoryId: category.id, name, deletedAt: null },
      });
      if (rows.length === 0) {
        skipped.push(`level «${categoryName} / ${name}» — not present`);
        continue;
      }
      if (rows.length > 1) {
        skipped.push(`level «${categoryName} / ${name}» — ${rows.length} live rows, ambiguous`);
        continue;
      }
      const row = rows[0]!;
      const wanted = levelDescription(categoryName, index + 1);
      if (row.displayOrder !== index + 1 || row.description !== wanted) {
        await prisma.level.update({
          where: { id: row.id },
          data: { displayOrder: index + 1, description: wanted },
        });
        console.log(`  level ${categoryName}/${name}: order → ${index + 1}, description set`);
      }
    }
  }
}

async function reconcileRooms(): Promise<void> {
  for (const branchName of BRANCHES) {
    // **Matched by id through the Branch row, never by position.** A canonical
    // list keyed on order would attach rooms to whichever branch happened to
    // sort first.
    const branch = await prisma.branch.findFirst({
      where: { name: branchName, deletedAt: null },
      select: { id: true },
    });
    if (!branch) {
      skipped.push(`branch «${branchName}» — not present; rooms not reconciled`);
      continue;
    }

    for (let n = 1; n <= 9; n += 1) {
      const name = `قاعة ${n}`;
      const existing = await prisma.room.findFirst({
        where: { branchId: branch.id, name, deletedAt: null },
      });
      if (!existing) {
        await prisma.room.create({
          data: { branchId: branch.id, name, capacity: ROOM_CAPACITY },
        });
        console.log(`  ${branchName}/${name}: created (capacity ${ROOM_CAPACITY})`);
      } else if (existing.capacity !== ROOM_CAPACITY) {
        await prisma.room.update({
          where: { id: existing.id },
          data: { capacity: ROOM_CAPACITY },
        });
        console.log(`  ${branchName}/${name}: capacity → ${ROOM_CAPACITY}`);
      }
    }

    const hall =
      (await prisma.room.findFirst({
        where: { branchId: branch.id, name: HALL, deletedAt: null },
      })) ??
      (await prisma.room.findFirst({
        where: { branchId: branch.id, name: { in: HALL_ALIASES }, deletedAt: null },
      }));
    if (!hall) {
      await prisma.room.create({
        data: { branchId: branch.id, name: HALL, capacity: HALL_CAPACITY },
      });
      console.log(`  ${branchName}/${HALL}: created (capacity ${HALL_CAPACITY})`);
    } else if (hall.name !== HALL || hall.capacity !== HALL_CAPACITY) {
      await prisma.room.update({
        where: { id: hall.id },
        data: { name: HALL, capacity: HALL_CAPACITY },
      });
      console.log(`  ${branchName}/${hall.name} → ${HALL} (capacity ${HALL_CAPACITY}), same id`);
    }
  }
}

async function main(): Promise<void> {
  console.log('Reconciling canonical reference data (NEW J/K/L) — in place, ids preserved\n');
  await reconcileCategories();
  await reconcileLevels();
  await reconcileRooms();

  if (skipped.length > 0) {
    console.log('\nSKIPPED — reported rather than guessed:');
    for (const line of skipped) console.log(`  • ${line}`);
  }
  console.log('\nReconciliation complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Reconciliation failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
