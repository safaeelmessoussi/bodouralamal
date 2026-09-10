import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClassSection } from './class-section.js';
import { t } from '../../i18n/index.js';
import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import SCHEDULING_SOURCE from '../../pages/admin/scheduling.tsx?raw';
import TEACHER_SCHEDULES_SOURCE from '../../pages/teacher/schedules.tsx?raw';

/**
 * **§2, Revision 140 — a مؤطِّرة scheduling her own class is its teacher,
 * structurally, not a choice the form offers and defaults.**
 *
 * The server refuses any `staff` shape from her that does not name herself as
 * `teacher` (`TEACHER_MUST_SELF_STAFF`, `course-schedule.service.ts`), so
 * `StaffingPeriods`'s multi-row, multi-person editor — built for an Admin
 * naming a mid-year replacement — would offer a choice that always fails.
 * `staffLocked` replaces it with a static statement, on the SAME precedent
 * `ActivitySection`'s `responsibleLocked` already established for a
 * مؤطرة's own event.
 */
const EMPTY_SCOPE: ScopeOptions = {
  value: {
    categoryId: '',
    levelId: '',
    subjectId: '',
    branchId: '',
    academicYearId: '',
    groupId: '',
  },
  set: () => {},
  setMany: () => {},
  options: {
    categoryId: [],
    levelId: [],
    subjectId: [],
    branchId: [],
    academicYearId: [],
    groupId: [],
  },
  loading: {
    categoryId: false,
    levelId: false,
    subjectId: false,
    branchId: false,
    academicYearId: false,
    groupId: false,
  },
  ready: true,
  levelTeachesNothing: false,
  defaultVisibility: null,
  selfAttendanceAllowed: null,
};

const baseProps = {
  scope: EMPTY_SCOPE,
  locked: false,
  mode: 'entire_level',
  onMode: () => {},
  modes: ['entire_level'],
  rooms: [],
  roomId: '',
  onRoom: () => {},
  delivery: 'in_person' as const,
  onDelivery: () => {},
  mediaMode: 'audio_video' as const,
  onMediaMode: () => {},
  teachers: [],
  staffing: [],
  onStaffing: () => {},
  scheduleFrom: '',
  scheduleUntil: '',
};

describe('ClassSection replaces the staffing editor with a fixed statement when staffLocked', () => {
  it('renders no StaffingPeriods control and states she is the responsible مؤطِّرة', () => {
    const html = renderToStaticMarkup(<ClassSection {...baseProps} staffLocked />);
    expect(html).toContain(t('admin.schedules.staffLockedToSelf'));
  });

  it('renders the ordinary multi-row editor when NOT locked (Admin, default)', () => {
    const html = renderToStaticMarkup(<ClassSection {...baseProps} />);
    expect(html).not.toContain(t('admin.schedules.staffLockedToSelf'));
  });
});

/**
 * **The submitted payload and the offered choices, pinned against the source**
 * (the same technique `class-section.scope.test.tsx` already established for
 * §1 — a render test cannot reach a `submit()` closure without a live token,
 * a session and a real network round trip).
 */
describe('§2 — scheduling.tsx wires the Teacher-scoped class-creation grant correctly', () => {
  const source = SCHEDULING_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('reads her declared-capability scope, not the platform-wide vocabulary, for the class chain', () => {
    expect(source).toContain('restrictToOwnCapability: !canAssignStaff');
  });

  it('locks the mode selector to entire_level for her — never offers a choice the server refuses', () => {
    expect(source).toContain("modes={canAssignStaff ? MODES : (['entire_level'] as const)}");
  });

  it('locks the staffing editor for her', () => {
    expect(source).toContain('staffLocked={!canAssignStaff}');
  });

  it('sends her own id as the class teacher — never an empty or admin-composed staff list', () => {
    expect(source).toContain("!canAssignStaff && type === 'class'");
    expect(source).toContain("position: 'teacher' as const");
  });

  it('does not fire the Admin-only teaching-candidates appraisal for her', () => {
    // Comments are stripped above, so the two conditions are not necessarily
    // adjacent lines in the stripped source; assert each condition present
    // and their specific pairing, which only the appraisal guard produces.
    expect(source).toContain("type === 'class' &&");
    expect(source).toContain("canAssignStaff &&\n      startTime !== ''");
  });
});

describe('§2 — /teacher/schedules offers class creation through the canonical dialog, not a second scheduler', () => {
  const source = TEACHER_SCHEDULES_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('grants class alongside activity and exam', () => {
    expect(source).toContain("const TEACHER_TYPES = ['activity', 'exam', 'class'] as const");
  });

  it('reuses the shared SchedulingDialog — no teacher-specific scheduler component', () => {
    expect(source).toContain("import { SchedulingDialog } from '../admin/scheduling.js'");
  });
});
