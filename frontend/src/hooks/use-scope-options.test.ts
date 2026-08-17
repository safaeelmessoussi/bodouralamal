import { describe, expect, it } from 'vitest';

import HOOK from './use-scope-options.ts?raw';
import SELECTORS from '../components/scope/scope-selectors.tsx?raw';
import CONTENT from '../pages/content.tsx?raw';

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
  it('reads every Subject when no Level is chosen, and the Level’s when one is', () => {
    // Two different endpoints, chosen between — not one filtered to fake the
    // other. `listSubjects` is the platform's Subject list; `listLevelSubjects`
    // is one Level's pairing.
    expect(code(HOOK)).toContain('listSubjects(token)');
    expect(code(HOOK)).toContain('listLevelSubjects(value.levelId, token)');
  });

  it('is opt-in, so a form keeps the dependency that protects it', () => {
    expect(code(HOOK)).toContain('subjectsUnscoped');
    // The form default: with no Level chosen there is no valid Subject to hold.
    expect(code(HOOK)).toMatch(/subjectsUnscoped\s*=\s*false/);
  });

  it('the shared selector ignores the dependency only in filter mode', () => {
    expect(code(SELECTORS)).toContain("mode === 'filter' && field === 'subjectId'");
    // The edge itself stays — it is true of forms, which is where it works.
    expect(code(SELECTORS)).toContain('subjectId: [{ field: ');
  });

  it('the content library opts in', () => {
    expect(code(CONTENT)).toContain('subjectsUnscoped: true');
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
