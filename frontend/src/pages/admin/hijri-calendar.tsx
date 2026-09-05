import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  fetchHijriYear,
  importYearBaseline,
  publishYear,
  recordMonthStart,
  type HijriMonthRow,
  type HijriYear,
} from '../../adapters/hijri-calendar.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import { ErrorState } from '../../components/states.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { DatePicker } from '../../components/ui/date-picker.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { Feedback } from '../../components/ui/feedback.js';

/**
 * `/superadmin/hijri-calendar` — **recording the Ministry of Habous's official
 * announcements** (§5.7, Revisions 31–32).
 *
 * This screen is the reason the Hijri overlay can exist at all. Until it shipped,
 * the recurring §2.3 owner task — record each month after the Ministry announces
 * it — was performable only by an authenticated API call, so in practice the
 * whole calendar overlay stayed blank.
 *
 * **The vocabulary is binding, not stylistic** (Revision 32). Every label says
 * *record* and *official announcement*; none says *choose*, *define* or *set*.
 * Wording that reads as a choice invites treating the value as editorial
 * judgement, and this platform's claim is that it reproduces an external
 * authority rather than forming its own view.
 *
 * **Two behaviours a reader must not have to discover:**
 *
 * 1. **Only published months render anywhere.** A recorded month sits in `draft`
 *    and is invisible platform-wide until the year is published, so the screen
 *    says so rather than leaving the Super Admin wondering why the calendar has
 *    not changed.
 * 2. **A month resolves for its certain 29 days unless the NEXT month is also
 *    recorded.** Knowing when a month began says nothing about when it ended —
 *    that depends on the next sighting. The screen flags the last recorded month
 *    for exactly this reason: it is the single most common cause of "the second
 *    half of the month has no Hijri dates".
 */
const CURRENT_HIJRI_YEAR_GUESS = 1448;

/**
 * The two facts the screen derives from a year's rows.
 *
 * **Extracted so it can be tested against the real wire shape.** These three
 * lines were inline, reading `data.months` — a field the API has never sent —
 * and nothing could catch it: `api<T>()` is an unchecked cast, so the wrong
 * type compiled, `.filter()` on `undefined` threw at render, React unmounted
 * the tree, and the page rendered blank white. A pure function over the
 * contract's own key set is testable; three expressions inside a component
 * body are not.
 */
export function summariseYear(year: HijriYear | null): {
  drafts: number;
  recorded: HijriMonthRow[];
  lastRecorded: HijriMonthRow | null;
} {
  const rows = year?.data ?? [];
  const recorded = rows.filter((m) => m.gregorian_start_date !== null);
  return {
    drafts: rows.filter((m) => m.status === 'draft').length,
    recorded,
    // The last recorded month has no successor, so it resolves only its certain
    // 29 days — the single most common cause of "the second half of the month
    // has no Hijri dates" (§4.4, Revisions 31–32).
    lastRecorded: recorded.length > 0 ? (recorded[recorded.length - 1] ?? null) : null,
  };
}

export function HijriCalendarPage(): ReactNode {
  const { accessToken } = useSession();
  const [year, setYear] = useState(CURRENT_HIJRI_YEAR_GUESS);
  const [data, setData] = useState<HijriYear | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyMonth, setBusyMonth] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const next = await fetchHijriYear(year, accessToken);
      setData(next);
      setState('ready');
    } catch {
      setState('error');
    }
    // `accessToken` belongs here. Without it the callback kept its identity
    // when the session resolved, so the first attempt — made while the token
    // was still null — was never retried and the screen stayed on its error
    // state forever. Passing the token was necessary but not sufficient.
  }, [year, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function record(month: HijriMonthRow, value: string): Promise<void> {
    setBusyMonth(month.hijri_month);
    setNotice(null);
    try {
      await recordMonthStart(year, month.hijri_month, value, month.version, accessToken);
      await load();
      setNotice(t('admin.hijri.recorded'));
    } catch {
      // A stale version is the interesting failure: another Super Admin
      // corrected the same month, and reloading is the only correct response
      // (TD-15) — never a silent overwrite.
      setNotice(t('admin.hijri.conflict'));
      await load();
    } finally {
      setBusyMonth(null);
    }
  }

  /**
   * **Prefill, then correct** (Owner, 2026-08-30).
   *
   * The months with no row yet are filled from the Umm al-Qura baseline; every
   * month already recorded is left exactly as it is, so this can be run without
   * reading it first and without risking a correction. The result says which of
   * the two happened for how many months, because *«nothing was imported»* and
   * *«twelve were»* look identical on a table that reloads either way.
   */
  async function importBaseline(): Promise<void> {
    setNotice(null);
    setImporting(true);
    try {
      const result = await importYearBaseline(year, accessToken);
      await load();
      setNotice(
        t('admin.hijri.imported')
          .replace('{imported}', String(result.imported))
          .replace('{skipped}', String(result.skipped)),
      );
    } catch {
      setNotice(t('admin.hijri.importFailed'));
    } finally {
      setImporting(false);
    }
  }

  async function publish(): Promise<void> {
    setNotice(null);
    try {
      const result = await publishYear(year, accessToken);
      await load();
      setNotice(`${t('admin.hijri.published')} (${result.published})`);
    } catch {
      setNotice(t('admin.hijri.publishFailed'));
    }
  }

  const { drafts, lastRecorded } = summariseYear(data);

  return (
    <AdminLayout
      title={t('admin.hijri.title')}
      lede={t('admin.hijri.lede')}
      actions={
        /* In reading order: fill what is missing, correct what differs from the
           Ministry's announcement, then publish. The baseline button is
           `secondary` because it makes nothing visible — it only saves typing. */
        <>
          <Button variant="secondary" onClick={() => void importBaseline()} disabled={importing}>
            {t('admin.hijri.import')}
          </Button>
          <Button variant="primary" onClick={() => void publish()} disabled={drafts === 0}>
            {t('admin.hijri.publish')}
          </Button>
        </>
      }
    >
      <div className="admin-panel">
        <label className="cal-filter" htmlFor="hijri-year">
          <span className="cal-filter__label">{t('admin.hijri.yearLabel')}</span>
          <input
            id="hijri-year"
            className="cal-filter__control"
            type="number"
            min={1300}
            max={1600}
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || year)}
          />
        </label>
        {/* TD-9 constrains the year to 1300–1600, a range that brackets any date
            this platform will render while rejecting a mistyped Gregorian year. */}
        <p className="admin-panel__hint">{t('admin.hijri.yearHint')}</p>
      </div>

      {notice ? (
        <Feedback>
          {notice}
        </Feedback>
      ) : null}

      {drafts > 0 ? (
        <Feedback tone="warn">
          {t('admin.hijri.draftWarning')} ({drafts})
        </Feedback>
      ) : null}

      {state === 'error' ? <ErrorState onRetry={() => void load()} /> : null}

      {state === 'loading' ? (
        <div role="status" aria-live="polite">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--wide" />
          <span className="skeleton skeleton--wide" />
          <span className="visually-hidden">{t('states.loading')}</span>
        </div>
      ) : null}

      {state === 'ready' && data ? (
        <>
          <table className="admin-table">
            <caption className="visually-hidden">{t('admin.hijri.tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.hijri.colMonth')}</th>
                <th scope="col">{t('admin.hijri.colStart')}</th>
                <th scope="col">{t('admin.hijri.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((month) => (
                <MonthRow
                  key={month.hijri_month}
                  month={month}
                  busy={busyMonth === month.hijri_month}
                  isLastRecorded={lastRecorded?.hijri_month === month.hijri_month}
                  onRecord={(value) => void record(month, value)}
                />
              ))}
            </tbody>
          </table>

          {lastRecorded ? (
            <p className="admin-panel__hint">{t('admin.hijri.tailWarning')}</p>
          ) : null}
        </>
      ) : null}
    </AdminLayout>
  );
}

export function MonthRow({
  month,
  busy,
  isLastRecorded,
  onRecord,
}: {
  month: HijriMonthRow;
  busy: boolean;
  isLastRecorded: boolean;
  onRecord: (value: string) => void;
}): ReactNode {
  const [value, setValue] = useState(month.gregorian_start_date ?? '');
  // The row re-syncs when the server's value changes under it — after a
  // successful record, or after a conflict forced a reload.
  useEffect(() => setValue(month.gregorian_start_date ?? ''), [month.gregorian_start_date]);

  const dirty = value !== (month.gregorian_start_date ?? '');

  return (
    <tr>
      <th scope="row" className="admin-table__rowhead">
        {month.month_name_ar}
        <span className="admin-table__ordinal">{month.hijri_month}</span>
      </th>
      <td>
        <DatePicker
          value={value}
          onChange={setValue}
          ariaLabel={`${t('admin.hijri.colStart')} — ${month.month_name_ar}`}
        />
      </td>
      <td className="admin-table__actions">
        <StatusBadge month={month} isLastRecorded={isLastRecorded} />
        <Button
          variant="secondary"
          disabled={!dirty || value === '' || busy}
          onClick={() => onRecord(value)}
        >
          {t('admin.hijri.record')}
        </Button>
      </td>
    </tr>
  );
}

/** Words, not colour alone — the state has to survive a monochrome screen. */
function StatusBadge({
  month,
  isLastRecorded,
}: {
  month: HijriMonthRow;
  isLastRecorded: boolean;
}): ReactNode {
  if (month.gregorian_start_date === null) {
    return <Badge>{t('admin.hijri.notRecorded')}</Badge>;
  }
  return (
    <>
      <Badge tone={month.status === 'published' ? 'ok' : 'warn'}>
        {t(month.status === 'published' ? 'admin.hijri.statusPublished' : 'admin.hijri.statusDraft')}
      </Badge>
      {/* The boundary that explains a half-labelled month on the public
          calendar, surfaced where it can be acted on. */}
      {isLastRecorded ? <Badge>{t('admin.hijri.tailBadge')}</Badge> : null}
    </>
  );
}
