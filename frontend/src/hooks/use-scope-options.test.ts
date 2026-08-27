import { describe, expect, it } from 'vitest';

import HOOK from './use-scope-options.ts?raw';
import SELECTORS from '../components/scope/scope-selectors.tsx?raw';
import CONTENT from '../pages/content.tsx?raw';

/** Every page, so the mode-agreement guard below sees all of them. */
const PAGES = import.meta.glob('/src/pages/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Comments are not code — the idiom the scheduling parity guard established. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * **A filter may ask about a Subject with no Level; a form may not.**
 *
 * The `subjectId → levelId` edge exists so a **form** cannot offer a pair the
 * server refuses (`SUBJECT_NOT_AT_LEVEL`, §4.4b) — that is the defect
 * `useScopeOptions` was extracted for and it is unchanged. But `مكتبة المحتوى`
 * disabled its Subject filter behind *«اختاري المستوى أولًا»*, asking a question
 * the contract never required: `GET /library` takes `level_id` and `subject_id`
 * as **independent optionals**.
 *
 * These are source assertions, and deliberately so: the property is *which read
 * runs* and *which dependency is consulted*, neither of which a statically
 * rendered tree shows. The behaviour itself is verified against the running API
 * and in the browser.
 */
describe('the Subject filter does not require a Level', () => {
  it('offers every Subject when no Level is chosen, and the Level’s when one is', () => {
    /**
     * **RESTATED for NEW D — the property is the same, the mechanism is not.**
     *
     * This used to assert two endpoints chosen between, `listSubjects` and
     * `listLevelSubjects`. Both are Admin-only, which is precisely why a
     * مؤطِّرة's Subject control was empty in a filter and refused the moment she
     * chose a Level. The hook now derives both answers from the one
     * caller-scoped read, so the calls are gone — **but the rule they
     * implemented is unchanged and is what this pins**: no Level chosen means
     * every Subject in a filter and none in a form; a Level chosen means that
     * Level's.
     */
    expect(code(HOOK)).toContain('subjectsUnscoped ? allSubjects : []');
    expect(code(HOOK)).toContain('levelSubjects.get(value.levelId)');
    /**
     * **RESTATED AGAIN 2026-08-27 — and the second half is now load-bearing.**
     *
     * The list is DERIVED during render rather than written to state by an
     * effect. That is not a style preference: as an effect it left a one-commit
     * window in which `options` was memoised from an empty `subjects` while
     * `ready` had already flipped true, so rule 2 cleared a Subject the caller
     * had deliberately seeded. مكتبة المحتوى's upload dialog lost the Subject
     * its page filter had set, every time.
     *
     * A future author restoring `setSubjects` in an effect would restore the
     * defect, so the absence is pinned, not just the rule.
     */
    expect(code(HOOK)).toContain('const subjects = useMemo');
    expect(code(HOOK)).not.toContain('setSubjects(');
  });

  it('NEVER reaches for an Admin reference read — that WAS the defect (NEW D)', () => {
    /**
     * **The regression guard for NEW D itself.**
     *
     * `/admin/levels`, `/admin/subjects`, `/admin/academic-years` and
     * `/admin/levels/{id}/subjects` all answer **403** for a مؤطِّرة by design
     * (R30), and this hook is shared by مكتبة المحتوى, الجدولة, the groups
     * screen and the upload form — so one of these calls reappearing here
     * breaks a Teacher workflow on every screen at once, and does it silently:
     * an Admin developer would never see it.
     *
     * The narrow read is `/me/scope-options` (R93.4's pattern). Anything else
     * belongs to a screen that has already established the caller is an Admin.
     */
    const c = code(HOOK);
    for (const forbidden of [
      'listLevels(',
      'listSubjects(',
      'listAcademicYears(',
      'listLevelSubjects(',
      'listCategories(',
      'listBranches(',
    ]) {
      expect(c, `${forbidden} is Admin-only and must not return to the shared hook`).not.toContain(
        forbidden,
      );
    }
    expect(c).toContain('fetchScopeOptions(token)');
  });

  it('is driven by `mode`, and defaults to the strict one', () => {
    // A form must not offer a Subject the chosen Level does not teach, so a
    // caller that says nothing gets that behaviour rather than the permissive one.
    expect(code(HOOK)).toMatch(/mode\s*=\s*'form'/);
    expect(code(HOOK)).toContain("const subjectsUnscoped = mode === 'filter'");
  });

  it('every page tells the HOOK the same mode it tells the SELECTORS', () => {
    /**
     * **The guard for the defect that produced this rule.**
     *
     * It began as a `subjectsUnscoped` boolean — opt-in, per caller — so
     * `مكتبة المحتوى` received it and `الجدولة` did not: the Subject control
     * rendered enabled and empty, reading «لا مواد مسندة إلى هذا المستوى» with no
     * Level chosen. One screen right, the next wrong, which is exactly the drift
     * `useScopeOptions` was extracted to prevent.
     *
     * `mode` is now one fact the caller already knew. What can still go wrong is
     * saying it **twice and differently** — `mode="filter"` on the selectors and
     * nothing on the hook — so that is what is asserted: any file rendering
     * `ScopeSelectors` with `mode="filter"` must also construct its scope with
     * `mode: 'filter'`.
     */
    const offenders = Object.entries(PAGES)
      .filter(([, text]) => {
        const c = code(text);
        if (!/mode=["']filter["']/.test(c)) return false;
        return !/useScopeOptions\([\s\S]*?mode:\s*'filter'/.test(c);
      })
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('the shared selector ignores the dependency only in filter mode', () => {
    expect(code(SELECTORS)).toContain("mode === 'filter'");
    // The edge itself stays — it is true of forms, which is where it works.
    expect(code(SELECTORS)).toContain('subjectId: [{ field: ');
  });

  it('the content library declares itself a filter', () => {
    expect(code(CONTENT)).toContain("mode: 'filter'");
  });

  it('clearing the Level keeps the Subject, but moving Level clears it', () => {
    /**
     * Widening a filter is not retracting the Subject: a reader who asked for
     * تفسير and then removed the Level constraint did not un-ask for تفسير.
     * Moving to *another* Level still clears it, because that Level may not teach
     * it and a stale id is what reaches the server as an impossible pair.
     */
    expect(code(HOOK)).toContain("const wideningAFilter = next === '' && unscopedSubjectsRef.current");
    expect(code(HOOK)).toContain('if (!wideningAFilter) updated.subjectId');
  });

  it('reads the flag through a ref, so `set` stays referentially stable', () => {
    // This hook's own docstring records what an unstable callback costs here:
    // a `useCallback` keyed on the flag would change identity and re-run every
    // effect that depends on it.
    expect(code(HOOK)).toContain('unscopedSubjectsRef');
  });
});
