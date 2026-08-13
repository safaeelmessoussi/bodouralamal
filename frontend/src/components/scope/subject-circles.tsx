import type { ReactNode } from 'react';

import type { SubjectSplit, TeachingGroup } from '../../adapters/teaching-groups.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { t } from '../../i18n/index.js';

/**
 * **One Subject's circles, and BR-22's alarm** — the block `حلقات المواد` is
 * built from.
 *
 * Extracted so the management overview renders one Subject the same way for
 * every Subject on the page, rather than the screen growing a second rendering
 * of the split it already knew how to draw.
 *
 * **`split: false` is its own state and not an empty list** (§4.4c): a Subject
 * with no circles is taught to the entire Level, so *the question does not
 * apply* — showing "everyone is placed" there would be a different and falsely
 * reassuring claim.
 *
 * **BR-22 is the reason this screen exists** and it is not a footnote here
 * either: a student enrolled in a Level whose Subject is split, holding no
 * circle for it, has **no sessions for that subject at all**, and nothing else
 * in the platform says so. The unassigned list is rendered before the circles,
 * never paginated, and never collapsed behind anything.
 */
export function SubjectCircles({
  split,
  canManageGroups,
  canPlace,
  onCreate,
  onEdit,
  onDelete,
  onPlace,
}: {
  split: SubjectSplit;
  /** R43.3 — circle STRUCTURE is Super Admin. */
  canManageGroups: boolean;
  /** R43.3 — MEMBERSHIP is Admin, branch-scoped by the server. */
  canPlace: boolean;
  onCreate: () => void;
  onEdit: (group: TeachingGroup) => void;
  onDelete: (group: TeachingGroup) => void;
  onPlace: (groupId: string, studentId: string) => void;
}): ReactNode {
  return (
    <>
      {!split.split ? (
        <p className="state">{t('admin.subjectOrg.notSplit')}</p>
      ) : (
        <>
          {split.unassigned.length > 0 ? (
            <div className="admin-notice" role="status">
              <strong>
                {t('admin.subjectOrg.unassignedTitle')}{' '}
                <Badge tone="warn">{String(split.unassigned.length)}</Badge>
              </strong>
              <p className="lede">{t('admin.subjectOrg.unassignedLede')}</p>
              <ul className="admin-list">
                {split.unassigned.map((u) => (
                  <li key={u.student_id}>
                    <span>{u.name ?? u.student_id}</span>
                    {canPlace ? (
                      <select
                        className="field__input"
                        defaultValue=""
                        aria-label={t('admin.subjectOrg.placeIn')}
                        onChange={(e) => {
                          if (e.target.value) onPlace(e.target.value, u.student_id);
                        }}
                      >
                        <option value="">{t('admin.subjectOrg.placeIn')}</option>
                        {split.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul className="admin-list">
            {split.groups.map((g) => (
              <li key={g.id}>
                <span>
                  {g.name} — {t('admin.subjectOrg.members').replace('{n}', String(g.member_count))}
                </span>
                {canManageGroups ? (
                  <>
                    <Button variant="secondary" onClick={() => onEdit(g)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="secondary" onClick={() => onDelete(g)}>
                      {t('common.delete')}
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* R43.3 — creating a circle is Super Admin. The action sits beside the
          Subject it affects, which is the whole point of the overview. */}
      {canManageGroups ? (
        <Button variant="secondary" onClick={onCreate}>
          {t('admin.subjectOrg.create')}
        </Button>
      ) : null}
    </>
  );
}
