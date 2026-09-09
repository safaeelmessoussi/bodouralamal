import { describe, expect, it } from 'vitest';

import SELF_MANAGED_SOURCE from './self-managed-claims.tsx?raw';
import APPROVALS_SOURCE from './approvals.tsx?raw';

const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * R137 item 12 — طلبات الحساب المستقل moves out of the standing menu and
 * into طلبات الانضمام's نوع الطلب filter, WITHOUT withdrawing R132's direct
 * route, authorization or decision logic. `hiddenFromNav` (covered in
 * `admin-modules.test.ts`) is the routing half of that; these pin the
 * component-composition half: one queue implementation
 * (`SelfManagedClaimsQueue`), reached two ways, never duplicated.
 */
describe('self-managed claims: one queue implementation, reached two ways (R137)', () => {
  it('the direct route still wraps the queue in its own AdminLayout — the deep link keeps working unchanged', () => {
    const source = code(SELF_MANAGED_SOURCE);
    const page = /export function SelfManagedClaimsPage\(\): ReactNode \{[\s\S]*?\n\}/.exec(source)?.[0];
    expect(page, 'SelfManagedClaimsPage function body').toBeTruthy();
    expect(page).toContain('<AdminLayout');
    expect(page).toContain('<SelfManagedClaimsQueue />');
  });

  it('SelfManagedClaimsQueue itself carries no AdminLayout — so embedding it elsewhere never double-wraps', () => {
    const source = code(SELF_MANAGED_SOURCE);
    const queue = /export function SelfManagedClaimsQueue\(\): ReactNode \{[\s\S]*$/.exec(source)?.[0];
    expect(queue, 'SelfManagedClaimsQueue function body').toBeTruthy();
    expect(queue).not.toContain('<AdminLayout');
    expect(queue).not.toContain('</AdminLayout>');
  });

  it('approvals.tsx imports the SAME queue component rather than a copy of the decision logic', () => {
    const source = code(APPROVALS_SOURCE);
    expect(source).toContain("import { SelfManagedClaimsQueue } from './self-managed-claims.js';");
    expect(source).not.toContain('approveSelfManagedClaim');
    expect(source).not.toContain('rejectSelfManagedClaim');
  });

  it('the نوع الطلب filter offers the self-managed-claims option under its own established title, not a duplicate of identity-review\'s label', () => {
    const source = code(APPROVALS_SOURCE);
    expect(source).toContain("{ value: SELF_MANAGED_CLAIMS_FILTER, label: t('admin.selfManagedClaims.title') }");
    // The identity-review option is untouched — a real, different R68 workflow
    // that happens to use a similar-sounding Arabic phrase.
    expect(source).toContain("{ value: 'identity-review', label: t('admin.approvals.typeIdentityReview') }");
  });

  it('selecting the filter swaps the table for the queue, and clears the fetch instead of asking the server for an invalid type', () => {
    const source = code(APPROVALS_SOURCE);
    expect(source).toContain('showingSelfManagedClaims ?');
    expect(source).toContain('<SelfManagedClaimsQueue />');
    expect(source).toMatch(/if \(typeFilter === SELF_MANAGED_CLAIMS_FILTER\) return;/);
  });
});
