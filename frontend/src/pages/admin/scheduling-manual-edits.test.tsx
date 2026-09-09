import { describe, expect, it } from 'vitest';

import SCHEDULING_SOURCE from './scheduling.tsx?raw';
import SCHEDULE_SESSIONS_SOURCE from './schedule-sessions.tsx?raw';

/**
 * **R138 §4.4 items 5-6 — both callers actually ask, and actually thread the
 * answer through.**
 *
 * `manual-edits-dialog.test.tsx` covers the shared component and its
 * eligibility filter in isolation; this file pins that **both** places the
 * Owner named — the series editor (`scheduling.tsx`, item 5) and the
 * occurrence editor's wider scopes (`schedule-sessions.tsx`, item 6) — reach
 * the SAME component instead of growing their own, and that the answer
 * actually reaches the request rather than being computed and discarded.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the series editor (تعديل العنصر) asks before overwriting manually edited Sessions', () => {
  const src = code(SCHEDULING_SOURCE);

  it('imports the ONE shared dialog and filter, not a local copy', () => {
    expect(SCHEDULING_SOURCE).toContain(
      "from '../../components/scheduling/manual-edits-dialog.js'",
    );
    expect(src).toContain('ManualEditsDialog');
    expect(src).toContain('sessionsEligibleForOverwrite');
  });

  it('checks only for an EXISTING class, not on create', () => {
    expect(src).toContain("type === 'class' && item !== null");
  });

  it('the resumed call skips the check — asked once, not on every resubmit', () => {
    expect(src).toContain('overwriteManuallyEdited === undefined');
  });

  it('threads the answer into the request, not just into local state', () => {
    expect(src).toContain('overwriteManuallyEdited: overwriteManuallyEdited ?? false');
  });
});

describe('the occurrence editor’s wider scopes ask the SAME question, item 6', () => {
  const src = code(SCHEDULE_SESSIONS_SOURCE);

  it('imports the ONE shared dialog and filter, not a local copy', () => {
    expect(SCHEDULE_SESSIONS_SOURCE).toContain(
      "from '../../components/scheduling/manual-edits-dialog.js'",
    );
    expect(src).toContain('ManualEditsDialog');
    expect(src).toContain('sessionsEligibleForOverwrite');
  });

  it('narrows to the split’s surviving half for this_and_future, whole schedule for all_sessions', () => {
    expect(src).toContain("scope === 'this_and_future' ? session.date : undefined");
  });

  it('threads the answer through to the schedule request', () => {
    expect(src).toContain('overwrite_manually_edited: overwriteManuallyEdited');
  });
});

describe('R138 §4.4 item 2 — title/description are unified into the Session editor', () => {
  const src = code(SCHEDULE_SESSIONS_SOURCE);

  it('the occurrence editor opens on the occurrence’s OWN title/description', () => {
    expect(src).toContain('useState(session.title)');
    expect(src).toContain("useState(session.description ?? '')");
  });

  it('title/description travel with the wider scopes, like delivery_mode/visibility', () => {
    expect(src).toContain('title: edit.title');
    expect(src).toContain('description: edit.description');
  });
});
