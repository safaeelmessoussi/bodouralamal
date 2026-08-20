import type { ReactNode } from 'react';

import type { Occurrence } from '../../adapters/calendar.js';
import { t } from '../../i18n/index.js';
import { Badge } from '../ui/badge.js';
import { DataTable, type TableStatus } from '../ui/data-table.js';
import { levelLabel } from '../scope/level-select.js';
import { deliveryLabel, venueLabel } from '../scheduling/delivery.js';

/**
 * **قائمة, as a table, on every surface that lists occurrences** (rule AO).
 *
 * The public, beneficiary and مؤطرة lists each rendered their own markup — a
 * stack of cards on one, a bare `<ul>` on another — while the back office used
 * `DataTable`. One concept, three implementations, and the two that were not
 * `DataTable` had none of its states: no empty state, no error, no retry.
 *
 * **Columns are configurable and nothing else is.** Which columns a surface
 * shows is a question about what its reader may see — a public visitor is not
 * shown who teaches a class — so the caller names them and this renders them.
 * It never decides authorization: the caller passes the dataset the server
 * already scoped, and a column omitted here is a column the server did not fill
 * anyway (rule O).
 *
 * **No row actions.** An occurrence list on these surfaces is something to read;
 * the back office keeps its own definitions table, with its actions, because it
 * is an operational screen and a different thing (rule AO's matrix).
 */
export type OccurrenceColumn =
  | 'kind'
  | 'title'
  | 'date'
  | 'time'
  | 'level'
  | 'subject'
  | 'audience'
  | 'branch'
  | 'room'
  /** R97 — حضوري / عن بُعد. Its own column because it is its own concept: the
   *  Branch says the administrative scope and the room says the venue, and an
   *  online class has the first without the second. */
  | 'delivery';

const KIND_TONE: Record<string, 'neutral' | 'ok' | 'warn'> = {
  session: 'ok',
  event: 'neutral',
  exam: 'warn',
};

export function OccurrenceTable({
  occurrences,
  columns,
  status,
  onRetry,
  filtered = false,
  onClearFilters,
}: {
  occurrences: Occurrence[];
  columns: readonly OccurrenceColumn[];
  status: TableStatus;
  onRetry?: () => void;
  /** Whether anything is narrowing — so the empty state can say *why*. */
  filtered?: boolean;
  onClearFilters?: () => void;
}): ReactNode {
  const all: Record<OccurrenceColumn, {
    key: string;
    header: string;
    cell: (o: Occurrence) => ReactNode;
    numeric?: boolean;
  }> = {
    kind: {
      key: 'kind',
      header: t('calendar.table.kind'),
      // The kind is a shape as well as a word: a reader scanning a month should
      // not have to read every row to find the exam in it.
      cell: (o) => (
        <Badge tone={KIND_TONE[o.kind] ?? 'neutral'}>{t(`calendar.kind.${o.kind}`)}</Badge>
      ),
    },
    title: { key: 'title', header: t('calendar.table.title'), cell: (o) => o.title },
    date: { key: 'date', header: t('calendar.table.date'), cell: (o) => o.date, numeric: true },
    time: {
      key: 'time',
      header: t('calendar.table.time'),
      numeric: true,
      // An all-day activity has no clock, and an em dash says so better than a
      // blank cell, which reads as missing data.
      cell: (o) => (o.start_time === null ? '—' : `${o.start_time}${o.end_time ? ` – ${o.end_time}` : ''}`),
    },
    level: {
      key: 'level',
      header: t('calendar.table.level'),
      // **Through `levelLabel`, never hand-written** (rule D). A Level name does
      // not identify a Level on its own (§4.4b), and the em-dash format lives in
      // exactly one function — which the atomic guard caught me forgetting.
      cell: (o) =>
        o.level_name === null
          ? '—'
          : levelLabel({
              id: o.level_id ?? '',
              name: o.level_name,
              category_name: o.category_name,
            }),
    },
    subject: {
      key: 'subject',
      header: t('calendar.table.subject'),
      cell: (o) => o.subject_name ?? '—',
    },
    audience: {
      key: 'audience',
      header: t('calendar.table.audience'),
      // The group or circle the occurrence is for, already resolved by the
      // server (TD-3.4) — never derived here from three nullable ids.
      cell: (o) => o.audience_label ?? '—',
    },
    branch: {
      key: 'branch',
      header: t('calendar.table.branch'),
      cell: (o) => o.branch_name ?? t('calendar.table.noBranch'),
    },
    // **Answers *where does this happen*** (rule C, `venueLabel`): the room for
    // an in-person class, «عن بُعد» for an online one. A cell that said only
    // «—» for every online class would read as missing data rather than as a
    // class with no venue.
    room: { key: 'room', header: t('calendar.table.room'), cell: (o) => venueLabel(o) ?? '—' },
    delivery: {
      key: 'delivery',
      header: t('delivery.label'),
      // `—` for an Event and an Exam, which have no delivery model — never an
      // invented «حضوري».
      cell: (o) => deliveryLabel(o) ?? '—',
    },
  };

  return (
    <DataTable
      caption={t('calendar.table.caption')}
      columns={columns.map((c) => all[c])}
      rows={occurrences}
      rowKey={(o) => `${o.kind}:${o.id}:${o.date}`}
      status={status}
      {...(onRetry ? { onRetry } : {})}
      filtered={filtered}
      {...(onClearFilters ? { onClearFilters } : {})}
    />
  );
}
