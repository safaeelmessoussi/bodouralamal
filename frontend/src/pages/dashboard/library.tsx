import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchStudentIdentity, type StudentIdentity } from '../../adapters/students.js';
import { fetchLevelContent, type ContentItem } from '../../adapters/content.js';
import { StudentLayout } from '../../components/student/student-layout.js';
import { DataTable } from '../../components/ui/data-table.js';
import { SelectField } from '../../components/ui/field.js';
import { ErrorState } from '../../components/states.js';
import { useActiveChild } from '../../contexts/active-child.js';
import { useSession } from '../../contexts/session.js';
import { levelLabel } from '../../components/scope/level-select.js';
import { t } from '../../i18n/index.js';

/**
 * **مكتبة المحتوى — hers, and inside her portal** (R86).
 *
 * Her menu linked to `/resources`, the **public** library index: the sidebar
 * vanished, and she landed on the association's whole curriculum to hunt for her
 * own Level. Two defects in one link — the frame and the scope.
 *
 * ## The tree is her enrolments; the items are the server's
 *
 * The Categories and Levels she may choose between come from **her own**
 * `GET /students/me` enrolments — her data, about her, which is not
 * *filtering sensitive content client-side*. The **items** come from
 * `GET /library?level_id=`, which applies §4.9's visibility tiers server-side
 * exactly as it does for every other reader. So a forged level id changes the
 * dropdown and nothing else: the server still answers with what that caller may
 * see (rule O).
 *
 * ## One enrolment opens straight into it
 *
 * A beneficiary in a single Level should not meet a chooser with one option —
 * she is answering a question she has no alternative for. It is selected on
 * arrival, and the control appears only when there is genuinely a choice.
 */
export function StudentLibraryPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeChildId } = useActiveChild();

  const [identity, setIdentity] = useState<StudentIdentity | null>(null);
  const [levelId, setLevelId] = useState<string | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    void fetchStudentIdentity(accessToken, activeChildId)
      .then((me) => {
        if (!live) return;
        setIdentity(me);
        // **Selected on arrival**, whether she holds one enrolment or five: a
        // library that opens on nothing makes her choose before it will show
        // her anything, which is the gate rule F forbids.
        setLevelId((current) => current ?? me.enrollments[0]?.level.id ?? null);
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [accessToken, activeChildId]);

  const load = useCallback(async () => {
    if (levelId === null) return;
    setState('loading');
    try {
      // `GET /content/levels/{id}` — the SAME read the public library uses, and
      // the same one that applies §4.9's tiers server-side. Grouped by year and
      // branch there; flattened here, because she is looking for an item rather
      // than browsing an archive.
      const level = await fetchLevelContent(levelId);
      setItems(
        (level?.years ?? []).flatMap((year) => year.branches.flatMap((branch) => branch.items)),
      );
      setState('ready');
    } catch {
      setState('error');
    }
  }, [levelId, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Her Categories, each carrying only the Levels she is enrolled in. */
  const options = useMemo(() => {
    const rows = identity?.enrollments ?? [];
    return rows.map((e) => ({
      value: e.level.id,
      // `{Category} — {Level}` through the shared helper: a Level name does not
      // identify a Level on its own (§4.4b, rule D).
      label: levelLabel({ id: e.level.id, name: e.level.name, category_name: e.category.name }),
    }));
  }, [identity]);

  const current = identity?.enrollments.find((e) => e.level.id === levelId) ?? null;

  return (
    <StudentLayout
      title={t('student.nav.content')}
      lede={current ? t('student.library.lede').replace('{level}', current.level.name) : null}
    >
      {state === 'error' ? <ErrorState onRetry={() => void load()} /> : null}

      {/* **Only when there is a choice.** One enrolment means no control: a
          dropdown with a single option asks a question with one answer. */}
      {options.length > 1 ? (
        <SelectField
          label={t('student.library.level')}
          value={levelId ?? ''}
          onChange={(v) => setLevelId(v || null)}
          options={options}
        />
      ) : null}

      {identity !== null && options.length === 0 ? (
        <div className="state" role="status">
          <p>{t('student.library.noEnrolment')}</p>
        </div>
      ) : null}

      {levelId !== null ? (
        <DataTable
          caption={t('student.nav.content')}
          columns={[
            { key: 'title', header: t('student.library.title'), cell: (i: ContentItem) => i.title },
            {
              key: 'subject',
              header: t('student.library.subject'),
              cell: (i: ContentItem) => i.subject_name ?? '—',
            },
            {
              key: 'open',
              header: t('student.library.open'),
              // Through the existing library flow, which owns the download
              // permission and the presigned URL (TD-3.5).
              // Opened through the existing library flow, which owns the
              // download permission and the presigned URL (TD-3.5).
              cell: () => <a href={`/resources?level=${levelId}`}>{t('content.openItem')}</a>,
            },
          ]}
          rows={items}
          rowKey={(i) => i.id}
          status={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'}
          onRetry={() => void load()}
        />
      ) : null}
    </StudentLayout>
  );
}
