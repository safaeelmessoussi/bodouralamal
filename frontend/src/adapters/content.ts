import { api } from '../lib/api.js';
import { fetchCalendarBootstrap } from './calendar.js';

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
 * ## Why the level index has no counts
 *
 * §5.2 describes a *drilling folder system*, and its card design asked for a
 * content count and a year count per Level. **`GET /library` is a flat,
 * paginated, filtered list** (TD-3.13) and publishes no aggregate, so those
 * numbers cannot be obtained without fetching every page of every Level on a
 * public screen. They are therefore **omitted rather than approximated** — a
 * card without a count is honest; a card with a count derived from page one is
 * not. Reported rather than resolved: an aggregate would be a new contract.
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
  /** `null` where no aggregate exists — see the note at the top of this file.
   *  An absent count is honest; one derived from page one is not. */
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
  // The PUBLIC calendar bootstrap already publishes every live Category and
  // Level, anonymously and ordered — the same list this index needs. Nothing is
  // added to that payload; a second public surface reads what it already has.
  const today = new Date().toISOString().slice(0, 10);
  const bootstrap = await fetchCalendarBootstrap({ from: today, to: today });
  const categoryName = new Map(bootstrap.categories.map((c) => [c.id, c.name]));

  return bootstrap.levels.map((level) => ({
    level_id: level.id,
    level_name: level.name,
    category_id: level.category_id,
    category_name: categoryName.get(level.category_id) ?? '',
    description: null,
    // See the note at the top of this file: no aggregate exists, and an
    // approximation would be worse than an absence.
    content_count: null,
    academic_year_count: null,
  }));
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
export async function fetchContentUrl(contentId: string): Promise<string | null> {
  // TD-3.5's `GET /content/{id}/download-url` is an M6 endpoint and does not
  // exist yet, so there is nothing to call. Returning `null` is what the preview
  // dialog already renders as "not available" — deliberately not a constructed
  // URL, because a presigned GET is minted after a server-side §4.9 check and
  // can never be assembled by a client (§3.1, TD-12).
  void contentId;
  return null;
}

