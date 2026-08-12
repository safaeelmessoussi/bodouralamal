import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { listSubjects, type SubjectRef } from '../../adapters/reference-data.js';
import {
  assignSubject,
  listLevelSubjects,
  listLevels,
  unassignSubject,
  type Level,
} from '../../adapters/taxonomy.js';
import { AdminLayout } from '../../components/admin/admin-layout.js';
import type { Crumb } from '../../components/portal/breadcrumb.js';
import { Button } from '../../components/ui/button.js';
import { ConfirmDialog } from '../../components/ui/confirm-dialog.js';
import { SelectField } from '../../components/ui/field.js';
import { useSession } from '../../contexts/session.js';
import { useActiveRole } from '../../contexts/active-role.js';
import { t } from '../../i18n/index.js';
import { ApiError } from '../../lib/api.js';

/**
 * `/admin/level-subjects?level=` — **which Subjects this Level teaches**
 * (§4.4b, TD-3 extension 2026-08-05; R69 gave it this node).
 *
 * **This screen is the fix for `SUBJECT_NOT_IN_LEVEL`.** The platform shipped
 * with zero `LevelSubject` rows and nothing that could create one, so every
 * attempt to create a Teaching Group was refused and the Subject Organisation
 * screen could not be used at all. The endpoints closed the backend half; this
 * is the half an administrator can reach.
 *
 * **A Subject with no Teaching Groups is taught to the whole Level.** Assigning
 * it here is what makes it *taught*; splitting it into groups is a separate,
 * optional decision taken on the حلقات المواد screen this one links into. Those
 * are different questions and the screens keep them apart.
 *
 * **Removal is refused while Teaching Groups exist** for the pair, and the
 * refusal is reported as what it is: those groups split a Subject the Level
 * would no longer teach, leaving their members holding seats in a subject that
 * is not offered.
 *
 * Assignment is Super Admin (R43.3 — curriculum structure); an Admin reads the
 * list and may still open the organisation screen, where placing students is
 * their job. The server enforces both.
 */
export function LevelSubjectsPage({ levelId }: { levelId: string | null }): ReactNode {
  const { accessToken } = useSession();
  const { activeRoles } = useActiveRole();
  // R60 — the ACTIVE role. A Super Admin working as مؤطِّرة must not be offered
  // a control the server will refuse: the affordance follows the authority.
  const canWrite = (activeRoles).includes('super_admin');

  const [level, setLevel] = useState<Level | null>(null);
  /** R69 — the page picks its own Level now: it has a node, and a menu entry
   *  cannot supply an id. `?level=` is the deep link, not a second node. */
  const [levels, setLevels] = useState<Level[]>([]);
  const [assigned, setAssigned] = useState<SubjectRef[]>([]);
  const [all, setAll] = useState<SubjectRef[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [picked, setPicked] = useState('');
  const [removing, setRemoving] = useState<SubjectRef | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, every, levels] = await Promise.all([
        levelId ? listLevelSubjects(levelId, accessToken) : Promise.resolve([]),
        listSubjects(accessToken),
        // The Level's own name. `listLevels` is the one read that has it; a
        // dedicated single-Level endpoint would be a second contract for the
        // same fact.
        listLevels(accessToken).catch(() => [] as Level[]),
      ]);
      setAssigned(mine);
      setAll(every);
      setLevels(levels);
      setLevel(levels.find((l) => l.id === levelId) ?? null);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [levelId, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Offered = every live Subject minus the ones already here. Narrowing the
  // page's own already-fetched list, not filtering reference data the server
  // owns — the distinction the calendar's category→level rule draws.
  const available = all.filter((s) => !assigned.some((a) => a.id === s.id));

  async function add(): Promise<void> {
    // Both writes need a Level; the controls only render once one is chosen,
    // and this is the guard that makes that a fact rather than a layout detail.
    if (!picked || !levelId) return;
    setBusy(true);
    setNotice(null);
    try {
      await assignSubject(levelId, picked, accessToken);
      setPicked('');
      await load();
      setNotice(t('admin.levelSubjects.assigned'));
    } catch (error) {
      // A 409 here is DUPLICATE — someone assigned it in another tab. The list
      // is simply stale, so reloading is the whole remedy.
      const duplicate = error instanceof ApiError && error.status === 409;
      setNotice(t(duplicate ? 'admin.levelSubjects.alreadyAssigned' : 'common.saveFailed'));
      if (duplicate) await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!removing || !levelId) return;
    setBusy(true);
    try {
      await unassignSubject(levelId, removing.id, accessToken);
      await load();
      setNotice(t('admin.levelSubjects.removed'));
    } catch (error) {
      const blocked = error instanceof ApiError && error.status === 409;
      setNotice(t(blocked ? 'admin.levelSubjects.removeBlocked' : 'common.deleteFailed'));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  /** R69 — المستويات → مواد مستوى «X». Only once a Level is chosen: until
   *  then this screen is not inside anything. */
  const trail: Crumb[] = level
    ? [
        { label: t('admin.nav.levels'), href: '/admin/levels' },
        { label: t('admin.levelSubjects.title').replace('{level}', level.name) },
      ]
    : [];

  return (
    <AdminLayout
      breadcrumb={trail}
      // R-UX — the heading names the Level, so it answers *where am I*
      // without the reader parsing the lede for it.
      title={
        level
          ? t('admin.levelSubjects.title').replace('{level}', level.name)
          : t('admin.nav.levelSubjects')
      }
      lede={t('admin.levelSubjects.lede')}
    >
      {notice ? (
        <p className="admin-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {/* R69 — the page asks which Level, because it has a node now and a menu
          entry cannot supply an id. Always visible, so switching Level is one
          control rather than a trip back to المستويات. */}
      <SelectField
        label={t('admin.nav.levels')}
        value={levelId ?? ''}
        onChange={(next) => {
          if (next === '') return;
          window.location.href = `/admin/level-subjects?level=${next}`;
        }}
        placeholder={t('common.choose')}
        options={levels.map((l) => ({ value: l.id, label: `${l.category_name} — ${l.name}` }))}
      />

      {levelId === null ? (
        <p className="state">{t('admin.levelSubjects.pickLevel')}</p>
      ) : null}

      {levelId !== null && state === 'loading' ? (
        <p className="state">{t('common.loading')}</p>
      ) : null}
      {state === 'error' ? (
        <p className="state" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : null}

      {levelId !== null && state === 'ready' ? (
        <>
          {canWrite ? (
            <section className="form">
              <SelectField
                label={t('admin.levelSubjects.addLabel')}
                value={picked}
                onChange={setPicked}
                options={[
                  { value: '', label: t('common.choose') },
                  ...available.map((s) => ({ value: s.id, label: s.name })),
                ]}
                hint={
                  available.length === 0
                    ? t('admin.levelSubjects.noneLeft')
                    : t('admin.levelSubjects.addHint')
                }
              />
              <Button variant="primary" disabled={busy || picked === ''} onClick={() => void add()}>
                {t('admin.levelSubjects.add')}
              </Button>
            </section>
          ) : null}

          {assigned.length === 0 ? (
            // Not an error and not an empty table — a named state. A Level that
            // teaches nothing cannot have a schedule or a teaching group, and
            // saying so here is what stops that being discovered as a refusal
            // three screens later.
            <p className="state" role="status">
              {t('admin.levelSubjects.empty')}
            </p>
          ) : (
            <ul className="admin-list">
              {assigned.map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                  {/* R69's canonical route. This linked to the legacy
                      `/admin/levels/{id}/subjects/{sid}` path, which still
                      works — but only by bouncing through a redirect, so the
                      platform's own main drill-down navigated twice. A
                      redirect is for links already in the wild, not for the
                      screen next door. */}
                  <a
                    className="btn btn--secondary"
                    href={`/admin/teaching-groups?level=${levelId}&subject=${s.id}`}
                  >
                    {t('admin.levelSubjects.organise')}
                  </a>
                  {canWrite ? (
                    <Button variant="secondary" onClick={() => setRemoving(s)}>
                      {t('admin.levelSubjects.remove')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={t('admin.levelSubjects.removeTitle')}
        body={t('admin.levelSubjects.removeBody').replace('{name}', removing?.name ?? '')}
        confirmLabel={t('admin.levelSubjects.remove')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </AdminLayout>
  );
}
