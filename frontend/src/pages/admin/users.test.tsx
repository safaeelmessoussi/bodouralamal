import { describe, expect, it } from 'vitest';

import type { Approval } from '../../adapters/approvals.js';
import type { RoleAssignment, UserSummary } from '../../adapters/users.js';
import { ACCOUNT_STATUSES, ROLES } from '../../adapters/users.js';
import { t } from '../../i18n/index.js';
import { ar } from '../../i18n/ar.js';
import { ADMIN_MODULES } from '../../lib/admin-modules.js';
import { IMPLEMENTED_ADMIN_PATHS } from './index.js';
import { assignmentsForSave, canOfferOwnershipTransfer } from './users.js';

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
  is_platform_owner: false,
  name_arabic: 'فاطمة الزهراء',
  first_name_arabic: 'سعاد',
  last_name_arabic: 'العلوي',
  first_name_french: null,
  sex: 'female',
  // R130 — on this Super-Admin-only read; `null` is what a legacy beneficiary
  // legitimately carries, so the contract fixture states one.
  birth_date: null,
  last_name_french: null,
  nickname: null,
  phone: null,
  email: 'fatima@example.com',
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
/** A queue row, typed as the adapter's interface so a rename on either side is
 *  a typecheck failure here. */
const QUEUE_ITEM: Approval = {
  id: '00000000-0000-4000-8000-000000000009',
  type: 'registration',
  applicants: [{ id: WIRE.id, name: WIRE.name_arabic, role: 'applicant' }],
  submitted_at: '2026-08-05T10:00:00.000Z',
  bundle: { child_count: 0, link_count: 0 },
  // R62 — a registration bundle carries no child APPLICATIONS.
  children: [],
  branch: { id: ASSIGNMENT.branch_id!, name: ASSIGNMENT.branch_name! },
  requested_role: null,
  framing: null,
  category: { id: '00000000-0000-4000-8000-00000000000a', name: 'طفل' },
  registration_details: null,
};

describe('the adapter type matches the wire contract', () => {
  it('carries exactly the keys the staff list publishes', () => {
    expect(Object.keys(WIRE).sort()).toEqual([
      'account_status',
      // R130 — the beneficiary's date of birth, published on this
      // Super-Admin-only read because §5.6 is where a missing legacy one is
      // COMPLETED. Deliberately absent from `/admin/directory` and from every
      // beneficiary list, and never accompanied by a derived age.
      'birth_date',
      // R55: the administrative identifier a staff screen recognises a person
      // by. **Not** a display identity (§20 rule 21) — that rule governs the
      // name shown to the public, and this list is staff-only (TD-2).
      'email',
      // The stored name PARTS, the sex and the notes — what the §5.6 edit form
      // hydrates from since 2026-08-28. `name_arabic` stays because a table
      // renders the composed name; these are what was collected, and §1.1
      // composes the first from the last.
      'first_name_arabic',
      'first_name_french',
      'id',
      'is_platform_owner',
      'last_name_arabic',
      'last_name_french',
      'name_arabic',
      'nickname',
      'phone',
      'roles',
      'sex',
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

describe('Platform Owner controls', () => {
  const globalSuperAdmin: UserSummary = {
    ...WIRE,
    id: '00000000-0000-4000-8000-000000000099',
    roles: [{ role: 'super_admin', branch_id: null, branch_name: null }],
  };

  it('uses the authenticated ownership fact even when the current owner is absent from the page', () => {
    expect(
      canOfferOwnershipTransfer(WIRE.id, true, false, globalSuperAdmin),
    ).toBe(true);
  });

  it('removes transfer authority locally after success and refuses ineligible targets', () => {
    expect(canOfferOwnershipTransfer(WIRE.id, true, true, globalSuperAdmin)).toBe(false);
    expect(canOfferOwnershipTransfer(WIRE.id, false, false, globalSuperAdmin)).toBe(false);
    expect(
      canOfferOwnershipTransfer(WIRE.id, true, false, {
        ...globalSuperAdmin,
        account_status: 'suspended',
      }),
    ).toBe(false);
    expect(
      canOfferOwnershipTransfer(WIRE.id, true, false, {
        ...globalSuperAdmin,
        roles: [{ role: 'super_admin', branch_id: ASSIGNMENT.branch_id!, branch_name: 'فرع' }],
      }),
    ).toBe(false);
  });

  it('publishes distinct owner-protection and transfer labels', () => {
    expect(ar.admin.users.platformOwner).toBeTruthy();
    expect(ar.admin.users.platformOwnerProtected).toBeTruthy();
    expect(ar.admin.users.transferOwnership).toBeTruthy();
  });

  it('includes the visible role draft when the primary Save is used', () => {
    expect(assignmentsForSave([ASSIGNMENT], 'student', '')).toEqual([
      ASSIGNMENT,
      { role: 'student', branch_id: null },
    ]);
    expect(assignmentsForSave([ASSIGNMENT], '', ASSIGNMENT.branch_id!)).toEqual([ASSIGNMENT]);
  });
});

describe('the registry and the router agree', () => {
  it('every `ready` module has a screen', () => {
    const ready = ADMIN_MODULES.filter((m) => m.status === 'ready').map((m) => m.path);
    expect([...ready].sort()).toEqual([...IMPLEMENTED_ADMIN_PATHS].sort());
  });

  it('/admin/users is live and SUPER ADMIN ONLY (Owner, 2026-08-28)', () => {
    /**
     * **Restated, because the Owner changed the rule — not because the code
     * drifted.**
     *
     * It read *"open to an Admin, not only a Super Admin"*, on the reading that
     * TD-2 grants *«create/edit users; assign roles & branch scopes»* to both.
     * The Owner has since separated **managing operational data** from
     * **administering accounts**: المستخدمون is the whole platform's account
     * directory, including the power to delete an account, and an Admin does
     * not get it merely because they manage operational data.
     *
     * **The menu is not the enforcement** — `listUsers` asserts Super Admin in
     * the service, so an Admin who types the URL is refused by the server. This
     * only pins that the menu agrees with it, which is the part a screen can get
     * wrong on its own.
     */
    const module = ADMIN_MODULES.find((m) => m.path === '/admin/users');
    expect(module?.status).toBe('ready');
    expect(module?.roles).toEqual(['super_admin']);
    expect(module?.roles).not.toContain('admin');
  });
});

describe('the staff registration workflow (Revision 49)', () => {
  it('makes a staff request distinguishable in the queue', () => {
    // Before `requested_role` the approver saw names and a branch, and could
    // not tell a teacher applicant from a family registration — which is the
    // entire gap the workflow needed closing. `null` is the ordinary path.
    const staff: Approval = { ...QUEUE_ITEM, requested_role: 'teacher' };
    const family: Approval = { ...QUEUE_ITEM, requested_role: null };
    expect(staff.requested_role).toBe('teacher');
    expect(family.requested_role).toBeNull();
  });

  it('has a label for the only self-requestable role', () => {
    // Administrator accounts arrive by staff pre-provisioning, never by a
    // public form — so `teacher` is the only value this cell ever renders.
    expect(ar.admin.users.role.teacher).toBeTruthy();
  });

  it('offers approving WITHOUT a role as its own action', () => {
    // Refusing the requested role is not the same decision as refusing the
    // person, and a dialog with only one confirm button would conflate them.
    expect(ar.admin.approvals.approveWithoutRole).toBeTruthy();
    expect(ar.admin.approvals.approveWithRole).toBeTruthy();
  });

  it('names the refusal an Admin gets for granting an administrator role', () => {
    // Approval must not read as a weaker path to authority than the Users
    // screen — and the message says the approval itself is still available.
    expect(ar.admin.approvals.roleForbidden).toBeTruthy();
  });
});

/**
 * **Option A is account CLOSURE, and the copy must not promise more** (R131).
 *
 * The one unacceptable outcome here is an interface that promises a deletion the
 * system does not perform. Option B — deletion of the educational record itself —
 * is a separate, Super-Admin-reviewed request and **is not implemented**, so no
 * screen may offer it or imply that this action is it.
 */
describe('R131 — the account-closure wording', () => {
  const copy = [
    t('admin.users.deleteBody'),
    t('admin.users.deleteBodyPermanent'),
    t('profile.deleteLede'),
    t('profile.deleteConfirm'),
  ];

  it('says the educational record REMAINS, on every surface that closes an account', () => {
    for (const text of copy) {
      expect(text, text.slice(0, 40)).toMatch(/تبقى محفوظ|يبقى سجلك/);
    }
  });

  it('never promises that everything is deleted', () => {
    for (const text of copy) {
      expect(text, text.slice(0, 40)).not.toMatch(/حذف كل بياناتك نهائ|تُحذف كل/);
    }
  });

  it('claims no external legal mandate for the retention period', () => {
    // The ten years are the association's own purpose-based policy (R131); a
    // screen citing CNDP or a law would be asserting something untrue.
    for (const text of copy) {
      expect(text).not.toMatch(/CNDP|القانون|قانون 09-08|إلزام قانوني/);
    }
  });

  it('does not offer Option B from the CLOSURE copy — they are different requests', () => {
    for (const text of copy) {
      expect(text).not.toMatch(/حذف كل البيانات القابلة للحذف/);
    }
  });
});

/**
 * **Option B's copy must be honest in three specific ways** (R131 §4.10a).
 *
 * **Destructive execution now exists** (Owner, 2026-09-04), which moves the
 * unacceptable outcome rather than removing it. It was *a reader who believes
 * her record has been deleted when it has not*; it is now **a reader who does
 * not realise that approval destroys immediately**. So the wording must
 * separate the two moments — sending asks, approving executes — instead of
 * reassuring her that neither deletes anything, which is what it used to say
 * and what stopped being true.
 */
describe('R131 Option B — the full-deletion request wording', () => {
  const copy = [
    t('profile.fullDeletionLede'),
    t('profile.fullDeletionReview'),
    t('profile.fullDeletionBackups'),
  ].join(' ');

  it('says it is a DIFFERENT request from account closure', () => {
    expect(copy).toMatch(/مختلف عن إغلاق الحساب/);
  });

  it('warns that a future attestation may become impossible', () => {
    expect(copy).toMatch(/يتعذّر|شهادة/);
  });

  it('separates SENDING from APPROVING — one asks, the other destroys', () => {
    expect(copy).toMatch(/يُراجَع/);
    // Sending is the harmless half...
    expect(copy).toMatch(/إرسال الطلب لا يحذف شيئاً/);
    // ...and approving is not, which the copy has to say in as many words.
    expect(copy).toMatch(/تُنفّذ الحذف/);
    expect(copy).toMatch(/لا يمكن التراجع/);
  });

  it('never tells her that approval is harmless — the sentence that stopped being true', () => {
    // The old copy read «تسجيل الطلب أو الموافقة عليه لا يحذف شيئاً في حدّ ذاته».
    // It was accurate while execution was unimplemented and became a false
    // reassurance the moment it was not. Pinned so it cannot come back.
    expect(copy).not.toMatch(/الموافقة عليه لا يحذف/);
  });

  it('mentions backups only to DENY immediate erasure, and claims no legal mandate', () => {
    // A naive "must not contain «محو فوري»" fails on the sentence that exists to
    // rule it out — the phrase appears inside its own negation. The property is
    // that the promise is refused, so that is what is asserted.
    expect(copy).toMatch(/النسخ الاحتياطية/);
    expect(copy).toMatch(/لا يمكن الوعد بمحو فوري/);
    expect(copy).not.toMatch(/CNDP|القانون يفرض|إلزام قانوني/);
  });
});
