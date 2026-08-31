import { afterEach, describe, expect, it } from 'vitest';

import {
  INITIAL_PLATFORM_OWNER,
  requireInitialOwnerConfiguration,
} from './super-admin.js';

const originalSex = process.env['SUPER_ADMIN_SEX'];

afterEach(() => {
  if (originalSex === undefined) delete process.env['SUPER_ADMIN_SEX'];
  else process.env['SUPER_ADMIN_SEX'] = originalSex;
});

describe('initial Platform Owner configuration gate', () => {
  it('fails before opening a transaction when the email is absent or not the approved owner', () => {
    process.env['SUPER_ADMIN_SEX'] = 'female';
    expect(() => requireInitialOwnerConfiguration(undefined)).toThrow(/SUPER_ADMIN_EMAIL/);
    expect(() => requireInitialOwnerConfiguration('somebody@example.invalid')).toThrow(
      /Initial Platform Owner must be/,
    );
  });

  it('requires the approved explicit sex rather than inferring it', () => {
    process.env['SUPER_ADMIN_SEX'] = 'male';
    expect(() => requireInitialOwnerConfiguration(INITIAL_PLATFORM_OWNER.email)).toThrow(
      /SUPER_ADMIN_SEX must be `female`/,
    );
  });

  it('normalizes the one approved address and accepts the explicit female value', () => {
    process.env['SUPER_ADMIN_SEX'] = 'female';
    expect(
      requireInitialOwnerConfiguration(`  ${INITIAL_PLATFORM_OWNER.email.toUpperCase()}  `),
    ).toBe(INITIAL_PLATFORM_OWNER.email);
  });
});
