import { describe, expect, it } from 'vitest';

import MOBILE_MENU_SOURCE from './mobile-menu.tsx?raw';
import AUTH_BUTTONS_SOURCE from './auth-buttons.tsx?raw';

/**
 * «حسابي» on the mobile sheet (Owner-reported, 2026-09-15): the desktop
 * header's `UserMenu` popover offers `/profile` alongside sign-out, but the
 * mobile sheet's authenticated actions block never rendered an equivalent —
 * it had `DashboardButton` and `SignOutButton` but no link to the account
 * itself, so a phone-width visitor had no way to reach `/profile` from the
 * header at all. Source-pinning, matching `pending-guard.test.tsx`'s own
 * reasoning: rendering `MobileMenu` meaningfully needs `ActiveRoleProvider`
 * and `ActiveChildProvider` wired up for `RoleSwitcher` alone, while the
 * defect here is the wiring itself — that the link exists in the sheet's
 * markup — not any role-dependent behaviour a live render would add
 * coverage for.
 */
const menuSource = MOBILE_MENU_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const authSource = AUTH_BUTTONS_SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('the mobile nav sheet offers «حسابي», matching the desktop UserMenu', () => {
  it('renders AccountButton in the authenticated actions block, alongside sign-out', () => {
    const actionsBlock = menuSource.slice(
      menuSource.indexOf('mobile-menu__actions'),
      menuSource.indexOf('SignOutButton onSignOut={onSignOut} block'),
    );
    expect(actionsBlock).toContain('<AccountButton block />');
  });

  it('imports AccountButton from auth-buttons', () => {
    expect(menuSource).toMatch(/import\s*{[^}]*AccountButton[^}]*}\s*from\s*'\.\/auth-buttons\.js'/);
  });

  it('AccountButton links to /profile with the same label as the desktop menu (profile.title)', () => {
    expect(authSource).toContain("href=\"/profile\"");
    expect(authSource).toMatch(/AccountButton[\s\S]*?href="\/profile"[\s\S]*?t\('profile\.title'\)/);
  });
});
