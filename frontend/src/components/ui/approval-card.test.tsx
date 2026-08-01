import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ApprovalApplicant } from '../../adapters/approvals.js';
import { ApplicantList, ApprovalTypeBadge, BundleSummary } from './approval-card.js';
import { Badge } from './badge.js';
import { ConfirmDialog } from './confirm-dialog.js';

/**
 * The approval queue's shared pieces (§14.3), plus the `ConfirmDialog`
 * generalisation the queue required.
 *
 * These sit beside the CRUD framework's own tests for the same reason: what is
 * asserted here is inherited by every screen that reuses them.
 */

const bundle: ApprovalApplicant[] = [
  { id: 'p', name: 'أمينة بنعلي', role: 'applicant' },
  { id: 'c', name: 'سارة بنعلي', role: 'child' },
];

describe('ApplicantList — a bundle is people, not a person', () => {
  it('renders every applicant as a list item with their role', () => {
    // The failure this guards: showing only "the applicant" would let an admin
    // approve a parent AND a child while believing they approved one person.
    const html = renderToStaticMarkup(<ApplicantList applicants={bundle} />);
    expect(html).toContain('<ul');
    expect((html.match(/<li/g) ?? []).length).toBe(2);
    expect(html).toContain('أمينة بنعلي');
    expect(html).toContain('سارة بنعلي');
  });

  it('renders the name verbatim and composes nothing (§20 rule 21)', () => {
    const html = renderToStaticMarkup(
      <ApplicantList applicants={[{ id: 'x', name: 'اسم معروض', role: 'parent' }]} />,
    );
    expect(html).toContain('اسم معروض');
  });
});

describe('BundleSummary — states what approving will change', () => {
  it('reports children and links when there are any', () => {
    const html = renderToStaticMarkup(
      <BundleSummary bundle={{ child_count: 2, link_count: 2 }} />,
    );
    expect(html).toContain('2');
  });

  it('omits a clause with nothing to report rather than printing a zero', () => {
    // A standalone family link creates no child; "0 children" is noise.
    const html = renderToStaticMarkup(
      <BundleSummary bundle={{ child_count: 0, link_count: 1 }} />,
    );
    expect(html).not.toContain('0');
  });

  it('says so plainly when the item activates the applicant alone', () => {
    const html = renderToStaticMarkup(
      <BundleSummary bundle={{ child_count: 0, link_count: 0 }} />,
    );
    expect(html).toContain('مقدّم الطلب وحده');
  });
});

describe('Badge — state in words, never colour alone', () => {
  it('carries a text label whatever the tone', () => {
    for (const tone of ['neutral', 'ok', 'warn'] as const) {
      expect(renderToStaticMarkup(<Badge tone={tone}>مسودة</Badge>)).toContain('مسودة');
    }
  });

  it('distinguishes the two approval types by label, not only by tint', () => {
    const registration = renderToStaticMarkup(<ApprovalTypeBadge type="registration" />);
    const link = renderToStaticMarkup(<ApprovalTypeBadge type="family-link" />);
    expect(registration).toContain('تسجيل جديد');
    expect(link).toContain('ربط ابن');
    expect(registration).not.toBe(link);
  });
});

describe('ConfirmDialog — the reason bounds are configurable (TD-9)', () => {
  const base = {
    open: true,
    title: 'رفض',
    body: 'سيتم الرفض',
    onConfirm: () => undefined,
    onCancel: () => undefined,
  };

  it('defaults to the consent-override floor, so existing callers are unchanged', () => {
    const html = renderToStaticMarkup(<ConfirmDialog {...base} reasonLabel="سبب" />);
    // The default hint is the consent one, naming 10 characters.
    expect(html).toContain('10');
  });

  it('takes a caller hint when the rule is different', () => {
    // §5.6 rejection is 1–500, not 10–1000. A client refusing what the server
    // accepts is a bug in the client (§1.1) — this is the test that says so.
    const html = renderToStaticMarkup(
      <ConfirmDialog {...base} reasonLabel="سبب الرفض" reasonHint="حتى 500 حرف" reasonMin={1} reasonMax={500} />,
    );
    expect(html).toContain('حتى 500 حرف');
    expect(html).not.toContain('10 أحرف على الأقل');
  });

  it('still asks for no reason when none is configured', () => {
    // Approval is a plain confirmation: §5.6 requires a reason only to reject.
    expect(renderToStaticMarkup(<ConfirmDialog {...base} />)).not.toContain('<textarea');
  });
});
