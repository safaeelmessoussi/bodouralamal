/**
 * **Every selector narrows every other one** (SRS Revision 198 §3, the Owner,
 * 2026-10-04): «the drop downs general logic in the whole platform is to be
 * dynamically updated with the other drop downs linked to them».
 *
 * Until R198 the curriculum selectors were a chain — Category → Level →
 * Subject — and a child waited for its parent («يُرجى اختيار المستوى أولًا»).
 * Now each list offers the values consistent with what is chosen in the
 * OTHERS, whichever was chosen first:
 *
 * | chosen | narrows |
 * |---|---|
 * | Category | Levels, Subjects, Surahs, Groups |
 * | Level | its Category (set), Subjects it teaches, its syllabus's Surahs, its Groups |
 * | Subject | Levels and Categories that teach it, their Surahs (none when it is not taught by Surah) |
 * | Surah | Levels whose syllabus holds it, Subjects taught by Surah there, their Categories |
 * | Group | sets its Level, Category and Branch |
 *
 * A list never narrows ITSELF, and the Category list is not narrowed by the
 * Level (choosing another Category is how a Level is changed; the Level then
 * goes, `reconcile`). Pure functions, so the rule is tested as a rule.
 */

export interface FacetValue {
  categoryId: string;
  levelId: string;
  subjectId: string;
  branchId: string;
  surahId: string;
  groupId: string;
}

export interface FacetFacts {
  /** In the Super Admin's order (R198 §5) — every list keeps it. */
  categoryIds: readonly string[];
  levels: readonly { id: string; category_id: string }[];
  subjectIds: readonly string[];
  /** A Level's own Subjects (`LevelSubject`). */
  levelSubjects: ReadonlyMap<string, readonly string[]>;
  /** The Subjects taught to a WHOLE Category (R172 §1) — taught at each of its Levels. */
  categorySubjects: ReadonlyMap<string, readonly string[]>;
  levelSurahIds: Readonly<Record<string, readonly number[]>>;
  subjectsBySurah: ReadonlySet<string>;
  groups: readonly { id: string; level_id: string; branch_id: string }[];
}

export interface FacetOptions {
  /** A filter with nothing else chosen offers EVERY Subject (Owner, 2026-08-17). */
  subjectsUnscoped: boolean;
  /** R172 §1 — `category:<id>` values in the Level list. */
  offerWholeCategory: boolean;
  /** R195 — legal values that are no rows (`'*'` «كل المواد»): no constraint. */
  sentinels: Partial<Record<keyof FacetValue, readonly string[]>>;
}

const WHOLE = 'category:';
const wholeOf = (levelId: string): string | null =>
  levelId.startsWith(WHOLE) ? levelId.slice(WHOLE.length) : null;

/** A Level, or a whole Category in the Level slot: what it teaches and memorises. */
interface Unit {
  key: string;
  categoryId: string;
  /** Real Levels it stands for — itself, or every Level of the Category. */
  levelIds: readonly string[];
  subjects: ReadonlySet<string>;
  surahs: ReadonlySet<number>;
}

function unitsOf(facts: FacetFacts, offerWholeCategory: boolean): Unit[] {
  const levelUnits: Unit[] = facts.levels.map((l) => ({
    key: l.id,
    categoryId: l.category_id,
    levelIds: [l.id],
    // R178 §1 — a Level teaches its own Subjects AND its Category's.
    subjects: new Set([...(facts.levelSubjects.get(l.id) ?? []), ...(facts.categorySubjects.get(l.category_id) ?? [])]),
    surahs: new Set(facts.levelSurahIds[l.id] ?? []),
  }));
  if (!offerWholeCategory) return levelUnits;
  const wholeUnits: Unit[] = facts.categoryIds.map((c) => {
    const members = facts.levels.filter((l) => l.category_id === c).map((l) => l.id);
    return {
      key: `${WHOLE}${c}`,
      categoryId: c,
      levelIds: members,
      subjects: new Set(facts.categorySubjects.get(c) ?? []),
      surahs: new Set(members.flatMap((id) => facts.levelSurahIds[id] ?? [])),
    };
  });
  return [...wholeUnits, ...levelUnits];
}

/** The values each narrowable list offers, given the others' (ids, in order). */
export interface Facets {
  categoryId: string[];
  levelId: string[];
  subjectId: string[];
  surahId: string[];
  groupId: string[];
}

export function facetsOf(value: FacetValue, facts: FacetFacts, options: FacetOptions): Facets {
  const units = unitsOf(facts, options.offerWholeCategory);
  const free = (field: keyof FacetValue): boolean =>
    value[field] === '' || (options.sentinels[field] ?? []).includes(value[field]);

  const byCategory = (u: Unit): boolean => free('categoryId') || u.categoryId === value.categoryId;
  const byLevel = (u: Unit): boolean => free('levelId') || u.key === value.levelId;
  const bySubject = (u: Unit): boolean => free('subjectId') || u.subjects.has(value.subjectId);
  const bySurah = (u: Unit): boolean => free('surahId') || u.surahs.has(Number(value.surahId));
  // A Subject not taught by Surah has no Surah to narrow by.
  const subjectAsksNoSurah = !free('subjectId') && !facts.subjectsBySurah.has(value.subjectId);

  const levelId = units.filter((u) => byCategory(u) && bySubject(u) && bySurah(u)).map((u) => u.key);

  const categoryId =
    free('levelId') && free('subjectId') && free('surahId')
      ? [...facts.categoryIds]
      : facts.categoryIds.filter((c) => units.some((u) => u.categoryId === c && bySubject(u) && bySurah(u)));

  const subjectPool = units.filter((u) => byCategory(u) && byLevel(u) && bySurah(u));
  const taught = new Set(subjectPool.flatMap((u) => [...u.subjects]));
  const everySubject = options.subjectsUnscoped && free('levelId') && free('categoryId') && free('surahId');
  const subjectId = facts.subjectIds.filter(
    (s) => (everySubject || taught.has(s)) && (free('surahId') || facts.subjectsBySurah.has(s)),
  );

  const surahs = new Set(
    units.filter((u) => byCategory(u) && byLevel(u) && bySubject(u)).flatMap((u) => [...u.surahs]),
  );
  const surahId = subjectAsksNoSurah ? [] : [...surahs].sort((a, b) => a - b).map(String);

  // Groups: a roster of one Level at one premises (§4.4c), so the Level (or
  // the whole Category's Levels), the Category and the Branch each narrow it.
  const chosenUnit = free('levelId') ? null : units.find((u) => u.key === value.levelId) ?? null;
  const wholeCat = wholeOf(value.levelId);
  const levelCategory = new Map(facts.levels.map((l) => [l.id, l.category_id]));
  const groupId = facts.groups
    .filter(
      (g) =>
        (free('branchId') || g.branch_id === value.branchId) &&
        (free('categoryId') || levelCategory.get(g.level_id) === value.categoryId) &&
        (chosenUnit === null
          ? wholeCat === null
          : chosenUnit.levelIds.includes(g.level_id)) &&
        (free('subjectId') ||
          units.some((u) => u.key === g.level_id && u.subjects.has(value.subjectId))),
    )
    .map((g) => g.id);

  return { categoryId, levelId, subjectId, surahId, groupId };
}

/**
 * **One field changed: what the others become.** A Level sets its Category, a
 * Group its Level, Category and Branch; clearing the Category retracts the
 * Level chosen under it; then every value the new combination no longer
 * offers is cleared — a stale id is what reaches the server as an impossible
 * pair (rule 2, applied at the source so no frame shows it).
 */
export function reconcile(
  current: FacetValue,
  field: keyof FacetValue,
  next: string,
  facts: FacetFacts,
  options: FacetOptions,
): FacetValue {
  const updated: FacetValue = { ...current, [field]: next };
  const categoryOfLevel = (levelId: string): string | undefined =>
    wholeOf(levelId) ?? facts.levels.find((l) => l.id === levelId)?.category_id;

  if (field === 'categoryId' && next === '') updated.levelId = '';
  if (field === 'levelId' && next !== '') {
    const category = categoryOfLevel(next);
    if (category !== undefined) updated.categoryId = category;
  }
  if (field === 'groupId' && next !== '') {
    const group = facts.groups.find((g) => g.id === next);
    if (group) {
      updated.levelId = group.level_id;
      updated.branchId = group.branch_id;
      updated.categoryId = categoryOfLevel(group.level_id) ?? updated.categoryId;
    }
  }

  const order: (keyof Facets)[] = ['categoryId', 'levelId', 'subjectId', 'surahId', 'groupId'];
  for (const other of order) {
    if (other === field) continue;
    const chosen = updated[other];
    if (chosen === '' || (options.sentinels[other] ?? []).includes(chosen)) continue;
    // A field the caller does not use carries no facts (no groups loaded):
    // nothing to check it against.
    if (other === 'groupId' && facts.groups.length === 0) continue;
    if (!facetsOf(updated, facts, options)[other].includes(chosen)) updated[other] = '';
  }
  return updated;
}
