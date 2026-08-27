import type { ReactNode } from 'react';

import type { RoleAssignment } from '../../adapters/users.js';
import { t } from '../../i18n/index.js';

/**
 * **Where does this person work** — the branches a set of role assignments
 * reaches, as one cell.
 *
 * Extracted when طاقم التأطير needed the same answer المستخدمون already showed
 * (§8). The rule it carries is the reason it is not two copies:
 *
 * > `branch_id: null` on an assignment is **all branches for that assignment**
 * > (§7, R24) — never *no branch*. Collapsing the two is how an unscoped Super
 * > Admin reads as having no access at all, which is the opposite of the truth.
 *
 * It renders what the caller passes and decides nothing about authorization
 * (UX rule O): the server is the authority on scope, and this only says what
 * the row already states.
 */
export function BranchScopeCell({ roles }: { roles: readonly RoleAssignment[] }): ReactNode {
  if (roles.length === 0) return <span className="muted">{t('common.notSet')}</span>;
  const names = [...new Set(roles.map((a) => a.branch_name ?? t('admin.users.allBranches')))];
  return <>{names.join('، ')}</>;
}
