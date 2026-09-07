import type { Occurrence } from '../adapters/calendar.js';

/** Recurring Events share an id across dates: the date is part of the address,
 * not an authorization hint. The calendar re-reads the server-scoped day. */
export type OccurrenceAddress = Pick<Occurrence, 'kind' | 'id' | 'date'>;

export function occurrenceHref(occurrence: OccurrenceAddress): string {
  const params = new URLSearchParams({
    occurrence: `${occurrence.kind}:${occurrence.id}`,
    date: occurrence.date,
  });
  return `/calendar?${params}`;
}

export function readOccurrenceAddress(search: string): OccurrenceAddress | null {
  const params = new URLSearchParams(search);
  const match = /^(session|event|exam):([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i.exec(params.get('occurrence') ?? '');
  const date = params.get('date') ?? '';
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return { kind: match[1]!.toLowerCase() as Occurrence['kind'], id: match[2]!, date };
}
