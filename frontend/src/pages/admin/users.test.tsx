import { describe, expect, it } from 'vitest';

import type { RoleAssignment, UserSummary } from '../../adapters/users.js';
import { ACCOUNT_STATUSES, ROLES } from '../../adapters/users.js';
import { ar } from '../../i18n/ar.js';
import { ADMIN_MODULES } from '../../lib/admin-modules.js';
import { IMPLEMENTED_ADMIN_PATHS } from './index.js';

/**
 * `/admin/users` — the client half of the contract guard.
 *
 * `api<T>()` is an unchecked cast, so an adapter naming a field the API never
 * sends compiles and fails only in a browser. `WIRE` is written with the key set
 * the server test pins and typed as the adapter's interface, so a rename on
 * either side is a typecheck failure here.
 */
const ASSIGNMENT: RoleAssignment = {
  role: 'teacher',
  branch_id: '00000000-0000-4000-8000-000000000002',
  branch_name: 'المقر الرئيسي',
};

const WIRE: UserSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  name_arabic: 'فاطمة الزهراء',
  nickname: null,
  phone: null,
  account_status: 'active',
  roles: [ASSIGNMENT],
  version: 0,
};

/**
 * **There is no test here asserting the published-name field is absent**, and
 * that omission is deliberate. `UserSummary` does not declare it, so a literal
 * typed as `UserSummary` cannot carry it — the assertion would only be checking
 * a fixture this file wrote. The real enforcement is
 * `scripts/ci/check-display-identity.sh`, which greps the whole frontend and
 * fails the build; a test naming the field would merely have to be excluded
 * from that grep, weakening the guard to restate it.
 */
describe('the adapter type matches the wire contract', () => {
  it('carries exactly the keys the staff list publishes', () => {
    expect(Object.keys(WIRE).sort()).toEqual([
      'account_status',
      'id',
      'name_arabic',
      'nickname',
      'phone',
      'roles',
      'version',
    ]);
  });

  it('carries `version`, which is why the edit dialog needs no second request', () => {
    // TD-15's value travels on the list. A GET /admin/users/{id} returning
    // these same fields plus one would be a second projection of one concept.
    expect(typeof WIRE.version).toBe('number');
  });

  it('models an unscoped assignment as branch_id: null, with a nullable label', () => {
    // §7 R24: `null` means ALL branches for that assignment, never *no branch*.
    // Keeping the label separate is what stops a screen treating the name as
    // the identifier.
    const unscoped: RoleAssignment = { role: 'super_admin', branch_id: null, branch_name: null };
    expect(unscoped.branch_id).toBeNull();
  });
});

describe('the vocabularies the screen renders', () => {
  it('has a label for every role, including super_admin', () => {
    // `super_admin` is offered by `PUT .../roles` (Revision 22 — administrator
    // changes happen through the application), so it must be renderable. A
    // missing key would surface as a raw enum value in the UI.
    for (const role of ROLES) {
      expect(ar.admin.users.role[role]).toBeTruthy();
    }
  });

  it('has a label for every TD-1 account status', () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(ar.admin.users.status[status]).toBeTruthy();
    }
  });

  it('names each 409 reason separately', () => {
    // STATE_CONFLICT carries a `reason` precisely because the remedies differ:
    // appointing another Super Admin is nothing like asking a colleague to
    // reload. One generic message would hide the only useful part.
    for (const key of ['lastSuperAdmin', 'selfSuspension', 'invalidTransition'] as const) {
      expect(ar.admin.users[key]).toBeTruthy();
    }
  });
});

describe('the registry and the router agree', () => {
  it('every `ready` module has a screen', () => {
    const ready = ADMIN_MODULES.filter((m) => m.status === 'ready').map((m) => m.path);
    expect([...ready].sort()).toEqual([...IMPLEMENTED_ADMIN_PATHS].sort());
  });

  it('/admin/users is live and open to an Admin, not only a Super Admin', () => {
    // TD-2 grants "create/edit users; assign roles & branch scopes" to both.
    // The privileged subset — granting an administrator role — is refused by
    // the server, and the dialog hides those options rather than showing a
    // control that exists only to fail.
    const module = ADMIN_MODULES.find((m) => m.path === '/admin/users');
    expect(module?.status).toBe('ready');
    expect(module?.roles).toContain('admin');
  });
});
