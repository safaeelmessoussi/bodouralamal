import type { ReactNode } from 'react';

import type { ApprovalApplicant, ApprovalType } from '../../adapters/approvals.js';
import { t } from '../../i18n/index.js';
import { Badge } from './badge.js';

/**
 * `ApprovalCard` — the bundle-aware presentation of a queue item (§14.3).
 *
 * **Why a bundle needs its own component.** A registration is not always one
 * person: §4.1's unified transaction can create a parent, a child and the link
 * between them, and §5.6 approves all three **atomically** (TD-4.2). A row that
 * showed only "the applicant" would let an administrator approve two people and
 * a family relationship while believing they had approved one person.
 *
 * So the two things this renders are the two things §14.2 asks for by name:
 * **who** is in the bundle, each with their role, and **what approving it will
 * change**. The second is stated in records, not adjectives.
 *
 * Names arrive already resolved (§20 rule 21) and are rendered verbatim — this
 * component composes no display name and implements no fallback.
 */

export function ApplicantList({ applicants }: { applicants: ApprovalApplicant[] }): ReactNode {
  return (
    <ul className="approval__people">
      {applicants.map((person) => (
        <li key={person.id} className="approval__person">
          <span className="approval__name">{person.name}</span>{' '}
          <span className="approval__role">{t(`admin.approvals.role.${person.role}`)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What approving this item will actually change.
 *
 * A standalone family link creates no child, so its child count is zero and
 * saying "0 children" would be noise — each clause appears only when it has
 * something to report. When nothing does, the item activates the applicant
 * alone, and *that* is said plainly rather than left blank.
 */
export function BundleSummary({
  bundle,
}: {
  bundle: { child_count: number; link_count: number };
}): ReactNode {
  const parts: string[] = [];
  if (bundle.child_count > 0) {
    parts.push(t('admin.approvals.bundleChildren').replace('{n}', String(bundle.child_count)));
  }
  if (bundle.link_count > 0) {
    parts.push(t('admin.approvals.bundleLinks').replace('{n}', String(bundle.link_count)));
  }
  if (parts.length === 0) return <span className="muted">{t('admin.approvals.bundleSolo')}</span>;
  return <span>{parts.join(t('admin.approvals.bundleJoin'))}</span>;
}

/** The item's type, in words — §14.2's first column. */
export function ApprovalTypeBadge({ type }: { type: ApprovalType }): ReactNode {
  return (
    <Badge tone={type === 'registration' ? 'ok' : 'warn'}>
      {t(type === 'registration' ? 'admin.approvals.typeRegistration' : 'admin.approvals.typeLink')}
    </Badge>
  );
}
