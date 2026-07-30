/**
 * The educational-content adapter (§4.9, §5.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THE IMPLEMENTATION IN THIS FILE IS A TEMPORARY MOCK. THE INTERFACE IS NOT.
 *
 * No content endpoint exists yet: TD-3.5 defines the three upload routes and
 * `GET /content/{id}/download-url`, and **no route anywhere in the SRS lists
 * content**. Adding one requires a Document Owner revision (§20 rule 16;
 * Revision 21 — later milestones add endpoints through subsequent revisions), so
 * it is not invented here.
 *
 * What IS built here is the shape the production adapter will have. Every type
 * below is written as the API response it expects to parse, in `snake_case`, so
 * that swapping the mock for real `api()` calls is a change to the two exported
 * functions and to nothing else — no component, no page and no test touches the
 * mock directly.
 *
 * **Read `MOCK` as "not yet wired", never as "this is how it behaves".** The
 * production behaviour is whatever the approved revision specifies; the numbers
 * and titles below are placeholders chosen to exercise the layout (a level with
 * one year, a level with several, a year with two branches, global content, every
 * previewable type, and a download-only type).
 * ─────────────────────────────────────────────────────────────────────────────
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
  content_count: number;
  academic_year_count: number;
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
  return mockDelay(MOCK_LEVELS);
}

/** Page 2: one level's content, grouped year → branch. */
export async function fetchLevelContent(levelId: string): Promise<LevelContent | null> {
  const found = MOCK_LEVEL_CONTENT[levelId] ?? null;
  return mockDelay(found);
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
  return mockDelay(MOCK_URLS[contentId] ?? null);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MOCK DATA — TEMPORARY. Everything below this line is deleted when the
 * endpoints land. Nothing above it changes.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A short delay so loading states and skeletons are actually exercised in
 *  development rather than never rendering. */
function mockDelay<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), 350);
  });
}

const CAT_ADULT = { id: 'cat-adult', name: 'الكبار' };
const CAT_TEEN = { id: 'cat-teen', name: 'اليافعون' };
const CAT_CHILD = { id: 'cat-child', name: 'الطفل' };

const MOCK_LEVELS: LevelSummary[] = [
  {
    level_id: 'lvl-a1',
    level_name: 'المستوى الأول',
    category_id: CAT_ADULT.id,
    category_name: CAT_ADULT.name,
    description: 'حفظ جزء البقرة مع التجويد التطبيقي.',
    content_count: 6,
    academic_year_count: 2,
  },
  {
    level_id: 'lvl-a0',
    level_name: 'محو الأمية',
    category_id: CAT_ADULT.id,
    category_name: CAT_ADULT.name,
    description: 'دروس القراءة والكتابة للمبتدئات.',
    content_count: 2,
    academic_year_count: 1,
  },
  {
    level_id: 'lvl-t2',
    level_name: 'المستوى الثاني',
    category_id: CAT_TEEN.id,
    category_name: CAT_TEEN.name,
    description: null,
    content_count: 3,
    academic_year_count: 1,
  },
  {
    level_id: 'lvl-c1',
    level_name: 'المستوى الأول',
    category_id: CAT_CHILD.id,
    category_name: CAT_CHILD.name,
    description: 'أناشيد وقصص قرآنية للأطفال.',
    content_count: 1,
    academic_year_count: 1,
  },
];

const item = (over: Partial<ContentItem> & Pick<ContentItem, 'id' | 'title' | 'kind'>): ContentItem => ({
  description: null,
  mime_type: 'application/pdf',
  size_bytes: 1_240_000,
  published_on: '2026-06-12',
  teacher_display_name: 'أم عبد الله',
  subject_name: null,
  ...over,
});

const MOCK_LEVEL_CONTENT: Record<string, LevelContent> = {
  'lvl-a1': {
    level_id: 'lvl-a1',
    level_name: 'المستوى الأول',
    category_name: CAT_ADULT.name,
    description: 'حفظ جزء البقرة مع التجويد التطبيقي.',
    years: [
      {
        academic_year_id: 'ay-2627',
        label: '2026-2027',
        is_current: true,
        branches: [
          {
            // Global scope sorts first (§5.2, BR-20).
            branch_id: null,
            branch_name: null,
            items: [
              item({
                id: 'c-1',
                title: 'دليل التجويد المصوّر',
                kind: 'pdf',
                description: 'ملخص أحكام النون الساكنة والتنوين.',
                subject_name: 'تفسير',
                size_bytes: 2_600_000,
                published_on: '2026-07-02',
              }),
            ],
          },
          {
            branch_id: 'br-amerchich',
            branch_name: 'مقر أمرشيش',
            items: [
              item({
                id: 'c-2',
                title: 'حلقة المراجعة — تسجيل الجلسة',
                kind: 'audio',
                mime_type: 'audio/mpeg',
                size_bytes: 18_400_000,
                published_on: '2026-06-28',
                description: 'تسجيل صوتي لحلقة المراجعة الأسبوعية.',
              }),
              item({
                id: 'c-3',
                title: 'شرح مخارج الحروف',
                kind: 'video',
                mime_type: 'video/mp4',
                size_bytes: 74_900_000,
                published_on: '2026-06-20',
                teacher_display_name: 'أم يوسف',
              }),
              item({
                id: 'c-4',
                title: 'ورقة تمارين الأسبوع',
                kind: 'document',
                mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                size_bytes: 96_000,
                published_on: '2026-06-18',
              }),
            ],
          },
          {
            branch_id: 'br-targa',
            branch_name: 'مقر تاركة',
            items: [
              item({
                id: 'c-5',
                title: 'لوحة الحروف',
                kind: 'image',
                mime_type: 'image/png',
                size_bytes: 540_000,
                published_on: '2026-06-15',
                teacher_display_name: null,
              }),
            ],
          },
        ],
      },
      {
        academic_year_id: 'ay-2526',
        label: '2025-2026',
        is_current: false,
        branches: [
          {
            branch_id: 'br-amerchich',
            branch_name: 'مقر أمرشيش',
            items: [
              item({
                id: 'c-6',
                title: 'مذكّرة الدورة الأولى',
                kind: 'pdf',
                published_on: '2025-11-04',
                size_bytes: 830_000,
              }),
            ],
          },
        ],
      },
    ],
  },
  'lvl-a0': {
    level_id: 'lvl-a0',
    level_name: 'محو الأمية',
    category_name: CAT_ADULT.name,
    description: 'دروس القراءة والكتابة للمبتدئات.',
    years: [
      {
        academic_year_id: 'ay-2627',
        label: '2026-2027',
        is_current: true,
        branches: [
          {
            branch_id: 'br-targa',
            branch_name: 'مقر تاركة',
            items: [
              item({ id: 'c-7', title: 'كرّاسة الحروف', kind: 'pdf', size_bytes: 410_000 }),
              item({
                id: 'c-8',
                title: 'نطق الحروف — تسجيل',
                kind: 'audio',
                mime_type: 'audio/webm',
                size_bytes: 6_100_000,
              }),
            ],
          },
        ],
      },
    ],
  },
  'lvl-t2': {
    level_id: 'lvl-t2',
    level_name: 'المستوى الثاني',
    category_name: CAT_TEEN.name,
    description: null,
    years: [
      {
        academic_year_id: 'ay-2627',
        label: '2026-2027',
        is_current: true,
        branches: [
          {
            branch_id: 'br-amerchich',
            branch_name: 'مقر أمرشيش',
            items: [
              item({ id: 'c-9', title: 'مقرر الفقه', kind: 'pdf' }),
              item({
                id: 'c-10',
                title: 'مراجعة سورة الكهف',
                kind: 'audio',
                mime_type: 'audio/mp4',
                size_bytes: 12_000_000,
              }),
              item({
                id: 'c-11',
                title: 'صور من النشاط السنوي',
                kind: 'image',
                mime_type: 'image/jpeg',
                size_bytes: 1_900_000,
              }),
            ],
          },
        ],
      },
    ],
  },
  'lvl-c1': {
    level_id: 'lvl-c1',
    level_name: 'المستوى الأول',
    category_name: CAT_CHILD.name,
    description: 'أناشيد وقصص قرآنية للأطفال.',
    years: [
      {
        academic_year_id: 'ay-2627',
        label: '2026-2027',
        is_current: true,
        branches: [
          {
            branch_id: null,
            branch_name: null,
            items: [
              item({
                id: 'c-12',
                title: 'نشيد الحروف',
                kind: 'audio',
                mime_type: 'audio/mpeg',
                size_bytes: 3_200_000,
              }),
            ],
          },
        ],
      },
    ],
  },
};

/**
 * Placeholder URLs. Deliberately **empty strings** rather than links to real
 * media: a mock that fetched from an external host would be blocked by §3.1's
 * CSP anyway, and pointing at a fake file would make the viewer look broken
 * rather than unwired. The preview dialog therefore renders its "preview not
 * available yet" state, which is itself worth seeing.
 */
const MOCK_URLS: Record<string, string> = {};
