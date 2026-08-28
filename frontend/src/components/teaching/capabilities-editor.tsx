import type { ReactNode } from 'react';

import { MultiSelectField } from '../ui/multi-select.js';
import { t } from '../../i18n/index.js';

/**
 * **المواد التي يمكنها تدريسها · الفئات** — the two declarations, as one
 * component (2026-08-30).
 *
 * ## Why this exists
 *
 * It was written out inside `TeachingProfileDialog`, which was correct while
 * one screen had it. The Owner has now given a مؤطِّرة the same two controls on
 * `/teacher/availability`, and a second hand-written copy is how the pair drift
 * — one screen gaining a hint, a label, or a sort the other never gets (rule C:
 * one concept, one atomic component).
 *
 * This is the sibling of `AvailabilityEditor`, extracted for exactly the reason
 * that one was: *"the moment a مؤطِّرة could edit her own ranges there would
 * have been two copies of R88's subtleties — one of which would drift."*
 *
 * ## The sentence is part of the component
 *
 * A form listing Subjects and Categories looks precisely like a permissions
 * form. The planning-only line therefore travels **with** the controls rather
 * than being each caller's job to remember — the reader who most needs it is
 * the one on the screen that forgot it.
 *
 * ## It grants nothing
 *
 * `TeacherSubjectCapability` and `TeacherCategoryCapability` are planning
 * metadata (§4.4c, R88.3, R73, R87). Teaching authority is an **assignment**,
 * resolved from `CourseScheduleStaff`/`SessionStaff`; nothing here touches
 * either. The server enforces that separation — this component only renders.
 */
export interface CapabilityOption {
  id: string;
  name: string;
}

export function CapabilitiesEditor({
  subjects,
  categories,
  subjectIds,
  categoryIds,
  onSubjects,
  onCategories,
  disabled = false,
}: {
  subjects: readonly CapabilityOption[];
  categories: readonly CapabilityOption[];
  subjectIds: string[];
  categoryIds: string[];
  onSubjects: (next: string[]) => void;
  onCategories: (next: string[]) => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <>
      {/* **Said on the screen, not only in the docs.** This is the sentence that
          stops a reader believing she has just granted or gained access. */}
      <p className="field__hint">{t('admin.teachingProfile.planningOnly')}</p>

      <MultiSelectField
        label={t('admin.teachingProfile.subjects')}
        options={subjects.map((s) => ({ value: s.id, label: s.name }))}
        selected={subjectIds}
        onChange={onSubjects}
        disabled={disabled}
      />

      <MultiSelectField
        label={t('admin.teachingProfile.categories')}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        selected={categoryIds}
        onChange={onCategories}
        disabled={disabled}
      />
    </>
  );
}
