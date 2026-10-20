import type { Prisma } from '../generated/prisma/client.js';
import * as audit from '../repositories/audit.repository.js';

/**
 * **SRS Revision 233 — the programmes as the institute runs them from this
 * year** (the Owner, 2026-10-20). One idempotent pass over the reference data,
 * for `ops:apply-programmes`:
 *
 * - «اليافعات»: the current Levels become the «كبار» track («نسيم الأمل كبار» …,
 *   a rename only — their students stay), and a «صغار» track is added beside
 *   them («نسيم الأمل صغار» … «مسك الأمل صغار»);
 * - «اليافعين» (boys only), new: «براعم الأمل صغار» … «نجوم الأمل صغار» and the
 *   same six «كبار»;
 * - the entry Levels: the first of each of those four tracks, with the ages the
 *   Owner gave where none is stated.
 *
 * Names are the keys: a Level that already carries its new name is left as it
 * is, so a second run changes nothing. A Level the Owner named differently is
 * reported, never guessed at. Curriculum («مواد المستوى», «مقرر الحفظ») is not
 * copied — the new Levels start empty.
 */
export const GIRLS = 'اليافعات';
export const BOYS = 'اليافعين';
export const GIRLS_LEVELS = ['نسيم الأمل', 'عبير الأمل', 'أريج الأمل', 'شذى الأمل', 'ريحان الأمل', 'مسك الأمل'];
export const BOYS_LEVELS = ['براعم الأمل', 'أشبال الأمل', 'أجيال الأمل', 'سواعد الأمل', 'أبطال الأمل', 'نجوم الأمل'];
const YOUNGER = 'صغار';
const OLDER = 'كبار';

/** The ages the Owner gave for each entry Level — set only where none is stated. */
const ENTRY_AGES: Record<string, [number, number]> = {
  'نسيم الأمل صغار': [8, 10],
  'نسيم الأمل كبار': [11, 13],
  'براعم الأمل صغار': [8, 9],
  'براعم الأمل كبار': [10, 11],
};

export interface ProgrammesReport {
  lines: string[];
  changes: number;
}

type Tx = Prisma.TransactionClient;

export async function applyProgrammesR233(tx: Tx): Promise<ProgrammesReport> {
  const lines: string[] = [];
  let changes = 0;
  const note = async (line: string, entry: Parameters<typeof audit.write>[1]): Promise<void> => {
    lines.push(line);
    changes += 1;
    await audit.write(tx, entry);
  };

  const girls = await tx.category.findFirst({ where: { name: GIRLS, deletedAt: null } });
  if (!girls) throw new Error(`no live Category «${GIRLS}»`);

  let boys = await tx.category.findFirst({ where: { name: BOYS, deletedAt: null } });
  if (!boys) {
    boys = await tx.category.create({ data: { name: BOYS, holdsOwnLogin: girls.holdsOwnLogin } });
    await note(`+ Category «${BOYS}»`, {
      actorUserId: null,
      actionType: 'category.create',
      targetEntity: 'Category',
      targetId: boys.id,
      detail: { reason: 'SRS R233 — the boys’ teen programme' },
    });
  }

  // «اليافعات»: the current Levels are the «كبار» track.
  for (const base of GIRLS_LEVELS) {
    const renamed = `${base} ${OLDER}`;
    const current = await tx.level.findFirst({ where: { categoryId: girls.id, name: base, deletedAt: null } });
    const already = await tx.level.findFirst({ where: { categoryId: girls.id, name: renamed, deletedAt: null } });
    if (current && !already) {
      await tx.level.update({ where: { id: current.id }, data: { name: renamed, track: 'older', version: { increment: 1 } } });
      await note(`~ «${base}» → «${renamed}»`, {
        actorUserId: null,
        actionType: 'level.update',
        targetEntity: 'Level',
        targetId: current.id,
        detail: { renamed: true, track: 'older', reason: 'SRS R233' },
      });
    } else if (already && already.track !== 'older') {
      await tx.level.update({ where: { id: already.id }, data: { track: 'older', version: { increment: 1 } } });
      await note(`~ «${renamed}»: track كبار`, {
        actorUserId: null,
        actionType: 'level.update',
        targetEntity: 'Level',
        targetId: already.id,
        detail: { track: 'older', reason: 'SRS R233' },
      });
    } else if (!current && !already) {
      lines.push(`! «${base}» not found in «${GIRLS}» — left for the Owner to rename`);
    }
  }
  const others = await tx.level.findMany({
    where: {
      categoryId: girls.id,
      deletedAt: null,
      name: { notIn: GIRLS_LEVELS.flatMap((b) => [b, `${b} ${OLDER}`, `${b} ${YOUNGER}`]) },
    },
    select: { name: true },
  });
  for (const level of others) lines.push(`! «${level.name}» in «${GIRLS}» is not one of the six — left as it is`);

  await ensureTrack(tx, girls.id, GIRLS_LEVELS, YOUNGER, 'younger', 'girls_only', note);
  await ensureTrack(tx, boys.id, BOYS_LEVELS, YOUNGER, 'younger', 'boys_only', note);
  await ensureTrack(tx, boys.id, BOYS_LEVELS, OLDER, 'older', 'boys_only', note);

  // The entry Levels, and their ages where none is stated.
  for (const [name, [min, max]] of Object.entries(ENTRY_AGES)) {
    const level = await tx.level.findFirst({
      where: { categoryId: { in: [girls.id, boys.id] }, name, deletedAt: null },
    });
    if (!level) continue;
    const ages = level.minAge === null && level.maxAge === null ? { minAge: min, maxAge: max } : {};
    if (level.acceptsNewcomers && Object.keys(ages).length === 0) continue;
    await tx.level.update({
      where: { id: level.id },
      data: { acceptsNewcomers: true, ...ages, version: { increment: 1 } },
    });
    await note(`~ «${name}»: entry Level${Object.keys(ages).length ? `, ${String(min)}–${String(max)}` : ''}`, {
      actorUserId: null,
      actionType: 'level.update',
      targetEntity: 'Level',
      targetId: level.id,
      detail: { accepts_newcomers: true, ...(Object.keys(ages).length ? { min_age: min, max_age: max } : {}), reason: 'SRS R233' },
    });
  }

  return { lines, changes };
}

/** The six Levels of one track, created where missing, after the Category's last. */
async function ensureTrack(
  tx: Tx,
  categoryId: string,
  bases: readonly string[],
  word: string,
  track: 'younger' | 'older',
  genderRestriction: 'girls_only' | 'boys_only',
  note: (line: string, entry: Parameters<typeof audit.write>[1]) => Promise<void>,
): Promise<void> {
  for (const base of bases) {
    const name = `${base} ${word}`;
    const existing = await tx.level.findFirst({ where: { categoryId, name, deletedAt: null } });
    if (existing) continue;
    const last = await tx.level.aggregate({ where: { categoryId, deletedAt: null }, _max: { displayOrder: true } });
    const level = await tx.level.create({
      data: {
        name,
        categoryId,
        genderRestriction,
        track,
        journeyRole: 'step',
        displayOrder: (last._max.displayOrder ?? 0) + 1,
      },
    });
    await note(`+ «${name}»`, {
      actorUserId: null,
      actionType: 'level.create',
      targetEntity: 'Level',
      targetId: level.id,
      detail: { category_id: categoryId, gender_restriction: genderRestriction, track, reason: 'SRS R233' },
    });
  }
}
