import { describe, expect, it } from 'vitest';

import { ar } from '../../i18n/ar.js';
import { ADMIN_MODULES } from '../../lib/admin-modules.js';
import { IMPLEMENTED_ADMIN_PATHS } from './index.js';

/**
 * `/admin/teachers` — إدارة المؤطِّرات (R88 correction).
 *
 * The teaching profile shipped as a row action on `/admin/users`, a screen whose
 * population is *every account*: guardians, minors and administrators were all
 * offered a teaching profile. The correction is a question of **ownership**, so
 * what is guarded here is ownership: the action is gone from the generic screen,
 * the dedicated node exists and routes, the population is asked of the server by
 * role, and there is still exactly one teaching-profile editor.
 */

const RAW = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Comments explain the defect by naming it; only code is scanned. */
function code(path: string): string {
  const text = RAW[path];
  if (text === undefined) throw new Error(`no such source file: ${path}`);
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const USERS = code('/src/pages/admin/users.tsx');
const TEACHERS = code('/src/pages/admin/teachers.tsx');
const ROUTER = code('/src/pages/admin/index.tsx');

describe('the teaching profile left the generic account screen', () => {
  it('offers no teaching-profile action on المستخدمون', () => {
    // Both halves: the label the row action rendered, and the component it
    // opened. Either one surviving means the action is still reachable there.
    expect(USERS).not.toContain('teachingProfile');
    expect(USERS).not.toContain('TeachingProfileDialog');
  });

  it('leaves no orphaned reference data behind on that screen', () => {
    // The action loaded Subjects and Categories on demand purely to feed the
    // dialog. A page fetching reference data it never renders is the tell that
    // a removal stopped at the JSX.
    expect(USERS).not.toContain('listSubjects');
  });
});

describe('المؤطِّرات is a node of its own', () => {
  it('is an OPERATIONAL node — outside الإدارة, and open to an Admin', () => {
    const node = ADMIN_MODULES.find((m) => m.path === '/admin/teachers');
    expect(node).toBeDefined();
    // **Restated for R105, not weakened.** This read `section === 'academic'`,
    // and R105 deleted that section — but the section was never the property.
    // What matters is that the node is NOT in الإدارة, because placement there
    // is what makes a node Super-Admin-only (R61). `null` states exactly that.
    expect(node?.section).toBeNull();
    // Not Super-Admin-only: choosing who teaches what is operational Admin work.
    expect(node?.roles).toContain('admin');
    expect(node?.status).toBe('ready');
  });

  it('sits beside المستفيدات — the two populations, adjacent, teachers first', () => {
    // The pair is the property and it survives R105; the ORDER within it is
    // what the Owner changed — المؤطِّرات now precedes المستفيدات, so the menu
    // reads "the people who teach, then the people taught". Asserted as
    // adjacency plus direction, so either half failing names which one.
    const paths = ADMIN_MODULES.map((m) => m.path);
    expect(paths.indexOf('/admin/enrollments')).toBe(paths.indexOf('/admin/teachers') + 1);
  });

  it('is routed, not merely listed', () => {
    // §14.4's "available in the menu, being prepared on the page" defect: the
    // registry says `ready`, so the router must actually answer the path.
    expect(IMPLEMENTED_ADMIN_PATHS).toContain('/admin/teachers');
    expect(ROUTER).toContain("case '/admin/teachers':");
    expect(ROUTER).toContain('<TeachersPage />');
  });

  it('names itself in Arabic, in both the menu and the page', () => {
    // R105 — «إدارة المؤطِّرات» named the screen's VERB. No sibling does that
    // («المستخدمون», not «إدارة المستخدمين»), and every entry in this menu is a
    // management screen, so the word distinguished nothing.
    expect(ar.admin.nav.teachers).toBe('المؤطِّرات');
    expect(ar.admin.teachers.lede.length).toBeGreaterThan(0);
  });
});

describe('who the page lists', () => {
  it('asks the server for the مؤطِّرة role rather than filtering a page of users', () => {
    expect(TEACHERS).toContain("role: 'teacher'");
  });

  it('never uses beneficiary status as an exclusion', () => {
    // R79 made *beneficiary* a durable fact independent of every role precisely
    // so a مؤطِّرة may also study. Excluding beneficiaries would hide a real
    // member of teaching staff — a teacher who is also enrolled must appear,
    // and the only way to guarantee that is to never ask the question.
    expect(TEACHERS).not.toContain('is_beneficiary');
    expect(TEACHERS).not.toContain('beneficiaries_only');
  });

  it('renders the table on arrival, gated behind no selector (rule A)', () => {
    // The population comes from the role, not from a dropdown the user must
    // touch first; the Subject and Category filters start empty and narrow.
    expect(TEACHERS).toContain("useState('')");
    expect(TEACHERS).toContain('void load();');
  });
});

describe('there is one teaching-profile editor', () => {
  it('is imported by this page and defined exactly once', () => {
    expect(TEACHERS).toContain('TeachingProfileDialog');

    const definitions = Object.entries(RAW).filter(([, text]) =>
      /export function TeachingProfileDialog\b/.test(text),
    );
    expect(definitions.map(([path]) => path)).toEqual([
      '/src/components/admin/teaching-profile-dialog.tsx',
    ]);
  });
});

describe('the weekday labels are Arabic, and come from the catalogue', () => {
  const WEEKDAYS = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ] as const;

  it('resolves every weekday to its Arabic name', () => {
    expect(WEEKDAYS.map((d) => ar.scheduling.weekday[d])).toEqual([
      'الاثنين',
      'الثلاثاء',
      'الأربعاء',
      'الخميس',
      'الجمعة',
      'السبت',
      'الأحد',
    ]);
  });

  it('has no `calendar.weekday` namespace for a key to point at', () => {
    // The defect: the dialog built `calendar.weekday.${day}`, `t()` returns its
    // own argument on a miss, and seven raw keys rendered on screen. The
    // namespace never existed and must not be created — one concept, one home.
    expect('weekday' in ar.calendar).toBe(false);
  });

  it('never builds a weekday key against a namespace other than scheduling', () => {
    // The general form of the same failure is guarded in `i18n/resolves.test.ts`
    // (every computed key's namespace must resolve to an object). This pins the
    // specific one that shipped.
    for (const path of Object.keys(RAW)) {
      // Comments name the dead namespace in order to explain it — including
      // this file's own. Only code is scanned.
      expect(code(path), path).not.toContain('calendar.weekday.');
    }
  });

  it('hard-codes no Arabic weekday in the availability editor', () => {
    // **Restated for R106, not weakened — the property FOLLOWED THE CODE.**
    // The weekday selector moved out of the dialog into the shared
    // `AvailabilityEditor` when a مؤطِّرة gained her own availability page, and
    // this guard failed because it was still reading the old file. The rule it
    // pins is unchanged: the labels come from the catalogue, never from seven
    // literals somebody typed.
    const editor = code('/src/components/teaching/availability-editor.tsx');
    expect(editor).toContain('scheduling.weekday');
    for (const name of ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس']) {
      expect(editor).not.toContain(name);
    }
  });

  it('keeps ONE availability editor — the dialog does not grow a second', () => {
    // The reason the extraction happened at all. R88's rules are subtle enough
    // (touching ranges legal, overlapping refused, never merged) that a second
    // copy would be a real defect, and this project's record is that the copy
    // which drifts still passes its own tests.
    const dialog = code('/src/components/admin/teaching-profile-dialog.tsx');
    expect(dialog).toContain('AvailabilityEditor');
    expect(dialog).not.toContain('scheduling.weekday');
  });

  it('reports dirty against the PROFILE it loaded, not against emptiness (NEW E)', () => {
    // **The defect this exists for.** The dialog computed
    // `dirty = loaded && (subjectIds.length > 0 || categoryIds.length > 0 || ranges.length > 0)`
    // — *has any content*, not *has changed*. Every مؤطِّرة who already had a
    // profile therefore opened the dialog already dirty, and closing it without
    // touching a field asked her to confirm discarding work she had not done.
    // Rule AY: a pristine form must not nag.
    const dialog = code('/src/components/admin/teaching-profile-dialog.tsx');
    expect(dialog).toContain('isDirty(');
    // Compared against what the fetch returned, which is the only pristine side
    // available to a form whose values arrive asynchronously.
    expect(dialog).toMatch(/const dirty = .*isDirty\([^;]*pristine[^;]*\)/s);
    // And the length test is gone rather than merely supplemented — an `||`
    // beside the real comparison would restore the whole defect.
    expect(dialog).not.toMatch(/subjectIds\.length > 0/);
  });
});
