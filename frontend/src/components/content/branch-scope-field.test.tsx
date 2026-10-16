import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ar } from '../../i18n/ar.js';
import { authorRoleOf } from './author-picker.js';
import { BranchScopeField } from './branch-scope-field.js';

const branches = [
  { value: 'a', label: 'تاركة' },
  { value: 'b', label: 'أمرشيش' },
];

describe('R223 — «الفرع» is one dropdown, «الكل» by default', () => {
  it('an administrator with nothing chosen reads «الكل», with no tick box', () => {
    const html = renderToStaticMarkup(<BranchScopeField branches={branches} selected={[]} onChange={() => undefined} mayAssignGlobal />);
    expect(ar.content.allBranches).toBe('الكل');
    expect(html).toContain('>الكل<');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('multi-select');
  });

  it('a مؤطِّرة is never offered «الكل» and must name a branch', () => {
    const html = renderToStaticMarkup(<BranchScopeField branches={branches} selected={['a']} onChange={() => undefined} mayAssignGlobal={false} />);
    expect(html).not.toContain('>الكل<');
  });
});

describe('R217 — the author capacity comes from the person\'s roles', () => {
  const roles = (...names: string[]) => ({ roles: names.map((role) => ({ role, branch_id: null, branch_name: null })) });
  it('مؤطِّرة, then the administration, then مستفيدة, then وليّ الأمر', () => {
    expect(authorRoleOf(roles('student', 'teacher'))).toBe('teacher');
    expect(authorRoleOf(roles('super_admin', 'student'))).toBe('admin');
    expect(authorRoleOf(roles('parent', 'student'))).toBe('student');
    expect(authorRoleOf(roles('parent'))).toBe('guardian');
    expect(authorRoleOf(roles())).toBeNull();
  });
});
