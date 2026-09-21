import { useEffect, useState, type ReactNode } from 'react';

import {
  fetchSessionRoster,
  setSessionAudienceOverrides,
  type SessionRoster,
} from '../../adapters/sessions.js';
import {
  listAdministrativeGroups,
  type AdministrativeGroup,
  type Page,
} from '../../adapters/administrative-groups.js';
import { listCircles, type TeachingGroupRow } from '../../adapters/teaching-groups.js';
import { Badge } from '../ui/badge.js';
import { FormDialog } from '../ui/form-dialog.js';
import { isDirty } from '../../lib/form-dirty.js';
import { MultiSelectField } from '../ui/multi-select.js';
import { useScopeOptions } from '../../hooks/use-scope-options.js';
import { t } from '../../i18n/index.js';

/**
 * **الحضور — who is expected at THIS occurrence, along five dimensions**
 * (R92, generalised Owner-reported 2026-09-17 from branches alone).
 *
 * The association occasionally delivers a lesson once instead of twice, folds
 * a second Level in for one week, or combines two Circles for one sitting
 * while the rest stay split — the same shape, five times: a second
 * population is EXPECTED for this occurrence, on top of the schedule's own.
 *
 * ## Five facts, five independent controls
 *
 * Each dimension is its own `MultiSelectField`, seeded with the schedule's
 * own currently-effective value(s) and editable independently — clearing the
 * Level control while a Circle override stays chosen is an ordinary save.
 * The dialog shows the **venue** as read-only text — *where the class meets*
 * is decided by the schedule and the room, and this screen does not change it.
 *
 * ## Replacement per dimension, not addition
 *
 * Each control's chosen list **is** that dimension's contribution. To avoid
 * the ambiguity an additive rule would create — *does the schedule's own
 * value still count?* — every control opens with the inherited value(s)
 * **already selected**, so *combine* is expressed by adding the second one.
 * Clearing a control's every value removes THAT dimension's override alone.
 *
 * ## Every teaching mode now, not `entire_level` alone
 *
 * R92's own branch-only override refused every other schedule mode and
 * reported the rest rather than inventing semantics nobody asked for; that
 * generalisation is this dialog, reached through `audienceForSession`'s own
 * `multi_dimension` composition regardless of the schedule's real mode.
 *
 * ## This occurrence only
 *
 * Said on the screen, because *only this one* is precisely the thing an
 * administrator would otherwise have to infer from what did not change — the
 * same reasoning the one-off staffing dialog records.
 */
/**
 * **Codex review, 2026-09-20 — every row, not just the first page.**
 *
 * `listAdministrativeGroups`/`listCircles` were each called once, at
 * `pageSize = 100`, and their `meta.total` discarded — an institute with
 * more than 100 groups or more than 100 circles had entries a combined
 * class simply could not select, with no affordance saying any were
 * missing. Walks the SAME unscoped read Revision 157's own multi_dimension
 * picker established, one page at a time, until every row named by
 * `meta.total` has been collected. A ~2000-row cap guards against a
 * malformed `meta.total` looping forever; no institute this platform serves
 * is within two orders of magnitude of that.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 100;
  const maxPages = 20;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    rows.push(...result.data);
    if (rows.length >= result.meta.total || result.data.length < pageSize) break;
  }
  return rows;
}

/** The five lists, as `PUT /sessions/{id}/audience` and «تعديل الحصة» send them. */
export interface SessionAudienceChoice {
  branchIds: string[];
  categoryIds: string[];
  levelIds: string[];
  administrativeGroupIds: string[];
  teachingGroupIds: string[];
}

export interface SessionAudienceState {
  roster: SessionRoster | null;
  chosen: SessionAudienceChoice;
  set: <K extends keyof SessionAudienceChoice>(key: K, next: string[]) => void;
  options: {
    categories: { value: string; label: string }[];
    levels: { value: string; label: string }[];
    groups: { value: string; label: string }[];
    circles: { value: string; label: string }[];
  };
  /** Differs from what it opened on — order-blind. What decides whether a save
   *  SENDS the audience at all: re-sending an inherited audience untouched
   *  would turn it into an override nobody made. */
  dirty: boolean;
  loadFailed: boolean;
}

const EMPTY_CHOICE: SessionAudienceChoice = {
  branchIds: [],
  categoryIds: [],
  levelIds: [],
  administrativeGroupIds: [],
  teachingGroupIds: [],
};

/**
 * **One occurrence's audience, as state** — shared by the «الحضور» dialog and by
 * «تعديل الحصة» (SRS Revision 166 §2), so the two cannot seed, offer or compare
 * an audience differently.
 *
 * Unscoped lists, like the multi_dimension class picker's own reads (Revision
 * 157): every group and circle on the platform, never the Level+branch-chained
 * list — combining across boundaries is exactly the case that list cannot
 * answer. **Every page**, and a failed load says so rather than silently
 * offering fewer options than the platform has (codex review, 2026-09-20).
 *
 * **Seeded with the inherited value(s)**, which is what makes *replacement* the
 * only rule anybody has to hold in their head. `active: false` requests nothing.
 */
export function useSessionAudience({
  sessionId,
  token,
  active,
}: {
  sessionId: string;
  token: string | null;
  active: boolean;
}): SessionAudienceState {
  const scope = useScopeOptions({
    token,
    fields: active ? (['categoryId', 'levelId'] as const) : [],
    mode: 'form',
  });
  const [groups, setGroups] = useState<AdministrativeGroup[]>([]);
  const [circles, setCircles] = useState<TeachingGroupRow[]>([]);
  const [roster, setRoster] = useState<SessionRoster | null>(null);
  const [chosen, setChosen] = useState<SessionAudienceChoice>(EMPTY_CHOICE);
  const [initial, setInitial] = useState<SessionAudienceChoice>(EMPTY_CHOICE);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    void fetchAllPages((page) => listAdministrativeGroups(token, page, {}, null, 100))
      .then(setGroups)
      .catch(() => setLoadFailed(true));
    void fetchAllPages((page) => listCircles(token, page, {}, null, 100))
      .then(setCircles)
      .catch(() => setLoadFailed(true));
  }, [token, active]);

  useEffect(() => {
    if (!active) return;
    void fetchSessionRoster(sessionId, token)
      .then((r) => {
        setRoster(r);
        const seeded: SessionAudienceChoice = {
          branchIds: r.audience.branches.map((b) => b.id),
          categoryIds: r.audience.categories.map((c) => c.id),
          levelIds: r.audience.levels.map((l) => l.id),
          administrativeGroupIds: r.audience.administrative_groups.map((g) => g.id),
          teachingGroupIds: r.audience.teaching_groups.map((c) => c.id),
        };
        setChosen(seeded);
        setInitial(seeded);
      })
      .catch(() => setLoadFailed(true));
  }, [sessionId, token, active]);

  // Through the shared comparison rather than a hand-rolled join. Sorted
  // first, because a picker returns ids in click order and choosing A then B
  // is the same audience as choosing B then A — `isDirty` is deliberately
  // order-sensitive, so the sort is what makes it mean *changed*.
  const dirty = (Object.keys(EMPTY_CHOICE) as (keyof SessionAudienceChoice)[]).some((key) =>
    isDirty([...chosen[key]].sort(), [...initial[key]].sort()),
  );

  return {
    roster,
    chosen,
    set: (key, next) => setChosen((current) => ({ ...current, [key]: next })),
    options: {
      categories: scope.options.categoryId,
      levels: scope.options.levelId,
      groups: groups.map((g) => ({ value: g.id, label: g.name })),
      circles: circles.map((c) => ({ value: c.id, label: c.name })),
    },
    dirty,
    loadFailed,
  };
}

/** The five pickers and the head-count — the same in both places that show them. */
export function SessionAudienceFields({
  audience,
  branches,
}: {
  audience: SessionAudienceState;
  branches: { id: string; name: string }[];
}): ReactNode {
  const { roster, chosen, set, options } = audience;
  return (
    <>
      <MultiSelectField
        label={t('admin.calendar.scopeBranch')}
        options={branches.map((b) => ({ value: b.id, label: b.name }))}
        selected={chosen.branchIds}
        onChange={(next) => set('branchIds', next)}
        hint={t('admin.sessions.audienceBranchesHint')}
      />
      <MultiSelectField
        label={t('admin.calendar.scopeCategory')}
        options={options.categories}
        selected={chosen.categoryIds}
        onChange={(next) => set('categoryIds', next)}
      />
      <MultiSelectField
        label={t('admin.calendar.scopeLevel')}
        options={options.levels}
        selected={chosen.levelIds}
        onChange={(next) => set('levelIds', next)}
      />
      <MultiSelectField
        label={t('admin.calendar.scopeGroup')}
        options={options.groups}
        selected={chosen.administrativeGroupIds}
        onChange={(next) => set('administrativeGroupIds', next)}
      />
      <MultiSelectField
        label={t('admin.calendar.scopeCircle')}
        options={options.circles}
        selected={chosen.teachingGroupIds}
        onChange={(next) => set('teachingGroupIds', next)}
      />

      {roster ? (
        <p className="staff-picker__warnings">
          <Badge tone={roster.overridden ? 'warn' : 'neutral'}>
            {t('admin.sessions.audienceCount').replace('{n}', String(roster.students.length))}
          </Badge>
          {roster.overridden ? (
            <Badge tone="warn">{t('admin.sessions.audienceOverridden')}</Badge>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

export function SessionAudienceDialog({
  sessionId,
  version,
  date,
  branches,
  onClose,
  onSaved,
  token,
}: {
  sessionId: string;
  version: number;
  date: string;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (message: string) => void;
  token: string | null;
}): ReactNode {
  const audience = useSessionAudience({ sessionId, token, active: true });
  const { roster } = audience;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <FormDialog
      open
      wide
      title={t('admin.sessions.audienceTitle').replace('{date}', date)}
      notice={notice ?? (audience.loadFailed ? t('admin.sessions.audienceLoadFailed') : null)}
      busy={busy}
      dirty={audience.dirty}
      onCancel={onClose}
      onSubmit={async () => {
        setBusy(true);
        try {
          await setSessionAudienceOverrides(sessionId, version, audience.chosen, token);
          onSaved(t('admin.sessions.audienceSaved'));
        } catch {
          setNotice(t('admin.sessions.audienceSaveFailed'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="field__hint">{t('admin.sessions.audienceHint')}</p>

      {/* **The venue, as text.** Where the class meets is not what this screen
          changes, and showing it as a control would say otherwise (rule AF's
          reasoning, applied to a field this dialog simply does not own). */}
      {roster ? (
        <p className="field__hint">
          <strong>{t('admin.sessions.audienceVenue')}</strong>{' '}
          {roster.venue.branch_name}
          {roster.venue.room_name ? ` — ${roster.venue.room_name}` : ''}
        </p>
      ) : null}

      <SessionAudienceFields audience={audience} branches={branches} />

      {/* The roster itself, so an administrator reads who is expected rather
          than inferring it from calendar behaviour. Each name carries the branch
          she comes from, which is what makes a combined list legible. */}
      {roster && roster.students.length > 0 ? (
        <ul className="multi-select__options">
          {roster.students.map((s) => (
            <li key={s.id}>
              {s.name}
              {s.branch_id ? (
                <span className="muted">
                  {' — '}
                  {branches.find((b) => b.id === s.branch_id)?.name ?? ''}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </FormDialog>
  );
}
