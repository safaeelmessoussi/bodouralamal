/**
 * **R259 — a content title, built from its parts** (the Owner, 2026-10-30):
 *
 * «تسجيل صوتي تفسير سورة البقرة الجزء الثاني الحصة 7 الجزء 2 تعريف الحمد»
 * «صورة 6 تفسير سورة الفاتحة الحصة 1 الجزء 2 تعريف الحمد»
 *
 * The format (with its page number), the Subject («تفسير» for تفسير القرآن),
 * «سورة X», the part of سورة البقرة, «الحصة n», «الجزء m», the description.
 * The format and the three numbers are NOT stored: they live in the title, so
 * an edit reads them back from it (`parseTitle`) and writes them again.
 */

export const TITLE_FORMATS = ['تسجيل صوتي', 'مطبوع', 'صورة', 'تسجيل فيديو'] as const;
export type TitleFormat = (typeof TITLE_FORMATS)[number];

/** The fields of the title that are not stored anywhere else; `''` is empty. */
export interface TitleNumbers {
  format: TitleFormat | '';
  page: string;
  session: string;
  part: string;
}

export const EMPTY_TITLE_NUMBERS: TitleNumbers = { format: '', page: '', session: '', part: '' };

/** The format a file suggests, by what it is. */
export function formatForKind(kind: string): TitleFormat | '' {
  if (kind === 'audio') return 'تسجيل صوتي';
  if (kind === 'video') return 'تسجيل فيديو';
  if (kind === 'image') return 'صورة';
  if (kind === 'pdf') return 'مطبوع';
  return '';
}

/** «تفسير القرآن» reads «تفسير» in a title; every other Subject reads whole. */
export function subjectWord(name: string): string {
  return name.trim() === 'تفسير القرآن' ? 'تفسير' : name.trim();
}

/** R232's two parts of سورة البقرة, in a title. */
export function surahPartWord(part: 1 | 2 | null): string {
  return part === 1 ? 'الجزء الأول' : part === 2 ? 'الجزء الثاني' : '';
}

const digits = (value: string): string => value.replace(/[^\d]/g, '');

/** The title, from its parts; empty parts leave no trace. */
export function composeTitle(input: {
  numbers: TitleNumbers;
  subject: string;
  surahName: string | null;
  surahPart: 1 | 2 | null;
  description: string;
}): string {
  const { numbers } = input;
  const page = digits(numbers.page);
  const session = digits(numbers.session);
  const part = digits(numbers.part);
  // A description's first line is what a title can hold.
  const description = (input.description.split('\n')[0] ?? '').trim();
  return [
    numbers.format === '' ? '' : [numbers.format, page].filter(Boolean).join(' '),
    subjectWord(input.subject),
    input.surahName ? `سورة ${input.surahName}` : '',
    input.surahName ? surahPartWord(input.surahPart) : '',
    session === '' ? '' : `الحصة ${session}`,
    part === '' ? '' : `الجزء ${part}`,
    description,
  ]
    .filter((piece) => piece !== '')
    .join(' ')
    .slice(0, 200);
}

/**
 * The numbers a title holds, for an edit form. Only what is there is read: a
 * title written another way yields empty fields, never a guess. «الجزء الأول»
 * and «الجزء الثاني» (words) are the Surah's part; «الجزء 2» (a number) is the
 * lesson's.
 */
export function parseTitle(title: string): TitleNumbers {
  const text = title.replace(/\s+/g, ' ').trim();
  const format = TITLE_FORMATS.find((f) => text === f || text.startsWith(`${f} `)) ?? '';
  const page = format === '' ? '' : (new RegExp(`^${format} (\\d+)(?: |$)`).exec(text)?.[1] ?? '');
  const session = /(?:^| )الحصة (\d+)(?= |$)/.exec(text)?.[1] ?? '';
  const part = /(?:^| )الجزء (\d+)(?= |$)/.exec(text)?.[1] ?? '';
  return { format, page, session, part };
}

/** Arabic ordinals a file name may spell a session with, both genders. */
const ORDINALS: Record<string, number> = {
  الأولى: 1, الاولى: 1, الأول: 1, الاول: 1,
  الثانية: 2, الثاني: 2,
  الثالثة: 3, الثالث: 3,
  الرابعة: 4, الرابع: 4,
  الخامسة: 5, الخامس: 5,
  السادسة: 6, السادس: 6,
  السابعة: 7, السابع: 7,
  الثامنة: 8, الثامن: 8,
  التاسعة: 9, التاسع: 9,
  العاشرة: 10, العاشر: 10,
};
/** «الحادية عشرة» … «التاسعة عشرة»: the unit's ordinal before «عشرة/عشر». */
const TEEN_UNITS: Record<string, number> = {
  الحادية: 1, الحادي: 1, الثانية: 2, الثاني: 2, الثالثة: 3, الثالث: 3, الرابعة: 4, الرابع: 4,
  الخامسة: 5, الخامس: 5, السادسة: 6, السادس: 6, السابعة: 7, السابع: 7, الثامنة: 8, الثامن: 8,
  التاسعة: 9, التاسع: 9,
};

/**
 * **R260 — the numbers a file's own name already says** (the Owner, with
 * «Z0000121الحصة الأولى من تفسير سورة البقرة ج 1.mp3», «ح 7 ج 2 من تفسير سورة
 * ال عمران.mp3», «الحصة_الثالثة_تفسير_سورة_البقرة_ج2.mp3»): «الحصة n» or «ح n»
 * — a number or an ordinal word — is the session; «الجزء n» or «ج n» (a number)
 * is the session's part, never the Surah's; «صفحة n» or «ص n» is the page.
 * The format is the file's kind. Whatever the name does not say stays empty.
 */
export function parseFileName(name: string, kind: string): TitleNumbers {
  const text = ` ${name
    .replace(/\.[^.]+$/, '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[_\-.]+/g, ' ')
    .replace(/(\D)(\d)/g, '$1 $2')
    .replace(/(\d)(\D)/g, '$1 $2')
    .replace(/\s+/g, ' ')} `;
  const number = (pattern: RegExp): string => pattern.exec(text)?.[1] ?? '';
  let session = number(/ (?:الحصة|حصة|ح) (\d+) /);
  if (session === '') {
    const words = / (?:الحصة|حصة) (\S+)(?: (عشرة|عشر))? /.exec(text);
    if (words) {
      const value = words[2] ? (TEEN_UNITS[words[1]!] ?? 0) + 10 : ORDINALS[words[1]!];
      if (value) session = String(value);
    }
  }
  return {
    format: formatForKind(kind),
    page: number(/ (?:صفحة|الصفحة|ص) (\d+) /),
    session,
    part: number(/ (?:الجزء|جزء|ج) (\d+) /),
  };
}
