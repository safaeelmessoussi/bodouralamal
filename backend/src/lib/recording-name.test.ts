import { describe, expect, it } from 'vitest';

import { moroccoWallClockToInstant } from './morocco-clock.js';
import {
  localDateIso,
  nextRecordingName,
  recordingBaseName,
  sessionRecordingBaseName,
} from './recording-name.js';

/**
 * R75.6, now server-owned (R99). These assertions were the frontend's until
 * this revision; they move with the rule rather than being restated, because a
 * copy left behind is the copy that drifts.
 */
describe('R75.6 — the base name a recording is derived from', () => {
  const session = {
    title: 'حلقة التفسير',
    description: 'مراجعة سورة البقرة',
    date: '2026-08-24',
  };

  it('joins the title, the note and the date', () => {
    expect(recordingBaseName(session)).toBe(
      'حلقة التفسير — مراجعة سورة البقرة — 2026-08-24',
    );
  });

  it('omits an absent description rather than leaving an empty separator', () => {
    expect(recordingBaseName({ ...session, description: null })).toBe(
      'حلقة التفسير — 2026-08-24',
    );
    expect(recordingBaseName({ ...session, description: '   ' })).toBe(
      'حلقة التفسير — 2026-08-24',
    );
  });

  it('takes only the first line, because a description is free multiline text', () => {
    const multi = { ...session, description: 'السطر الأول\nالسطر الثاني' };
    expect(recordingBaseName(multi)).toContain('السطر الأول');
    expect(recordingBaseName(multi)).not.toContain('السطر الثاني');
  });

  it('bounds a long description, so the name stays readable in a list', () => {
    const name = recordingBaseName({ ...session, description: 'ا'.repeat(200) });
    expect(name.length).toBeLessThan(100);
    expect(name).toContain('…');
  });
});

describe('R75.6 — the numeric suffix', () => {
  const base = 'تفسير — 2026-08-24';

  it('leaves the first one unnumbered', () => {
    expect(nextRecordingName(base, [])).toBe(base);
  });

  it('numbers from 2, because the unnumbered one IS the first', () => {
    expect(nextRecordingName(base, [base])).toBe(`${base} 2`);
    expect(nextRecordingName(base, [base, `${base} 2`])).toBe(`${base} 3`);
  });

  it('fills a gap rather than skipping past it', () => {
    expect(nextRecordingName(base, [base, `${base} 3`])).toBe(`${base} 2`);
  });

  it('ignores surrounding whitespace on both sides of the comparison', () => {
    expect(nextRecordingName('  حصة  ', ['حصة'])).toBe('حصة 2');
  });

  it('falls back to a word rather than producing an empty title', () => {
    expect(nextRecordingName('   ', [])).toBe('تسجيل');
  });

  it('does not collide even past the bound', () => {
    const taken = [base, ...Array.from({ length: 998 }, (_, i) => `${base} ${i + 2}`)];
    const name = nextRecordingName(base, taken, new Date(1_700_000_000_000));
    expect(taken).not.toContain(name);
  });

  it('mixes origins in ONE namespace — a browser name is taken for the server too', () => {
    // The property C2 turns on: the ingestion worker numbers against titles a
    // browser recorder produced, and vice versa.
    const browserSaved = base;
    const ingested = nextRecordingName(base, [browserSaved]);
    const secondBrowser = nextRecordingName(base, [browserSaved, ingested]);
    expect([browserSaved, ingested, secondBrowser]).toEqual([
      base,
      `${base} 2`,
      `${base} 3`,
    ]);
    expect(new Set([browserSaved, ingested, secondBrowser]).size).toBe(3);
  });
});

describe('TD-11 — the association’s date, not UTC’s', () => {
  it('reads the local calendar date', () => {
    // 00:30 local on the 24th. `toISOString()` would say the 23rd wherever the
    // offset is positive, which is the browser defect this replaced.
    // Built by the SAME authority that reads it (R167 §2): `new Date(y, m, d…)`
    // goes through the zone data frozen in the runtime, which is exactly what
    // disagreed with Morocco's clock after 2026-09-20.
    const at = moroccoWallClockToInstant(2026, 8, 24, 0, 30, 0);
    expect(localDateIso(at)).toBe('2026-08-24');
  });
});

describe('SRS Revision 165 §1 — what the platform’s own capture of a class is called', () => {
  const at = moroccoWallClockToInstant(2026, 9, 20, 18, 5, 0);

  it('type, Subject, Surah, main teacher, then the date and time she stopped it', () => {
    // The bare public name is passed; the composer adds the word (R172 §12).
    expect(
      sessionRecordingBaseName({
        typeName: 'حصة',
        subjectName: 'تفسير القرآن',
        surahNames: ['البقرة', 'آل عمران'],
        teacherName: 'صفاء',
        at,
      }),
    ).toBe('حصة — تفسير القرآن — البقرة، آل عمران — الأستاذة صفاء — 2026-09-20 18:05');
  });

  it('R172 §12 — a library recording: no type word, «المادة — الأستاذة من سجّلت — التاريخ الوقت»', () => {
    expect(
      sessionRecordingBaseName({ typeName: null, subjectName: 'الفقه', surahNames: [], teacherName: 'فاطمة', at }),
    ).toBe('الفقه — الأستاذة فاطمة — 2026-09-20 18:05');
  });

  it('omits what a class does not have rather than leaving empty separators', () => {
    expect(
      sessionRecordingBaseName({
        typeName: null,
        subjectName: 'فقه',
        surahNames: [],
        teacherName: null,
        at,
      }),
    ).toBe('فقه — 2026-09-20 18:05');
  });

  it('answers the same on every attempt — the instant is the recording’s, never «now»', () => {
    const source = { typeName: 'حصة', subjectName: 'فقه', surahNames: [], teacherName: null, at };
    expect(sessionRecordingBaseName(source)).toBe(sessionRecordingBaseName(source));
  });
});
