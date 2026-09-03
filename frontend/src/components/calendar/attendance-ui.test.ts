import { describe, expect, it } from 'vitest';

/**
 * **الحضور — the four properties of the interface that are rules, not styling**
 * (SRS §4.7, R123).
 *
 * Source guards rather than renders, for the reason the sibling guards in this
 * directory give: each of these is a **decision about what is offered**, and a
 * render test proves it for one fixture while a missing branch ships for every
 * other. Each is written so that removing the line it pins fails it — the
 * property this project requires of a new guard before counting it as
 * protection.
 */
import panel from './attendance-panel.tsx?raw';
import dialog from './event-details-dialog.tsx?raw';
import form from '../scheduling/scheduling-form.tsx?raw';

describe('R123 — a vacation and a party offer nothing at all', () => {
  it('renders no panel when the occurrence takes no attendance', () => {
    // The server refuses every route for these; the client half is that the
    // reader is never shown a control that leads to a refusal.
    expect(panel).toContain("occurrence.attendance_mode === 'disabled'");
    expect(panel).toMatch(/attendance_mode === 'disabled'\)\s*return null;/);
  });
});

describe('R123 — a beneficiary gets one button and never the roster', () => {
  it('offers «تسجيل حضوري» only on a self_or_staff occurrence', () => {
    expect(panel).toContain("occurrence.attendance_marking === 'self_or_staff'");
  });

  it('hides it entirely unless the SERVER says her Category permits it', () => {
    // The Owner's rule is that اليافعات and الطفل see NO self check-in control.
    // `self_attendance_allowed` is derived server-side precisely so the control
    // can be hidden rather than discovered by pressing a button that fails.
    expect(panel).toContain('self_attendance_allowed === true');
    // And it is never inferred from a Category's Arabic name (§4.4b). The
    // property is *no name is compared*, not *no name is mentioned* — the
    // comments explain the rule and must be free to say whose rule it is, so
    // the guard looks for a quoted LITERAL, which is what a comparison needs.
    for (const name of ['المرأة', 'اليافعات', 'الطفل']) {
      expect(panel).not.toContain(`'${name}'`);
      expect(panel).not.toContain(`"${name}"`);
    }
  });

  it('never renders the sheet for a non-staff reader', () => {
    // The staff branch returns before the self branch is reached, so a
    // beneficiary cannot fall through into the roster.
    const staffFirst = panel.indexOf('if (isStaff) return <StaffSheet');
    const selfLater = panel.indexOf('function SelfCheckIn');
    expect(staffFirst).toBeGreaterThan(0);
    expect(selfLater).toBeGreaterThan(staffFirst);
    // `SelfCheckIn` renders one action and **never reads the sheet**, which is
    // where the roster would come from. Asserting on the read is the property;
    // asserting on the word «expected» would pass or fail on a comment.
    const self = panel.slice(selfLater, panel.indexOf('function StaffSheet'));
    expect(self).toContain('attendance.selfCheckIn');
    expect(self).toContain('attendance.selfDone');
    expect(self).not.toContain('readAttendance');
    expect(self).not.toContain('attendanceCandidates');
  });
});

describe('R123 — an activity occurrence carries its date', () => {
  it('sends the occurrence date for an event and never for a session', () => {
    // A recurring نشاط is ONE row expanded over many dates, so attendance for
    // 10 February must not become attendance for every recurrence.
    expect(panel).toContain("occurrence.kind === 'event' ? occurrence.date : null");
  });
});

describe('R123 — the configuration form states the rule rather than offering it', () => {
  it('says which of the three states the chosen type is', () => {
    expect(form).toContain('scheduling.attendanceNone');
    expect(form).toContain('scheduling.attendanceOptional');
    expect(form).toContain('scheduling.attendanceRequired');
  });

  it('offers self-marking ONLY where the Category permits it', () => {
    // Withheld, not disabled — and the hint says which it is, so the absence
    // reads as a rule rather than as a missing feature.
    expect(form).toContain('selfAttendanceAllowed === true');
    expect(form).toContain('scheduling.attendanceMarkingStaffOnlyHint');
    // Structural: no client compares a Category's name — a quoted literal is
    // what a comparison needs, and the prose above it is free to name the rule.
    expect(form).not.toContain("'اليافعات'");
    expect(form).not.toContain('"اليافعات"');
  });

  it('still shows a stored self_or_staff so a save cannot change it silently', () => {
    expect(form).toContain("attendanceMarking === 'self_or_staff'");
  });
});

describe('R123 — the register is reachable from the occurrence everyone opens', () => {
  it('is mounted in the shared details dialog, not behind a menu node', () => {
    expect(dialog).toContain('<AttendancePanel occurrence={occurrence} />');
  });
});

describe('R123 — the panel lives in a dialog the PUBLIC calendar opens', () => {
  it('reads the active role optionally, never through the hook that throws', () => {
    /**
     * **This is the defect, not a style preference.** `useActiveRole` throws
     * outside `ActiveRoleProvider`, and the shared occurrence dialog is opened
     * by the anonymous calendar and rendered standalone in tests — so the first
     * version of this panel crashed every public occurrence dialog. The
     * calendar's own suite caught it; this pins it so the next edit cannot
     * reintroduce it silently.
     */
    expect(panel).toContain('useActiveRoleOrNull');
    expect(panel).not.toMatch(/\buseActiveRole\(/);
    // Same discipline for the session: read optionally, never demanded.
    expect(panel).toContain('useContext(SessionContext)');
  });
});
