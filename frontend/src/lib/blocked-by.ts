import { ApiError } from './api.js';
import { t } from '../i18n/index.js';

/**
 * **A deletion refused because something still uses the record** (TD-5).
 *
 * ## The two things `STATE_CONFLICT` was saying at once
 *
 * TD-5 answers a prohibited deletion with `409 STATE_CONFLICT`, and the code
 * catalogue maps that to one message: *«تم تعديل هذا العنصر أو تغيّرت حالته.
 * يرجى تحديث الصفحة.»* — which is **true of a stale-state conflict and false of
 * this one.** Refreshing cannot resolve a Branch that a group and a schedule
 * still reference; the reader follows the instruction, nothing changes, and the
 * action reads as broken.
 *
 * **The envelope already distinguishes them and no contract change is needed.**
 * Optimistic staleness is its own code — `VERSION_CONFLICT` — and a blocked
 * deletion is the only thing that carries `details.blocked_by`. That pair is a
 * stable discriminator, so this classifies on it rather than on the sentence.
 *
 * *(The server's own `message` still says «refresh» for this case. Correcting
 * that needs a distinct `message_key`, which is a change to TD-3.8's envelope
 * and therefore the Document Owner's — reported rather than taken.)*
 *
 * ## Product words, not backend keys
 *
 * `blocked_by` is keyed by the SERVICE's label — `groups`, `course_schedules` —
 * which are names for tables. A person reading a refusal needs the association's
 * own vocabulary, so every label the five call sites can emit is translated
 * here, in one place, rather than per screen.
 */
export interface BlockingDependency {
  /** The association's word for the thing, already translated. */
  label: string;
  count: number;
}

/**
 * Every label `assertNoBlockingReferences` can emit, across all five
 * reference-data deletions (Category, Subject, Level, Branch, Room).
 *
 * **An unknown key falls back to the key itself rather than being dropped.** A
 * silently omitted dependency would tell somebody the record is deletable when
 * it is not — worse than an untranslated word, and the `resolves.test.ts` sweep
 * plus the guard below keep the list honest.
 */
const LABELS: Record<string, string> = {
  rooms: 'states.err.blockedBy.rooms',
  groups: 'states.err.blockedBy.groups',
  course_schedules: 'states.err.blockedBy.courseSchedules',
  sessions: 'states.err.blockedBy.sessions',
  levels: 'states.err.blockedBy.levels',
  subjects: 'states.err.blockedBy.subjects',
  teaching_groups: 'states.err.blockedBy.teachingGroups',
  exams: 'states.err.blockedBy.exams',
  grades: 'states.err.blockedBy.grades',
  content: 'states.err.blockedBy.content',
  events: 'states.err.blockedBy.events',
  enrollments: 'states.err.blockedBy.enrollments',
  pending_requests: 'states.err.blockedBy.pendingRequests',
  /**
   * **R131 §4.3's account purposes, carried on the SAME channel** (2026-09-04).
   *
   * A remaining purpose is a dependency blocking a closure, so it is the same
   * question this component already answers — *«what stops this, and what do I
   * resolve first»*. Giving it a second shape would have meant a second notice
   * component beside this one, and the guardian-cleanup refusal briefly HAD no
   * reach at all because the service emitted its own `purposes` array that
   * nothing here could read.
   */
  beneficiary: 'states.err.blockedBy.beneficiary',
  staff_role: 'states.err.blockedBy.staffRole',
  live_family_link: 'states.err.blockedBy.liveFamilyLink',
  pending_family_link: 'states.err.blockedBy.pendingFamilyLink',
  pending_child_application: 'states.err.blockedBy.pendingChildApplication',
  self_managed: 'states.err.blockedBy.selfManaged',
};

/**
 * The dependencies blocking this deletion, or `null` when the failure is not
 * one — a stale version, a lost connection, anything else.
 *
 * `null` is the important half: a caller that treated every `409` as blocked
 * would explain dependencies that do not exist for a genuine version conflict,
 * where refreshing IS the right advice.
 */
export function blockingDependencies(error: unknown): BlockingDependency[] | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== 'STATE_CONFLICT') return null;
  const raw = (error.details as { blocked_by?: unknown } | undefined)?.blocked_by;
  if (raw === null || typeof raw !== 'object') return null;

  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([key, count]) => ({
      label: LABELS[key] === undefined ? key : t(LABELS[key]),
      count: count as number,
    }));
  return entries.length > 0 ? entries : null;
}

/** The labels this module knows, for the guard that keeps them translated. */
export const BLOCKED_BY_KEYS = Object.keys(LABELS);
export const BLOCKED_BY_LABEL_KEYS = Object.values(LABELS);
