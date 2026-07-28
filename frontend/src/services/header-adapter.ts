// Header Adapter
// Provides mock data for authentication, user info, roles, and navigation
// TODO: Replace mock functions with real API calls when backend is ready

import { ReactNode } from 'react'

export interface NavigationItem {
  id: string
  label: string
  href?: string
  icon?: ReactNode
  children?: NavigationItem[]
}

export interface Role {
  id: string
  name: string
  label: string
  icon?: string
}

export interface ChildProfile {
  id: string
  name: string
  grade?: string
  status?: string
}

export interface UserInfo {
  id: string
  name: string
  email: string
  avatar?: string
  role: Role
  children?: ChildProfile[]
}

export interface AuthState {
  isAuthenticated: boolean
  user: UserInfo | null
  isLoading: boolean
}

export interface HeaderContextData {
  auth: AuthState
  navigation: NavigationItem[]
  availableRoles: Role[]
  currentRole: Role
  currentChild?: ChildProfile
}

/**
 * Get public navigation items for anonymous visitors
 * Matches structure from bodouralamal.com
 */
export function getPublicNavigation(): NavigationItem[] {
  return [
    { id: 'home', label: 'الرئيسية', href: '/' },
    { id: 'levels', label: 'المستويات', href: '/levels' },
    { id: 'calendar', label: 'التقويم', href: '/calendar' },
    { id: 'content', label: 'المحتوى التعليمي', href: '/content' },
  ]
}

/**
 * Get authenticated user navigation
 * Same structure as public, roles determine dashboard access
 */
export function getAuthenticatedNavigation(): NavigationItem[] {
  return getPublicNavigation()
}

/**
 * Mock authentication state
 * TODO: Replace with real auth check (JWT token, session cookie, etc.)
 */
export function getAuthState(): AuthState {
  const mockIsAuthenticated = false // TODO: Check real auth state
  
  if (!mockIsAuthenticated) {
    return {
      isAuthenticated: false,
      user: null,
      isLoading: false,
    }
  }

  // TODO: Fetch real user info from /api/user endpoint
  const mockUser: UserInfo = {
    id: 'user-1',
    name: 'سفاء المسوسي',
    email: 'safae@example.com',
    role: {
      id: 'admin',
      name: 'admin',
      label: 'مشرف عام',
    },
    children: [
      { id: 'child-1', name: 'مريم', grade: 'المستوى 3', status: 'active' },
      { id: 'child-2', name: 'فاطمة', grade: 'المستوى 2', status: 'active' },
      { id: 'child-3', name: 'يوسف', grade: 'المستوى 1', status: 'active' },
    ],
  }

  return {
    isAuthenticated: true,
    user: mockUser,
    isLoading: false,
  }
}

/**
 * Get available roles for current user
 * TODO: Replace with real role endpoint that filters by user permissions
 */
export function getAvailableRoles(): Role[] {
  // TODO: Fetch from /api/user/roles endpoint
  return [
    { id: 'admin', name: 'admin', label: 'مشرف عام' },
    { id: 'branch-admin', name: 'branch_admin', label: 'مشرف فرع' },
    { id: 'teacher', name: 'teacher', label: 'معلمة' },
    { id: 'student', name: 'student', label: 'طالبة' },
    { id: 'parent', name: 'parent', label: 'ولي أمر' },
  ]
}

/**
 * Get current active role
 * TODO: Replace with real role state from backend/session
 */
export function getCurrentRole(): Role {
  // TODO: Get from session/store, default to first available role
  return {
    id: 'student',
    name: 'student',
    label: 'طالبة',
  }
}

/**
 * Switch to different role
 * TODO: Call /api/user/role endpoint to persist selection
 */
export function switchRole(roleId: string): void {
  // TODO: Send to backend: PATCH /api/user/active-role with { role_id: roleId }
  // TODO: Update local session/store
  console.log('[v0] Role switch requested:', roleId)
}

/**
 * Get available children for parent account
 * Only populated if current role is 'parent'
 */
export function getAvailableChildren(): ChildProfile[] {
  // TODO: Fetch from /api/user/children endpoint
  const authState = getAuthState()
  if (authState.user?.role.name === 'parent' && authState.user.children) {
    return authState.user.children
  }
  return []
}

/**
 * Get current selected child
 * Only applicable for parent accounts
 */
export function getCurrentChild(): ChildProfile | undefined {
  const children = getAvailableChildren()
  return children[0] // TODO: Get from session/store
}

/**
 * Switch to different child
 * Only for parent accounts
 * TODO: Call /api/user/active-child endpoint to persist
 */
export function switchChild(childId: string): void {
  // TODO: Send to backend: PATCH /api/user/active-child with { child_id: childId }
  console.log('[v0] Child switch requested:', childId)
}

/**
 * Logout user
 * TODO: Call /api/auth/logout endpoint and clear session
 */
export function logout(): Promise<void> {
  // TODO: Send to backend: POST /api/auth/logout
  // TODO: Clear JWT token, cookies, local storage
  // TODO: Redirect to login page
  console.log('[v0] Logout requested')
  return Promise.resolve()
}

/**
 * Complete header context data for consumers
 */
export function getHeaderContextData(): HeaderContextData {
  const auth = getAuthState()
  const navigation = auth.isAuthenticated ? getAuthenticatedNavigation() : getPublicNavigation()
  const availableRoles = auth.isAuthenticated ? getAvailableRoles() : []
  const currentRole = auth.isAuthenticated ? getCurrentRole() : { id: '', name: '', label: '' }
  const currentChild = auth.isAuthenticated ? getCurrentChild() : undefined

  return {
    auth,
    navigation,
    availableRoles,
    currentRole,
    currentChild,
  }
}
