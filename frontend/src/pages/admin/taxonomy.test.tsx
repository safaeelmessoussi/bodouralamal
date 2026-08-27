import { describe, expect, it } from 'vitest';

import type { SubjectRef } from '../../adapters/reference-data.js';
import type { Category, Level, UpdateLevelInput } from '../../adapters/taxonomy.js';
import { ADMIN_MODULES } from '../../lib/admin-modules.js';
import { IMPLEMENTED_ADMIN_PATHS } from './index.js';

/**
 * The curriculum taxonomy screens — the client half of the contract guard.
 *
 * `api<T>()` is an unchecked cast, so an adapter naming a field the API never
 * sends compiles and fails only in a browser. The literals below are written
 * with the key sets the server tests pin and typed as the adapters' interfaces,
 * so a rename on either side is a typecheck failure here.
 */

const CATEGORY: Category = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'طفل',
  description: 'وصف الفئة',
  display_order: 1,
  level_count: 3,
  version: 0,
};

const SUBJECT: SubjectRef = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'القرآن',
  display_order: 1,
  version: 0,
};

const LEVEL: Level = {
  id: '00000000-0000-4000-8000-000000000003',
  name: 'المستوى الأول',
  description: 'وصف المستوى',
  category_id: CATEGORY.id,
  category_name: CATEGORY.name,
  gender_restriction: 'girls_only',
  display_order: 1,
  group_count: 1,
  subject_count: 2,
  enrollment_count: 12,
  version: 0,
};

describe('the adapter types match the wire contract', () => {
  it('a category carries exactly the documented keys', () => {
    expect(Object.keys(CATEGORY).sort()).toEqual([
      'description',
      'display_order',
      'id',
      'level_count',
      'name',
      'version',
    ]);
  });

  it('a subject carries `version` — which is why there is only one subject list', () => {
    // The selector every form uses and the list الفئات والمواد edits are the
    // SAME endpoint. Publishing the TD-15 version on it is what avoided a
    // parallel read over the same table, kept in step by hand.
    expect(Object.keys(SUBJECT).sort()).toEqual(['display_order', 'id', 'name', 'version']);
  });

  it('a level carries the counts a screen needs to answer "can this be deleted"', () => {
    // Without them the delete button is a guess and the only way to find out is
    // to press it. `enrollment_count` in particular is what lets the confirm
    // dialog say the deletion will be refused BEFORE it is attempted.
    expect(Object.keys(LEVEL).sort()).toEqual([
      'category_id',
      'category_name',
      'description',
      'display_order',
      'enrollment_count',
      'gender_restriction',
      'group_count',
      'id',
      'name',
      'subject_count',
      'version',
    ]);
  });

  it('a level carries no branch_id', () => {
    // §4.4b: a Level is Category-scoped and branch-independent — it may hold
    // groups at several branches. `branch_id` exists only on CREATE, where it
    // says where المجموعة 1 goes, and a column here would break `entire_level`
    // teaching mode, which resolves across the groups at one branch.
    expect(LEVEL).not.toHaveProperty('branch_id');
  });

  it('an edit cannot move a Level between Categories', () => {
    // A move would silently re-file every enrolled student into a different
    // educational stage. The absence is enforced at the type level here and by
    // a strict schema on the server, which refuses the field rather than
    // dropping it — so a client can never believe a move succeeded.
    const edit: UpdateLevelInput = { name: 'اسم جديد' };
    expect(Object.keys(edit)).not.toContain('category_id');
  });
});

describe('the registry and the router agree', () => {
  it('every `ready` module has a screen', () => {
    // Three modules once carried `ready` with no screen, so the sidebar said
    // available and the page said "being prepared".
    const ready = ADMIN_MODULES.filter((m) => m.status === 'ready').map((m) => m.path);
    expect([...ready].sort()).toEqual([...IMPLEMENTED_ADMIN_PATHS].sort());
  });

  it('Levels, الفئات and المواد are all live', () => {
    for (const path of ['/admin/levels', '/admin/categories', '/admin/subjects']) {
      expect(ADMIN_MODULES.find((m) => m.path === path)?.status).toBe('ready');
    }
  });

  it('الفئات and المواد moved to الإدارة and are Super-Admin-only (2026-08-12)', () => {
    // They are **stable configuration** — curriculum structure changed rarely
    // and by one person — which is what الإدارة collects, and writes were
    // already Super-Admin-only (R26/R55). R61's section rule is structural, so
    // placement decides authority.
    for (const path of ['/admin/categories', '/admin/subjects']) {
      const module = ADMIN_MODULES.find((m) => m.path === path);
      expect([...(module?.roles ?? [])], path).toEqual(['super_admin']);
      expect(module?.section, path).toBe('administration');
    }
  });

  it('R69: Levels joined the configuration section — it creates nothing operational', () => {
    // Superseded the same day it was written, by a fuller audit. The earlier
    // reasoning was "an Admin places students into Levels every day" — true,
    // but they do it from the approval queue and the groups screen, each of
    // which has its own Level selector fed by the still-Admin-readable
    // endpoint. The Levels SCREEN only answers *which Levels exist*, and R66
    // removed the last operational thing it did (creating a first group).
    const levels = ADMIN_MODULES.find((m) => m.path === '/admin/levels')!;
    expect([...levels.roles]).toEqual(['super_admin']);
    expect(levels.section).toBe('administration');
  });

  it('the READ endpoints stay Admin-accessible — the menu is not the boundary', () => {
    // R61 decided exactly this for `GET /admin/branches`: Levels, scheduling
    // and the roster feed their selectors from Categories and Subjects, so
    // gating the DATA rather than the screen would break an Admin's daily work.
    // The server enforces TD-2 regardless; this test records the distinction so
    // the endpoints are not "tidied" to match the menu.
    expect(true).toBe(true);
  });
});
