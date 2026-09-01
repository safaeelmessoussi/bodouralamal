import { describe, expect, it } from 'vitest';

import { resolveActiveChild } from './active-child.js';

const children = [{ id: 'child-1', label: 'مريم' }];

describe('active child reconciliation', () => {
  it('keeps an authorised child only in Parent context', () => {
    expect(resolveActiveChild('parent', 'child-1', children)?.id).toBe('child-1');
  });

  it('clears a stale/revoked child and never applies one in Student context', () => {
    expect(resolveActiveChild('parent', 'stale-child', children)).toBeNull();
    expect(resolveActiveChild('student', 'child-1', children)).toBeNull();
  });
});
