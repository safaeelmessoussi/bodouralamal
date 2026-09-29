import { t } from '../i18n/index.js';
import { formatDateWithWeekday } from './format-date.js';

/**
 * **R179 §11 (Owner-reported, 2026-09-29) — a booking clash, in words.**
 *
 * The server's `SCHEDULE_CONFLICT` used to reach the reader as «القاعة أو أحد
 * المؤطرين مرتبط بحصة أخرى» — true, and useless when the room looked free:
 * the clash was a teacher's other class, or an occurrence of a class in the
 * Trash. `details.conflicts` now carries the room's or the person's name, the
 * other occurrence's composed title and its clock window; this says the first
 * few and counts the rest.
 */
export interface ConflictDetail {
  kind?: string;
  date?: string;
  resourceName?: string | null;
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

const SAID = 3;

export function describeScheduleConflict(details: Record<string, unknown> | undefined): string {
  const list = Array.isArray(details?.['conflicts']) ? (details!['conflicts'] as ConflictDetail[]) : [];
  const total = typeof details?.['total'] === 'number' ? (details!['total'] as number) : list.length;
  const sentences = list.slice(0, SAID).flatMap((c) => {
    if (!c.resourceName || !c.date) return [];
    const fill = (key: string): string =>
      t(key)
        .replace('{room}', c.resourceName ?? '')
        .replace('{name}', c.resourceName ?? '')
        .replace('{title}', c.title ?? '')
        .replace('{date}', formatDateWithWeekday(c.date ?? ''))
        .replace('{from}', c.startTime ?? '')
        .replace('{to}', c.endTime ?? '');
    return [fill(c.kind === 'room' ? 'admin.schedules.clashRoom' : 'admin.schedules.clashPerson')];
  });
  if (sentences.length === 0) return t('admin.schedules.clash');
  const more = total > sentences.length ? [t('admin.schedules.clashMore').replace('{count}', String(total - sentences.length))] : [];
  return [...sentences, ...more, t('admin.schedules.clashRemedy')].join(' ');
}
