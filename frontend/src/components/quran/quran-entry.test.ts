import { describe, expect, it } from 'vitest';

import workspace from './quran-workspace.tsx?raw';
import adminPage from '../../pages/admin/quran.tsx?raw';
import teacherPage from '../../pages/teacher/quran.tsx?raw';
import studentPage from '../../pages/dashboard/quran.tsx?raw';
import progressBar from '../ui/progress-bar.tsx?raw';

/** Every source in the app, for the "nobody else does this" sweeps. */
const sources = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * **Section C's front end, pinned at the properties that would fail silently.**
 *
 * Every assertion here exists because the opposite has actually shipped on this
 * project: a second copy of a shared screen, an error rendered as an empty
 * list, a percentage computed in the client, a curriculum ignored in favour of
 * all 114 Surahs.
 */
describe('§C2 — one workspace, every portal that enters progress', () => {
  it('the back office and the teaching portal render the SAME component', () => {
    for (const page of [adminPage, teacherPage]) {
      expect(page).toContain('QuranWorkspace');
    }
    // Neither owns a form of its own: the selectors, the validation and the
    // save live in one place (rule C).
    for (const page of [adminPage, teacherPage]) {
      expect(stripComments(page)).not.toContain('SelectField');
      expect(stripComments(page)).not.toContain('logProgress');
    }
  });

  it('is the only component that writes a Quran log', () => {
    const writers = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.'))
      .filter(([path]) => !path.includes('adapters/quran'))
      .filter(([, text]) => /\blogProgress\s*\(/.test(stripComments(text)))
      .map(([path]) => path);
    expect(writers).toEqual(['./quran-workspace.tsx']);
  });
});

describe('§C11 — the Surah list comes from the Level curriculum', () => {
  it('never enumerates all 114 Surahs', () => {
    // The old form built `Array.from({ length: 114 })`. `LevelSurah` decides
    // which Surahs a Level teaches, so a fixed 114 ignores the curriculum.
    expect(stripComments(workspace)).not.toContain('114');
    expect(stripComments(workspace)).toContain('level?.surahs');
  });

  it('sends the Level with the entry, so the server can refuse a forged one', () => {
    expect(stripComments(workspace)).toContain('level_id: levelId');
  });

  it('opens a single Level directly and asks when there are several (§C10)', () => {
    const body = stripComments(workspace);
    expect(body).toContain('levels.length === 1');
    expect(body).toContain('levels.length > 1');
    // Never the first enrolment silently.
    expect(body).not.toMatch(/level_ids\s*\[\s*0\s*\]/);
  });
});

describe('§C12 — ayah bounds are advisory here and authoritative on the server', () => {
  it('reads the ayah count from the server payload, never a table in React', () => {
    const body = stripComments(workspace);
    expect(body).toContain('surah.total_ayahs');
    // A hard-coded count would be a second source for the 114 seeded rows.
    expect(body).not.toMatch(/\b286\b/);
  });

  it('names each refusal the server can return', () => {
    for (const reason of [
      'AYAH_OUT_OF_RANGE',
      'INVALID_RANGE',
      'SURAH_NOT_IN_LEVEL',
      'LEVEL_NOT_ENROLLED',
    ]) {
      expect(workspace).toContain(reason);
    }
  });
});

describe('§C29 — a failed read is never an empty roster', () => {
  it('the workspace distinguishes loading, error and empty', () => {
    const body = stripComments(workspace);
    // The defect this replaces: `catch { setStudents([]) }`.
    expect(body).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*set\w+\(\[\]\)/);
    expect(body).toContain("setScopeState('error')");
    expect(body).toContain('role="alert"');
  });

  it('حفظي does the same', () => {
    const body = stripComments(studentPage);
    expect(body).toContain("setState('error')");
    expect(body).toContain('role="alert"');
    expect(body).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*set\w+\(\[\]\)/);
  });
});

describe('§C15/§C16 — the shared meter, and no percentage computed in the client', () => {
  it('exposes the full ARIA meter contract', () => {
    for (const attr of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'role="progressbar"']) {
      expect(progressBar).toContain(attr);
    }
    // The figure is never conveyed by the coloured strip alone.
    expect(progressBar).toContain('aria-valuetext');
  });

  it('is generic — it knows nothing about Surahs or ayahs', () => {
    const body = stripComments(progressBar).toLowerCase();
    for (const word of ['surah', 'ayah', 'quran']) {
      expect(body).not.toContain(word);
    }
  });

  // **The RTL/CSS invariant lives in `scripts/ci/check-progress-css.sh`.**
  // `?raw` on a `.css` file yields `''` under this vitest setup, so a guard
  // written here would pass while reading nothing — the exact defect
  // `CLAUDE.md` records. It was written here first and caught by its own
  // non-empty assertion, which is the only reason it is not still passing
  // vacuously.

  it('حفظي renders the shared bar and computes no percentage itself', () => {
    expect(studentPage).toContain('ProgressBar');
    const body = stripComments(studentPage);
    // Every figure is the server's `coverage_percent`; nothing divides here.
    expect(body).not.toMatch(/merged_ayah_count\s*\/\s*/);
    expect(body).toContain('s.coverage_percent');
  });

  it('nobody hand-writes a progress meter beside the shared one', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.') && !path.includes('ui/progress-bar'))
      .filter(([, text]) => /role="progressbar"/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe('§C17 — حفظي groups by Level and keeps the curricula apart', () => {
  it('renders each Level as its own section, through the shared label', () => {
    const body = stripComments(studentPage);
    expect(body).toContain('levels.map');
    expect(body).toContain('levelLabel');
    // Rule D — never a hand-written em dash between category and level.
    expect(body).not.toMatch(/category_name\}\s*—/);
  });

  it('shows syllabus Surahs that are still at zero', () => {
    // The server sends them; the page must not filter them out, or a مستفيدة
    // could not see what remains.
    const body = stripComments(studentPage);
    expect(body).not.toMatch(/surahs\.filter\([^)]*coverage_percent\s*>/);
  });

  it('keeps the history, but after the progress (§C18)', () => {
    const body = stripComments(studentPage);
    expect(body.indexOf('SurahBars')).toBeLessThan(body.indexOf("t('student.quran.history')"));
  });
});
