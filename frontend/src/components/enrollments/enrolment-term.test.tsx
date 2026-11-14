import { describe, expect, it } from 'vitest';

import TERM from './enrolment-term.tsx?raw';
import GROUPS from '../../pages/admin/groups.tsx?raw';
import ADAPTER from '../../adapters/administrative-groups.ts?raw';
import SHELL from '../portal/portal-shell.tsx?raw';
import SESSIONS from '../../pages/admin/schedule-sessions.tsx?raw';

describe('R271 on «مجموعات المستويات» — the whole year by default, one semester as the exception', () => {
  it('opens on the year, the current one chosen', () => {
    expect(TERM).toContain("useState<'year' | 'semester'>('year')");
    expect(TERM).toContain("rows.find((y) => y.is_current)?.id");
  });

  it('the roster sends what the form chose — it sent no term at all before (refused since R122)', () => {
    expect(ADAPTER).toContain('body: { student_id: studentId, ...term },');
    expect(GROUPS).toContain('await enrolStudent(group.id, studentId, term.value, token);');
    expect(GROUPS).toContain('{term.field}');
  });
});

describe('R273 — a role switch lands on that role\'s dashboard', () => {
  it('the shell sends a refused reader home only once the session has said who she is', () => {
    expect(SHELL).toContain("if (!permitted && me !== null) window.location.replace('/');");
  });
});

describe('R272 — «حصص الجدول» names its class', () => {
  it('the class title is the page subtitle', () => {
    expect(SESSIONS).toContain('lede={klass?.title ?? null}');
  });
});
