/**
 * Application Header Components
 * Production-ready, reusable header components with proper composition
 */

export { ApplicationHeader } from './application-header'

export { NavigationItem } from './navigation-item'

export { NavigationMenu } from './navigation-menu'
export type { NavigationMenuItemData } from './navigation-menu'

export { RoleSwitcher } from './role-switcher'
export type { RoleOption } from './role-switcher'

export { ChildSwitcher } from './child-switcher'
export type { ChildOption } from './child-switcher'

export { UserMenu } from './user-menu'
export type { UserMenuUser } from './user-menu'

export { SignInButton, SignOutButton, DashboardButton } from './auth-buttons'

// Re-export adapter functions for header management
export {
  getHeaderContextData,
  getPublicNavigation,
  getAuthenticatedNavigation,
  getAuthState,
  getAvailableRoles,
  getCurrentRole,
  switchRole,
  getAvailableChildren,
  getCurrentChild,
  switchChild,
  logout,
} from '@/services/header-adapter'

export type {
  HeaderContextData,
  NavigationItem as HeaderNavigationItem,
  Role,
  ChildProfile,
  UserInfo,
  AuthState,
} from '@/services/header-adapter'
