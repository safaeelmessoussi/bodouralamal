import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ar } from '../../i18n/ar.js';
import { authorRoleOf } from './author-picker.js';
import { BranchScopeField } from './branch-scope-field.js';

const branches = [
  { value: 'a', label: 'تاركة' },
  { value: 'b', label: 'أمرشيش' },
];

describe('R217 — «كل الفروع» said in words', () => {
  it('an administrator with nothing chosen reads «كل الفروع», ticked, and no branch list', () => {
    const html = renderToStaticMarkup(<BranchScopeField branches={branches} selected={[]} onChange={() => undefined} mayAssignGlobal />);
    expect(html).toContain(ar.content.upload.allBranches);
    expect(html).toContain('checked=""');
    expect(html).not.toContain('multi-select');
  });

  it('a مؤطِّرة is never offered «كل الفروع»', () => {
    const html = renderToStaticMarkup(<BranchScopeField branches={branches} selected={['a']} onChange={() => undefined} mayAssignGlobal={false} />);
    expect(html).not.toContain(ar.content.upload.allBranches);
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
