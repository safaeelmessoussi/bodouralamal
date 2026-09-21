import { describe, expect, it } from 'vitest';

import type { OperationsStatus } from '../../adapters/operations.js';
import { ADMIN_MODULES } from '../../lib/admin-modules.js';
import { ar } from '../../i18n/ar.js';
import { needsAttention } from './operations.js';
import { IMPLEMENTED_ADMIN_PATHS } from './index.js';

/** SRS Revision 169 §11 — «حالة النظام». */
const quiet: OperationsStatus = {
  jobs: { failed: 0, late: 0, queues: [] },
  storage_retirement: { pending: 0, failed: 0, late: 0, copy_unknown: 0 },
  host_checks: 'not_visible_from_here',
  checked_at: '2026-09-21T10:00:00.000Z',
};

describe('whether anything needs a person', () => {
  it('nothing does when every count is zero — and a PENDING retirement alone is ordinary', () => {
    expect(needsAttention(quiet)).toBe(false);
    expect(needsAttention({ ...quiet, storage_retirement: { ...quiet.storage_retirement, pending: 3 } })).toBe(false);
  });

  it('a failed job, a late job, a failed/late retirement or an unknown copy each does', () => {
    expect(needsAttention({ ...quiet, jobs: { ...quiet.jobs, failed: 1 } })).toBe(true);
    expect(needsAttention({ ...quiet, jobs: { ...quiet.jobs, late: 1 } })).toBe(true);
    for (const key of ['failed', 'late', 'copy_unknown'] as const) {
      expect(needsAttention({ ...quiet, storage_retirement: { ...quiet.storage_retirement, [key]: 1 } })).toBe(true);
    }
  });
});

describe('the screen is registered for the Super Admin alone, and says what it cannot see', () => {
  it('is a ready module with a screen behind it', () => {
    const module = ADMIN_MODULES.find((m) => m.path === '/admin/operations');
    expect(module).toMatchObject({ status: 'ready', roles: ['super_admin'] });
    expect(IMPLEMENTED_ADMIN_PATHS).toContain('/admin/operations');
  });

  it('never lets a page of zeros read as «the backup is fine»', () => {
    expect(ar.admin.operations.hostNotVisible).toContain('النسخ الاحتياطي');
    expect(ar.admin.operations.hostNotVisible).toContain('الأصفار أعلاه لا تقول شيئًا عنهما');
  });
});
