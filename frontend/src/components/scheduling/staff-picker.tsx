import type { ReactNode } from 'react';

import { Badge } from '../ui/badge.js';
import { SelectField } from '../ui/field.js';
import { MultiSelectField } from '../ui/multi-select.js';
import { t } from '../../i18n/index.js';
import type { TeachingCandidate } from '../../adapters/teaching-candidates.js';
/**
 * **The picker takes the narrow directory entry, not the account record.**
 *
 * It reads `id` and `name_arabic` and nothing else, so it is typed to what it
 * uses. Typing it to the account record was how five operational screens came to
 * fetch every user's email, phone and account status in order to render a list
 * of names (Owner clarification, 2026-08-28).
 */
import type { DirectoryEntry } from '../../adapters/users.js';

/**
 * **One lead مؤطرة, and any number of assistants.**
 *
 * The same shape three parts of the platform need and, until R71, two of them
 * had written out longhand:
 *
 * | | Lead | Where |
 * |---|---|---|
 * | A course schedule | `teacher` | §4.4c, R43 |
 * | An exam sitting | `supervisor` | §4.6, R58 |
 * | An event | `responsible` | §4.4, **R71** |
 *
 * **The lead's NAME differs and that is deliberate** — §20 rule 22: a مؤطرة who
 * supervises an exam is not teaching it, and one responsible for a celebration
 * is doing neither. The *control* is identical, so it is shared; the *word* is
 * passed in, so the vocabulary stays each feature's own.
 *
 * **The lead is excluded from the assistant list.** One person holds one
 * position on one thing, and every server refuses the pair as a duplicate — so
 * offering somebody as both is offering a refusal.
 *
 * This renders no fieldset wrapper of its own beyond the assistants' one,
 * because it is composed into sections that already own their layout.
 *
 * ## The planning appraisal (R90)
 *
 * When `appraisal` is supplied, a candidate the R88 teaching profile suggests
 * may not suit this class is marked — **before** selection in the option's own
 * label, and **after** it as compact chips naming exactly what is wrong. Neither
 * removes her from the list and neither disables anything: R88.4 is explicit
 * that a mismatch **warns and never blocks**, and the association resolves
 * exceptional cases outside the system.
 *
 * **A candidate with nothing wrong is completely silent.** Four indicators
 * beside every name would be four things to read past on the ordinary case,
 * which is most cases.
 *
 * **The picker does not decide who may teach and never has** (rule O). The
 * caller passes the permitted dataset; the appraisal only annotates it; the
 * server is the authority, and what grants teaching authority is the assignment
 * this control produces — not anything it displays.
 */
export interface StaffPickerProps {
  staff: DirectoryEntry[];
  /** The label for the single lead — «المشرفة», «المسؤولة», «المؤطِّرة». */
  leadLabel: string;
  leadId: string;
  onLead: (id: string) => void;
  assistantsLabel: string;
  assistantsHint: string;
  assistantIds: string[];
  onAssistants: (ids: string[]) => void;
  /** Rendered read-only for a caller who may see the assignment and not set it
   *  — R71.4 keeps event staffing with Admins, and the server enforces it. */
  disabled?: boolean;
  /**
   * R90's planning appraisal, keyed by user id. **Optional**: an exam sitting
   * and a celebration have no Subject and no curriculum Category, so there is
   * nothing there for a teaching profile to be appraised against, and a picker
   * with no appraisal behaves exactly as it did before.
   */
  appraisal?: Record<string, TeachingCandidate>;
  /**
   * **The people who may hold the LEAD position**, when that is narrower than
   * the people who may assist. The case that added it: a مؤطرة staffing her own
   * celebration is offered exactly herself here and the whole staff list below
   * — she may choose who helps her and may not hand the event to somebody else.
   *
   * Absent, it is `staff`, which is every existing caller's behaviour.
   *
   * **Named `lead`, not for the feature that needed it** (§20 rule 22): the
   * control owns the shape and each caller owns its word, and the guard beside
   * this file failed the moment the prop carried the event's vocabulary.
   */
  leadStaff?: DirectoryEntry[];
  /** Renders the lead read-only. The server refuses any other name regardless;
   *  this stops the control implying a choice that does not exist. */
  leadLocked?: boolean;
}

/** The words for each warning. One per kind, in the catalogue — never composed
 *  from fragments, which is how a sentence ends up half-translated. */
/** One key per warning kind. Exported for the same reason `markedLabel` is:
 *  two controls render these words and neither may own a private copy. */
export const WARNING_KEY: Record<string, string> = {
  subject_not_declared: 'admin.schedules.warnSubject',
  category_not_declared: 'admin.schedules.warnCategory',
  availability_not_declared: 'admin.schedules.warnNoAvailability',
  unavailable: 'admin.schedules.warnUnavailable',
  conflict: 'admin.schedules.warnConflict',
  availability_indeterminate: 'admin.schedules.warnIndeterminate',
};

/**
 * The chips for one chosen person, or nothing at all.
 *
 * **An empty profile is said once.** Somebody who has declared nothing is not
 * three separate failures; she is one fact the administration may want to fix,
 * and «لم تُسجَّل بيانات تخطيط» says it without accusing her of being busy.
 */
export function Warnings({ candidate }: { candidate: TeachingCandidate | undefined }): ReactNode {
  if (!candidate) return null;
  if (candidate.no_profile) {
    return (
      <p className="staff-picker__warnings">
        <Badge tone="neutral">{t('admin.schedules.warnNoProfile')}</Badge>
      </p>
    );
  }
  if (candidate.warnings.length === 0) return null;
  return (
    <p className="staff-picker__warnings">
      {candidate.warnings.map((w) => (
        <Badge key={w} tone="warn">
          {t(WARNING_KEY[w] ?? 'admin.schedules.warnUnknown')}
        </Badge>
      ))}
    </p>
  );
}

/**
 * The marker an option carries in the list, so a concern is visible BEFORE the
 * choice rather than only after it. A clean candidate carries none.
 *
 * **Exported, and that is the point** (rule AR, 2026-08-19). It lived here as a
 * private helper, so when R91 moved a class onto `StaffingPeriods` the *before
 * the choice* half of the rule was silently lost — the chips after selection
 * still worked, which is exactly what made it hard to notice. One
 * implementation, used by both controls.
 */
export function markedLabel(
  person: DirectoryEntry,
  appraisal: Record<string, TeachingCandidate> | undefined,
): string {
  const found = appraisal?.[person.id];
  if (!found) return person.name_arabic;
  if (found.no_profile) return `${person.name_arabic} — ${t('admin.schedules.warnMarkNoProfile')}`;
  if (found.warnings.length === 0) return person.name_arabic;
  return `${person.name_arabic} — ${t('admin.schedules.warnMark')}`;
}

export function StaffPicker({
  staff,
  leadLabel,
  leadId,
  onLead,
  assistantsLabel,
  assistantsHint,
  assistantIds,
  onAssistants,
  disabled = false,
  appraisal,
  leadStaff,
  leadLocked = false,
}: StaffPickerProps): ReactNode {
  const leadOptions = leadStaff ?? staff;
  return (
    <>
      <SelectField
        label={leadLabel}
        value={leadId}
        onChange={onLead}
        disabled={disabled || leadLocked}
        options={[
          // A locked lead offers no empty choice: there is one answer, and
          // «اختر…» would suggest otherwise.
          ...(leadLocked ? [] : [{ value: '', label: t('common.choose') }]),
          ...leadOptions.map((x) => ({ value: x.id, label: markedLabel(x, appraisal) })),
        ]}
      />
      {/* **Immediately after selection, beside the control it belongs to**
          (rule AH) — not on submit, and not as a page-level message about
          somebody the reader has to go and find. */}
      <Warnings candidate={appraisal?.[leadId]} />

      {/* **The assistants are a multi-select, not an expanded list** (2026-08-13).
          Every person rendered as a checkbox reads fine for a handful and turns
          the form into a page of checkboxes for a real roster — burying the
          fields below it. `MultiSelectField` shows the chosen as chips and
          filters the rest, so the control's height stops tracking the size of
          the association.

          **The lead is excluded here, not there**: one person holds one
          position on one thing, and the server refuses the pair as a duplicate,
          so offering somebody as both would be offering a refusal. The atomic
          control has no opinion about *why* an option is absent. */}
      <MultiSelectField
        label={assistantsLabel}
        options={staff
          .filter((x) => x.id !== leadId)
          .map((x) => ({ value: x.id, label: markedLabel(x, appraisal) }))}
        selected={assistantIds}
        onChange={onAssistants}
        hint={assistantsHint}
        disabled={disabled}
      />
      {/* **The same warnings for an assistant as for the lead** (R88.8): one
          profile per person, no assistant variant, and R87 §G's operational
          parity means the appraisal has no reason to differ. */}
      {assistantIds.map((id) => {
        const candidate = appraisal?.[id];
        if (!candidate || (candidate.warnings.length === 0 && !candidate.no_profile)) return null;
        return (
          <div key={id} className="staff-picker__assistant">
            <span className="muted">{candidate.name_arabic}</span>
            <Warnings candidate={candidate} />
          </div>
        );
      })}
    </>
  );
}
