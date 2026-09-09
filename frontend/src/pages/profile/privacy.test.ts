import { describe, expect, it } from 'vitest';

import CONTROLLER from '../../../../backend/src/controllers/profile.controller.ts?raw';
import SERVICE from '../../../../backend/src/services/profile.service.ts?raw';
import PAGE from './index.tsx?raw';

/** Comments are not code — the project's established idiom for source guards. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The braces-balanced region introduced by `marker`.
 *
 * Written after a first attempt sliced to the next `},` and stopped inside
 * `where: { deletedAt: null },` — which would have made the exclusion assertions
 * pass by reading three lines that could not have contained an email anyway.
 * **A guard that cannot see what it guards is not a guard.**
 */
function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  let depth = 0;
  for (let i = start + marker.length - 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced block at ${marker}`);
}

/**
 * **NEW G — what حسابي may show about a guardian, and what it may never show.**
 *
 * The Owner's constraint is a list of exclusions, and exclusions are exactly the
 * kind of rule that decays: nothing fails when a field is added, the screen just
 * quietly starts showing it. So this reads the **server projection**, which is
 * where the rule is actually enforced — a client-side filter would be a second
 * copy of the rule and the copy that drifts still passes its own tests.
 */
describe('a beneficiary sees the guardian RELATIONSHIP, not the guardian', () => {
  it('the server sends a guardian name and status, and nothing else', () => {
    const dto = code(CONTROLLER);
    const guardians = dto.slice(dto.indexOf('guardians: profile.guardians.map'));
    const block = guardians.slice(0, guardians.indexOf('}))') + 3);
    expect(block).toContain('name: g.name');
    expect(block).toContain('status: g.status');
    // The two the constraint names first.
    expect(block).not.toContain('email');
    expect(block).not.toContain('phone');
  });

  it('the guardian is not even SELECTED with contact details', () => {
    /**
     * Stronger than the DTO check and the reason both exist: a projection that
     * loaded the guardian's email would put it one careless spread away from the
     * response. The rule is enforced where the data is read, not where it is
     * shaped.
     */
    const select = block(code(SERVICE), 'childLinks: {');
    expect(select).toContain('parent: { select: { nameArabic: true } }');
    expect(select).not.toContain('email');
    expect(select).not.toContain('phone');
  });

  it('reads childLinks — who is responsible for HER, not the children she has', () => {
    /**
     * `parentLinks` is the opposite direction: the children this person is
     * guardian OF. It was the first thing written here and it was wrong, and the
     * failure is silent — a parent would have seen her own children listed under
     * a heading saying they were her guardians.
     */
    const svc = code(SERVICE);
    expect(svc).toContain('childLinks: {');
    expect(svc).toContain('guardians: user.childLinks.map');
  });

  it('the page renders no guardian field beyond name and status', () => {
    const page = code(PAGE);
    const section = page.slice(page.indexOf('function PlacementSection'));
    expect(section).toContain('{g.name}');
    expect(section).not.toContain('g.email');
    expect(section).not.toContain('g.phone');
  });

  it('shows her own Level as {Category} — {Level} (rule D)', () => {
    // Level names are not unique across Categories (§4.4b), so a bare one names
    // nothing — and this is the screen where she reads her own placement.
    const section = code(PAGE).slice(code(PAGE).indexOf('function PlacementSection'));
    expect(section).toContain('{e.category_name} — {e.level_name}');
  });
});

/**
 * **R137 — تعديل بيانات المستخدم: phone and birth_date consistency with
 * registration, for a beneficiary specifically.**
 *
 * R130 already requires both at registration for the arm that admits a
 * beneficiary (the adult applicant, never a guardian-only parent and never
 * a staff request). This closes the gap on the ONE OTHER surface either can
 * change: editing must ask the same population for the same two fields, and
 * must not silently accept either going missing.
 */
describe('phone and birth_date are required for a beneficiary profile, and for no one else (R137)', () => {
  it('the page asks for birth_date only when is_beneficiary — never inferred from a role', () => {
    const page = code(PAGE);
    expect(page).toContain('profile.is_beneficiary');
    const section = page.slice(page.indexOf('function ProfileDetails'));
    expect(section).toContain("profile.is_beneficiary ? (");
  });

  it('the phone label switches to required for a beneficiary — the misleading "optional" framing is gone for her', () => {
    const page = code(PAGE);
    expect(page).toContain('const phoneRequired = profile.is_beneficiary;');
    expect(page).toContain("t(phoneRequired ? 'register.phone' : 'register.phoneOptional')");
  });

  it('birth_date reuses the shared isRealPastDate check — the same one registration uses, not a reinvented one', () => {
    expect(code(PAGE)).toContain("from '../../lib/birth-date.js'");
    expect(code(PAGE)).toContain('isRealPastDate(birthDate)');
  });

  it('the backend accepts birth_date through the SHARED R130 validator, not a bespoke regex', () => {
    expect(code(CONTROLLER)).toContain("import { birthDate } from '../validators/person.js';");
    expect(code(CONTROLLER)).toContain('birth_date: birthDate.nullable().optional()');
  });

  it('the service refuses an incomplete beneficiary profile, checked against the RESULTING values', () => {
    const svc = code(SERVICE);
    expect(svc).toContain('function assertBeneficiaryComplete');
    expect(svc).toContain('if (existing.isBeneficiary) assertBeneficiaryComplete(existing, input);');
    // Resulting, not merely-what-was-sent: an edit touching only nickname
    // must not be blocked by a legacy gap it did not create.
    expect(svc).toContain('input.phone !== undefined ? input.phone : current.phone');
    expect(svc).toContain('input.birthDate !== undefined ? input.birthDate : current.birthDate');
  });

  it('a non-beneficiary (guardian-only or staff) is never forced into either requirement', () => {
    // The gate is the SAME boolean everywhere — one fact, read three times,
    // never a role-based guess.
    const svc = code(SERVICE);
    const occurrences = svc.match(/isBeneficiary/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
