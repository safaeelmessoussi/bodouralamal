import { describe, expect, it, vi, afterEach } from 'vitest';

import CONTENT_PAGE from './content.tsx?raw';
import UPLOAD_FORM from '../components/content/content-upload-form.tsx?raw';
import { defaultVisibilityForLevel } from '../hooks/use-scope-options.js';
import { uploadFile } from '../adapters/uploads.js';
import { t } from '../i18n/index.js';

/**
 * §14.1's visibility selection on the Content Upload screen.
 *
 * **The defect these exist for:** the service accepted `meta.visibility`, the
 * client type declared it, the Arabic labels existed for the table column — and
 * no control ever emitted a value. The Category default silently always won, so
 * an Owner uploading on Staging could not produce private content and had no way
 * to see why. Nothing failed; the wrong thing simply happened quietly.
 *
 * They are written against the two seams that decide the outcome — what the
 * default resolves to, and what actually reaches the wire — rather than against
 * the rendered markup, because markup can display a value the request does not
 * carry, which is precisely the shape of the original defect.
 */

const LEVELS = [
  { id: 'lvl-adults', category_id: 'cat-adults', default_visibility: 'public' },
  { id: 'lvl-child', category_id: 'cat-child', default_visibility: 'private' },
  { id: 'lvl-hidden', category_id: 'cat-staff', default_visibility: 'hidden' },
  // A Level from an older payload that predates the field.
  { id: 'lvl-legacy', category_id: 'cat-legacy' },
] as never as Parameters<typeof defaultVisibilityForLevel>[0];

describe('the default the screen proposes is the Category’s, truthfully', () => {
  it('proposes the Category default for the chosen Level', () => {
    expect(defaultVisibilityForLevel(LEVELS, 'lvl-adults')).toBe('public');
    expect(defaultVisibilityForLevel(LEVELS, 'lvl-child')).toBe('private');
    expect(defaultVisibilityForLevel(LEVELS, 'lvl-hidden')).toBe('hidden');
  });

  it('proposes NOTHING before a Level is chosen', () => {
    // Not `public`. A dialog that preselected the open tier while the lists were
    // still arriving would publish content because a request was slow.
    expect(defaultVisibilityForLevel(LEVELS, '')).toBeNull();
  });

  it('proposes nothing when the Level list has not arrived, rather than guessing', () => {
    expect(defaultVisibilityForLevel([] as never, 'lvl-adults')).toBeNull();
  });

  it('proposes nothing for a payload that predates the field', () => {
    // Never `public` on absence — an older cached response must not become a
    // silent instruction to publish.
    expect(defaultVisibilityForLevel(LEVELS, 'lvl-legacy')).toBeNull();
  });
});

/* ── What actually reaches the wire ──────────────────────────────────────── */

const initiated = {
  upload_id: 'ticket',
  key: 'staging/content/x/y/f.pdf',
  put_url: 'https://staging.example/storage/public/staging/content/x/y/f.pdf',
  expires_in: 3600,
};

/** Captures the `content_meta` the adapter sends to `/uploads/initiate`. */
function captureInitiate(): { meta: () => Record<string, unknown> } {
  let sent: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/uploads/initiate')) {
        sent = (JSON.parse(String(init?.body)) as { content_meta: Record<string, unknown> })
          .content_meta;
        return new Response(JSON.stringify({ data: initiated }), { status: 201 });
      }
      if (String(url).endsWith('/complete')) {
        return new Response(JSON.stringify({ data: { id: 'new-id' } }), { status: 201 });
      }
      return new Response(null, { status: 200 });
    }),
  );
  // The PUT goes through XMLHttpRequest for progress, which jsdom does not run
  // here; the adapter's own upload step is stubbed so these assertions stay on
  // the request under test.
  return { meta: () => sent };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function initiateWith(meta: Record<string, unknown>): Promise<Record<string, unknown>> {
  const capture = captureInitiate();
  vi.stubGlobal('XMLHttpRequest', class {
    upload = { addEventListener: (): void => undefined };
    open(): void {}
    setRequestHeader(): void {}
    addEventListener(event: string, cb: () => void): void {
      if (event === 'load') setTimeout(cb, 0);
    }
    send(): void {}
    status = 200;
  });
  await uploadFile(
    new File(['x'], 'f.pdf', { type: 'application/pdf' }),
    meta as never,
    { title: 'T', description: null },
    'token',
    () => undefined,
    () => undefined,
  ).catch(() => undefined);
  return capture.meta();
}

describe('the chosen tier is the tier that is sent', () => {
  const base = {
    level_id: 'lvl-adults',
    subject_id: 's',
    academic_year_id: 'y',
    branch_id: 'b',
  };

  it('sends private when private is chosen', async () => {
    expect((await initiateWith({ ...base, visibility: 'private' }))['visibility']).toBe('private');
  });

  it('sends hidden when hidden is chosen', async () => {
    expect((await initiateWith({ ...base, visibility: 'hidden' }))['visibility']).toBe('hidden');
  });

  it('sends public when public is chosen', async () => {
    expect((await initiateWith({ ...base, visibility: 'public' }))['visibility']).toBe('public');
  });

  it('omits it entirely when the screen genuinely does not know it', async () => {
    // The server's Category fallback remains the contract for other callers;
    // what must never happen is the screen SHOWING one tier and sending another.
    expect('visibility' in (await initiateWith(base))).toBe(false);
  });
});

/* ── Replacement must not become a visibility or scope change ────────────── */

describe('replacement changes the object, never the tier or the scope', () => {
  it('the replace dialog passes `replacing`, which locks every determining field', () => {
    const replace = readSource().slice(readSource().indexOf('open={replacing !== null}'));
    expect(replace).toContain('replacing={{');
  });

  it('a locked form omits visibility from the payload entirely', () => {
    // R53 swaps the object and keeps the record, so the row's own tier stays
    // authoritative. The guard is the `locked` arm of the meta builder.
    const src = form();
    const meta = src.slice(src.indexOf('const meta = useMemo'), src.indexOf('const problem'));
    expect(meta).toContain('visibility === null || locked');
    expect(meta).toContain('replaces_content_id');
  });

  it('locks every scope field rather than hiding them', () => {
    // The rule is that a determining field is never hidden — «this is fixed» is
    // exactly what a hidden field cannot say.
    expect(form()).toContain('locked: FIELDS');
    expect(form()).toContain('disabled={locked}');
  });
});

/* ── The consent safeguard is not reachable from this form ───────────────── */

describe('consent-forced private cannot be overridden here', () => {
  it('the upload form never sends consent_forced_private', () => {
    // BR-2 owns that flag. A form that could set or clear it would be a
    // publication override, which is BR-3's separate Admin-with-justification
    // workflow and deliberately not this slice.
    //
    const src = form();
    expect(src).not.toContain('consent_forced_private');
    const meta = src.slice(src.indexOf('const meta = useMemo'), src.indexOf('const problem'));
    expect(meta).toContain('visibility');
  });

  it('uses the platform’s existing tier vocabulary rather than a second one', () => {
    expect(t('content.visibility.public')).toBe('عام');
    expect(t('content.visibility.private')).toBe('خاص');
    expect(t('content.visibility.hidden')).toBe('مخفي');
  });
});

/** The screen's CODE, comments stripped — the project's existing idiom.
 *  Stripping matters here: the file explains in prose why the consent flag is
 *  absent, and an assertion that tripped on the explanation would teach the
 *  next author to delete the explanation rather than keep the property. */
/** The self-contained upload form's CODE, comments stripped. */
function form(): string {
  return UPLOAD_FORM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function readSource(): string {
  return CONTENT_PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
