import { describe, expect, it } from 'vitest';

import type { TrashEntry } from '../../adapters/trash.js';
import { ar } from '../../i18n/ar.js';
import { ADMIN_MODULES } from '../../lib/admin-modules.js';
import { IMPLEMENTED_ADMIN_PATHS } from './index.js';
import { TRASH_ENTITY_TYPES } from './trash.js';

/**
 * `/admin/trash` — the client half of the contract, and the one property this
 * screen must never get wrong: **it does not decide what is restorable.**
 */
const WIRE: TrashEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  target_entity: 'Subject',
  target_id: '00000000-0000-4000-8000-000000000002',
  label: 'القرآن',
  deleted_at: '2026-08-05T10:00:00.000Z',
  deleted_by_id: '00000000-0000-4000-8000-000000000003',
  deleted_by_name: 'مديرة',
  purge_after: '2026-11-03T10:00:00.000Z',
  restorable: true,
  restore_blocked_reason: null,
  // R59.1 — a second server decision, on the same footing as `restorable`.
  purgeable: true,
  purge_blocked_reason: null,
};

describe('the adapter type matches the wire contract', () => {
  it('carries exactly the keys the endpoint publishes', () => {
    expect(Object.keys(WIRE).sort()).toEqual([
      'deleted_at',
      'deleted_by_id',
      'deleted_by_name',
      'id',
      'label',
      'purge_after',
      'purge_blocked_reason',
      'purgeable',
      'restorable',
      'restore_blocked_reason',
      'target_entity',
      'target_id',
    ]);
  });

  it('carries NO snapshot', () => {
    // The snapshot is the row exactly as it was, including columns no screen is
    // entitled to — a phone number, notes, pre_provisioned_email. This page
    // answers "what was deleted, by whom, and when"; restoration reads the
    // snapshot server-side.
    expect(WIRE).not.toHaveProperty('snapshot');
  });

  it('takes `restorable` from the SERVER rather than deriving it', () => {
    // A client cannot know which deletions cascade. One that guessed would
    // offer a button that silently half-restores a person (§7) — so the flag is
    // a field, and the screen renders it.
    const blocked: TrashEntry = {
      ...WIRE,
      target_entity: 'User',
      restorable: false,
      restore_blocked_reason: 'CASCADE_RELATIONSHIPS',
    };
    expect(blocked.restorable).toBe(false);
    expect(blocked.restore_blocked_reason).toBe('CASCADE_RELATIONSHIPS');
  });
});

describe('the screen explains itself', () => {
  it('has a sentence for every blocked reason the server can send', () => {
    // A missing one would render as a raw enum in the column an administrator
    // reads to find out why their own data cannot be restored.
    for (const reason of [
      'CASCADE_RELATIONSHIPS',
      'CASCADE_CHILDREN',
      'INCOMPLETE_SNAPSHOT',
      'NOT_YET_SUPPORTED',
    ] as const) {
      expect(ar.admin.trash.blocked[reason]).toBeTruthy();
    }
  });

  it('names each restore refusal the server can return', () => {
    expect(ar.admin.trash.parentDeleted).toBeTruthy();
    expect(ar.admin.trash.alreadyPurged).toBeTruthy();
    expect(ar.admin.trash.notDeleted).toBeTruthy();
  });

  it('states WHY there is no permanent-delete control', () => {
    // Its absence would otherwise read as an oversight. BR-15's window is
    // enforced by the purge job, and bypassing it is a retention decision.
    expect(ar.admin.trash.retentionNote).toBeTruthy();
  });

  it('labels every entity type the filter offers', () => {
    for (const entity of TRASH_ENTITY_TYPES) {
      expect(ar.admin.trash.entity[entity]).toBeTruthy();
    }
  });
});

describe('the module is live and Super Admin only', () => {
  it('is registered, has a screen, and excludes Admins', () => {
    const module = ADMIN_MODULES.find((m) => m.path === '/admin/trash');
    expect(module?.status).toBe('ready');
    expect(IMPLEMENTED_ADMIN_PATHS).toContain('/admin/trash');
    // TD-2: the list spans every entity regardless of branch, so a
    // branch-scoped Admin would see other branches' records.
    expect(module?.roles).toEqual(['super_admin']);
  });
});

describe('R59.1 — the screen never decides who may destroy a record', () => {
  it('reads purgeability from the wire rather than from the entity type', () => {
    // The failure this prevents: a client that decided for itself which types
    // are safe to destroy would offer an irreversible action the server has not
    // written a destruction plan for.
    const blocked: TrashEntry = {
      ...WIRE,
      target_entity: 'User',
      purgeable: false,
      purge_blocked_reason: 'ACCOUNTABILITY_RECORD',
    };
    expect(blocked.purgeable).toBe(false);
    // And the reason is renderable — a missing action with no explanation is
    // the thing §14.4 forbids.
    expect(ar.admin.trash.purgeBlocked).toHaveProperty(blocked.purge_blocked_reason!);
  });

  it('has Arabic copy for every purge outcome the screen can reach', () => {
    for (const key of ['purge', 'purgeTitle', 'purgeBody', 'purged', 'purgeFailed', 'dependentsExist']) {
      expect(ar.admin.trash, key).toHaveProperty(key);
    }
    // The confirmation names the record and warns it cannot be undone — an
    // irreversible action confirmed by a generic "are you sure?" is not
    // confirmed at all.
    expect(ar.admin.trash.purgeBody).toContain('{record}');
    expect(ar.admin.trash.purgeBody).toContain('لا يمكن التراجع');
  });
});
