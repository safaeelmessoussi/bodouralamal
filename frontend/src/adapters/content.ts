import { api } from '../lib/api.js';
import type { Occurrence } from './calendar.js';

/**
 * The educational-content adapter (§4.9, §5.2, TD-3.13).
 *
 * **Backed by the real `GET /library` since Revision 43 landed it.** The mock
 * this file used to carry promised that *"swapping the mock for real `api()`
 * calls is a change to the two exported functions and to nothing else"*, and
 * that is what happened: every type below, and every component and page reading
 * them, is unchanged.
 *
 * ## Two things the endpoint does not carry, and what happens to them
 *
 * **`teacher_display_name` is always `null`.** `EducationalContent` has **no
 * uploader field** — §7 defines none, and adding one is a schema decision the
 * Document Owner has not taken (it is recorded as deferred). The key stays on
 * the type so a client coded against §5.2 finds it where the specification says
 * it is, and the card renders nothing rather than a guess.
 *
 * **`kind` is derived here from the MIME type.** The mock argued this belonged
 * server-side; on reflection it does not. §14.6 defines *presentation*
 * behaviour per class — PDFs inline, audio in place, office files
 * download-only — and presentation is the client's job (§1.1 gives the server
 * authority over decisions, not over rendering). One mapping in one module
 * keeps that true without a column that would have to be kept in step with the
 * MIME allow-list.
 *
 * ## The level index lists only Levels that HOLD content
 *
 * It used to list every Level the calendar bootstrap publishes, so the index
 * offered a card for each of the twenty-one whether or not any held an item, and
 * every empty one opened onto nothing. A directory that lists what does not
 * exist is worse than a short directory: it spends the reader's attention on
 * doors that do not open.
 *
 * The index is now **derived from the library rows themselves**. `GET /library`
 * carries the §5.2 headings on every row, so grouping them *is* the index — and
 * the counts §5.2's cards asked for come with it rather than being approximated
 * or omitted. The read is paged and bounded; see `fetchAllLibraryRows`.
 */

/* ── The contract shape ──────────────────────────────────────────────────── */

/**
 * How a file is *presented*, derived server-side from its MIME type.
 *
 * A presentation class rather than a file extension, because §14.6 defines
 * behaviour per class: PDFs open inline, audio and video play in place, images
 * open in a lightbox, and **office files are download-only in the MVP**. The
 * client should never have to map MIME strings to behaviour itself — one
 * mapping, server-side, is what keeps a new accepted MIME type from silently
 * rendering as "unknown" in the interface.
 */
export type ContentKind = 'pdf' | 'video' | 'audio' | 'image' | 'document';

export interface ContentItem {
  id: string;
  title: string;
  description: string | null;
  kind: ContentKind;
  /** The declared MIME type, for the `<source>` element and the download name. */
  mime_type: string;
  /** Bytes. `null` where the size is genuinely unknown rather than zero. */
  size_bytes: number | null;
  /** Publication date, `YYYY-MM-DD` local calendar date (TD-11) — never an instant. */
  published_on: string;
  /**
   * **Already resolved by the backend**, per §7's Public display identity
   * invariant — the single statement of that rule. Render it verbatim; this type
   * deliberately carries no other name field, so there is nothing here to choose
   * between (§20 rule 21).
   *
   * `null` where no instructor is attributed to the item.
   */
  teacher_display_name: string | null;
  /** Optional subject label. A BADGE, not a hierarchy tier — see the note in
   *  `resources.tsx` about §5.2's third tier. */
  subject_name: string | null;
}

export interface BranchGroup {
  /** `null` is the Global / بدون فرع scope (§4.9, BR-20), which sorts first. */
  branch_id: string | null;
  branch_name: string | null;
  items: ContentItem[];
}

export interface YearGroup {
  academic_year_id: string;
  /** `YYYY-YYYY` (TD-6). */
  label: string;
  is_current: boolean;
  branches: BranchGroup[];
}

/** One level as it appears on the library index. */
export interface LevelSummary {
  level_id: string;
  level_name: string;
  category_id: string;
  category_name: string;
  description: string | null;
  /**
   * Real counts, from the rows the index is built out of.
   *
   * They were `null` while the index came from the calendar bootstrap, where no
   * aggregate existed and page-one arithmetic would have been a guess. Counting
   * the content the index is *derived from* is not a guess — and a Level with a
   * count of zero never appears at all, because it is not in the library.
   */
  content_count: number | null;
  academic_year_count: number | null;
}

export interface LevelContent {
  level_id: string;
  level_name: string;
  category_name: string;
  description: string | null;
  years: YearGroup[];
}

/* ── The two calls the pages make ────────────────────────────────────────── */

/**
 * Page 1: every level that currently HAS content, with its counts.
 *
 * One request rather than one per level — the counts are what the cards show, and
 * fetching them per level would be an N+1 on a public page.
 *
 * **Levels with no content are absent from the response, not filtered here.** A
 * client filtering a list it was handed is the pattern §4.4 forbids for the
 * calendar's levels, and the same reasoning applies: the server decides what
 * exists.
 */
export async function fetchContentLevels(): Promise<LevelSummary[]> {
  // **Derived from the content itself, not from the curriculum.**
  //
  // This used to list every Level the calendar bootstrap publishes, so the index
  // offered a card for each of the twenty-one Levels whether or not any held a
  // single item — and every empty one opened onto nothing. A directory that
  // lists what does not exist is worse than a short directory: it spends the
  // reader's attention on doors that do not open.
  //
  // `GET /library` already carries the §5.2 headings on every row
  // (`level_name`, `category_id`, `category_name`), so grouping the rows *is*
  // the index, and the counts come with it rather than being approximated. The
  // server still decides what exists — the tier rules, the BR-2 consent gate
  // and the §5.2 ordering are all applied before this sees a row.
  const rows = await fetchAllLibraryRows();

  const byLevel = new Map<string, LevelSummary & { years: Set<string> }>();
  for (const row of rows) {
    let entry = byLevel.get(row.level_id);
    if (!entry) {
      entry = {
        level_id: row.level_id,
        level_name: row.level_name,
        category_id: row.category_id,
        category_name: row.category_name,
        description: null,
        content_count: 0,
        academic_year_count: 0,
        years: new Set<string>(),
      };
      byLevel.set(row.level_id, entry);
    }
    entry.content_count = (entry.content_count ?? 0) + 1;
    entry.years.add(row.academic_year_id);
  }

  return [...byLevel.values()].map(({ years, ...level }) => ({
    ...level,
    // **Real counts now, not `null`.** The earlier note said no aggregate
    // existed and an approximation would be worse than an absence — true while
    // the index came from the bootstrap. Counting the rows the index is built
    // from is not an approximation.
    academic_year_count: years.size,
  }));
}

/**
 * Every library row the caller may see, paged through.
 *
 * **Bounded, and the bound is stated rather than hidden.** TD-10 caps a page at
 * 100, and the index must not miss a Level merely because its content sorts
 * late — so this follows `meta.total` rather than reading one page and hoping.
 * The ceiling exists because an unbounded loop on a public screen is a denial of
 * service waiting for a large library; at that size the index becomes a server
 * aggregate, which is a contract change and is recorded rather than guessed at.
 */
const MAX_INDEX_PAGES = 10;

async function fetchAllLibraryRows(): Promise<LibraryItemWire[]> {
  const rows: LibraryItemWire[] = [];
  let page = 1;
  let total = Infinity;
  while (rows.length < total && page <= MAX_INDEX_PAGES) {
    const body = await api<{ data: LibraryItemWire[]; meta: { total: number } }>(
      `/library?page=${String(page)}&page_size=${String(MAX_PAGE_SIZE)}`,
    );
    total = body.meta.total;
    rows.push(...body.data);
    if (body.data.length === 0) break;
    page += 1;
  }
  return rows;
}

/** TD-10 caps a page at 100. The library is filtered to one Level here, so this
 *  is a bound on how much one Level may hold before the view truncates — stated
 *  rather than assumed infinite. */
const MAX_PAGE_SIZE = 100;

/** §14.6 maps a MIME type to how the item is PRESENTED. Unknown types fall to
 *  `document`, which is download-only — the safe end of the range. */
export function kindOf(mime: string): ContentKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'document';
}

/** One item as `GET /library` sends it (TD-3.13). */
interface LibraryItemWire {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  level_id: string;
  subject_id: string;
  academic_year_id: string;
  branch_id: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  category_id: string;
  category_name: string;
  level_name: string;
  subject_name: string;
  academic_year_label: string;
  branch_name: string | null;
}

/**
 * Page 2: one level's content, grouped **year → branch** (§5.2).
 *
 * **The grouping is done here, from a flat list.** TD-3.13 specifies one
 * filtered paginated route and no nested shape, so the hierarchy §5.2 describes
 * is a rendering of what the server returned — not a second contract. The
 * server still decides *which items exist*: the tier rules, the BR-2 consent
 * gate and the own-branch-first ordering are all applied before this sees a row.
 *
 * **Branch order is preserved from the response, not re-sorted.** §5.2 orders
 * own branch → Global → other branches for a signed-in reader, and that decision
 * is the server's; re-sorting here would be a second implementation of it.
 */
export async function fetchLevelContent(levelId: string): Promise<LevelContent | null> {
  const body = await api<{ data: LibraryItemWire[]; meta: { total: number } }>(
    `/library?level_id=${encodeURIComponent(levelId)}&page_size=${MAX_PAGE_SIZE}`,
  );
  const rows = body.data;
  if (rows.length === 0) return null;

  const years: YearGroup[] = [];
  for (const row of rows) {
    let year = years.find((y) => y.academic_year_id === row.academic_year_id);
    if (!year) {
      year = {
        academic_year_id: row.academic_year_id,
        label: row.academic_year_label,
        // No public source says which year is current, and guessing from the
        // label would be a second answer to a question `is_current` already
        // owns. Absent is the honest value.
        is_current: false,
        branches: [],
      };
      years.push(year);
    }
    let branch = year.branches.find((b) => b.branch_id === row.branch_id);
    if (!branch) {
      branch = { branch_id: row.branch_id, branch_name: row.branch_name, items: [] };
      year.branches.push(branch);
    }
    branch.items.push({
      id: row.id,
      title: row.title,
      description: row.description,
      kind: kindOf(row.mime_type),
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      // TD-11: an upload is an instant; the card shows the calendar date of it.
      published_on: row.created_at.slice(0, 10),
      // `EducationalContent` records no uploader — see the note at the top.
      teacher_display_name: null,
      subject_name: row.subject_name,
    });
  }

  const first = rows[0]!;
  return {
    level_id: levelId,
    level_name: first.level_name,
    category_name: first.category_name,
    description: null,
    years,
  };
}

/**
 * The download or preview URL for one item.
 *
 * In production this is **not** a URL the client can construct. Private content
 * is reachable only through a short-lived presigned GET minted after a
 * server-side permission check (§3.1, TD-12), which is why this is an async call
 * and not a field on `ContentItem`: a URL that expires in ten minutes must be
 * fetched when it is used, not when the list is drawn.
 */
export async function fetchContentUrl(
  contentId: string,
  token?: string | null,
  activeChildId?: string | null,
): Promise<string | null> {
  try {
    const body = await api<{ url: string; expires_in: number }>(
      `/content/${encodeURIComponent(contentId)}/download-url`,
      { ...(token ? { token } : {}), ...(activeChildId ? { activeChildId } : {}) },
    );
    return body.url;
  } catch {
    // §4.9's tiers are applied server-side and out-of-scope content answers 404
    // rather than 403 (§20 rule 17), so a refusal here is indistinguishable from
    // a missing item **by design**. `null` is what the preview dialog already
    // renders as "not available", and the client must not try to say more —
    // guessing which of the two it was is exactly the existence leak the uniform
    // status exists to close.
    return null;
  }
}


/**
 * `GET /library/{id}/sessions` — **which class sessions reference this content.**
 *
 * `SessionContent` read backwards. §4.9 says content is *referenced, never
 * owned* — *"one semester PDF is referenced by every session that uses it"* — and
 * this is the other half of that sentence. **No new relationship**: it projects
 * rows the join already holds.
 *
 * **The content gates; the sessions do not.** An item the caller may not see
 * answers `404` (never an empty list, which would confirm the id exists), while
 * the occurrences returned are the public timetable R43 made browsable — in the
 * very shape `GET /calendar` returns.
 */
export async function fetchContentSessions(
  contentId: string,
  token: string | null,
): Promise<Occurrence[]> {
  return (
    await api<{ data: Occurrence[] }>(`/library/${contentId}/sessions`, { token })
  ).data;
}
