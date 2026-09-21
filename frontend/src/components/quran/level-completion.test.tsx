import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { LevelCoverage } from '../../adapters/quran.js';
import { LevelCompletionSummary } from './level-completion.js';
import studentPage from '../../pages/dashboard/quran.tsx?raw';
import workspace from './quran-workspace.tsx?raw';

/**
 * SRS Revision 166 §1 — Level completion (BR-11). The verdict is the server's
 * (`policies/level-completion.ts`, integration-tested); these hold the screen to
 * SAYING it, and to naming what is still missing rather than only «لم يكتمل».
 */
const surah = (
  id: number,
  name: string,
  percent: number,
  examTaken: boolean,
): LevelCoverage['surahs'][number] => ({
  surah_id: id,
  name_arabic: name,
  total_ayahs: 7,
  merged_ayah_count: Math.round((percent / 100) * 7),
  coverage_percent: percent,
  merged_intervals: [],
  revision_log_count: 0,
  last_revised_at: null,
  exam_taken: examTaken,
});

const level = (over: Partial<LevelCoverage>): LevelCoverage => ({
  level_id: 'l-1',
  level_name: 'المستوى 1',
  category_name: 'المرأة',
  surahs: [],
  ...over,
});

const html = (l: LevelCoverage): string => renderToStaticMarkup(<LevelCompletionSummary level={l} />);

describe('what she is told about her Level', () => {
  it('«أتمّت المستوى» when every Surah is memorised AND examined', () => {
    const out = html(
      level({
        surahs: [surah(1, 'الفاتحة', 100, true)],
        completion: {
          complete: true,
          configured_surahs: 1,
          memorised_surahs: 1,
          examined_surahs: 1,
          exams_required: true,
        },
      }),
    );
    expect(out).toContain('أتمّت المستوى');
    expect(out).toContain('الحفظ: 1 من 1 سورة');
    expect(out).toContain('اختبارات التفسير: 1 من 1 سورة');
    expect(out).not.toContain('بقي');
  });

  it('names WHICH Surahs are left to memorise and which still need their تفسير exam', () => {
    const out = html(
      level({
        surahs: [surah(1, 'الفاتحة', 100, false), surah(2, 'البقرة', 40, true)],
        completion: {
          complete: false,
          configured_surahs: 2,
          memorised_surahs: 1,
          examined_surahs: 1,
          exams_required: true,
        },
      }),
    );
    expect(out).toContain('لم يكتمل المستوى بعد');
    expect(out).toContain('بقي للحفظ: البقرة');
    expect(out).toContain('بقي اختبار التفسير في: الفاتحة');
  });

  it('does not mention exams for a Level that teaches no تفسير — memorisation alone completes it', () => {
    const out = html(
      level({
        surahs: [surah(1, 'الفاتحة', 100, false)],
        completion: {
          complete: true,
          configured_surahs: 1,
          memorised_surahs: 1,
          examined_surahs: 0,
          exams_required: false,
        },
      }),
    );
    expect(out).toContain('أتمّت المستوى');
    expect(out).not.toContain('اختبارات التفسير');
    expect(out).not.toContain('بقي اختبار');
  });

  it('a Level with no «مقرر الحفظ» is neither complete nor incomplete', () => {
    const out = html(
      level({
        completion: {
          complete: null,
          configured_surahs: 0,
          memorised_surahs: 0,
          examined_surahs: 0,
          exams_required: false,
        },
      }),
    );
    expect(out).toContain('لم يُضبط «مقرر الحفظ» لهذا المستوى بعد');
    expect(out).not.toContain('أتمّت');
  });

  it('says nothing at all when the server did not send a verdict — never a guessed «لم يكتمل»', () => {
    expect(html(level({ surahs: [surah(1, 'الفاتحة', 100, true)] }))).toBe('');
  });
});

describe('where it is shown', () => {
  it('on «حفظي», per Level, above that Level’s Surahs', () => {
    expect(studentPage).toContain('<LevelCompletionSummary level={level} />');
  });

  it('and on the مؤطِّرة’s Quran screen, through the SAME component', () => {
    expect(workspace).toContain('<LevelCompletionSummary level={level} />');
    expect(workspace).toContain('setLevelCoverage(data.levels ?? []);');
  });
});
