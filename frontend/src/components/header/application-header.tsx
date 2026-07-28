import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { NavigationMenu } from './navigation-menu'
import { RoleSwitcher } from './role-switcher'
import { ChildSwitcher } from './child-switcher'
import { UserMenu } from './user-menu'
import { SignInButton, DashboardButton } from './auth-buttons'
import { getHeaderContextData } from '@/services/header-adapter'
import type { NavigationMenuItemData } from './navigation-menu'

interface ApplicationHeaderProps {
  logoHref?: string
  logoLabel?: string
  sticky?: boolean
  onNavigationClick?: (itemId: string) => void
}

/**
 * Production-quality application header component
 * Features:
 * - Responsive design (mobile hamburger menu, desktop horizontal nav)
 * - Accessible (keyboard navigation, ARIA labels, semantic HTML)
 * - RTL support (Arabic-first)
 * - Sticky positioning
 * - Role and child switching
 * - Authentication state handling
 */
export function ApplicationHeader({
  logoHref = '/',
  logoLabel = 'بذور الأمل',
  sticky = true,
  onNavigationClick,
}: ApplicationHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const headerData = getHeaderContextData()

  // Handle responsive behavior
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Close mobile menu on navigation
  const handleNavigation = (itemId: string) => {
    setMobileMenuOpen(false)
    onNavigationClick?.(itemId)
  }

  // Convert navigation items to menu format
  const menuItems: NavigationMenuItemData[] = headerData.navigation.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
    icon: item.icon,
    children: item.children?.map((child) => ({
      id: child.id,
      label: child.label,
      href: child.href,
      icon: child.icon,
    })),
  }))

  return (
    <header
      className={cn(
        'w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40',
        sticky && 'sticky top-0 z-40'
      )}
      dir="rtl"
    >
      {/* Main header container */}
      <div className="h-16 px-4 md:px-6 flex items-center justify-between gap-4">
        {/* Logo section */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <a
            href={logoHref}
            className="flex items-center gap-2 font-bold text-lg text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-2 py-1"
            aria-label={logoLabel}
          >
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
              ب
            </div>
            <span className="hidden sm:inline">{logoLabel}</span>
          </a>
        </div>

        {/* Desktop navigation */}
        <div className="hidden md:block flex-1 ml-8">
          <NavigationMenu items={menuItems} onItemClick={handleNavigation} />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Header actions - Desktop */}
        <div className="hidden md:flex items-center gap-2">
          {headerData.auth.isAuthenticated ? (
            <>
              <DashboardButton />
              {headerData.availableRoles.length > 1 && (
                <>
                  <Separator orientation="vertical" className="h-5" />
                  <RoleSwitcher
                    currentRole={headerData.currentRole}
                    availableRoles={headerData.availableRoles}
                    userName={headerData.auth.user?.name}
                  />
                </>
              )}
              {headerData.currentChild && (
                <>
                  <Separator orientation="vertical" className="h-5" />
                  <ChildSwitcher
                    children={headerData.auth.user?.children || []}
                    currentChild={headerData.currentChild}
                  />
                </>
              )}
              <Separator orientation="vertical" className="h-5" />
              <UserMenu
                user={{
                  id: headerData.auth.user?.id || '',
                  name: headerData.auth.user?.name || '',
                  email: headerData.auth.user?.email || '',
                  roleLabel: headerData.currentRole.label,
                }}
              />
            </>
          ) : (
            <SignInButton />
          )}
        </div>

        {/* Mobile menu button */}
        <div className="md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            className="h-8 w-8"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile menu - slides in from right (RTL) */}
      {mobileMenuOpen && isMobile && (
        <div
          className="border-t border-border/40 bg-background/50 backdrop-blur px-4 py-4 space-y-4"
          role="navigation"
          aria-label="Mobile navigation"
        >
          {/* Mobile navigation */}
          <NavigationMenu
            items={menuItems}
            isMobile
            onItemClick={handleNavigation}
            className="mb-4"
          />

          <Separator />

          {/* Mobile authentication section */}
          {headerData.auth.isAuthenticated ? (
            <div className="space-y-3">
              <DashboardButton className="w-full justify-center" />

              {headerData.availableRoles.length > 1 && (
                <>
                  <Separator className="my-2" />
                  <div className="text-xs text-muted-foreground font-semibold px-3 py-2">
                    الأدوار
                  </div>
                  <RoleSwitcher
                    currentRole={headerData.currentRole}
                    availableRoles={headerData.availableRoles}
                    userName={headerData.auth.user?.name}
                    className="w-full"
                  />
                </>
              )}

              {headerData.currentChild && (
                <>
                  <Separator className="my-2" />
                  <div className="text-xs text-muted-foreground font-semibold px-3 py-2">
                    الطلاب
                  </div>
                  <ChildSwitcher
                    children={headerData.auth.user?.children || []}
                    currentChild={headerData.currentChild}
                    className="w-full"
                  />
                </>
              )}

              <Separator className="my-2" />
              <UserMenu
                user={{
                  id: headerData.auth.user?.id || '',
                  name: headerData.auth.user?.name || '',
                  email: headerData.auth.user?.email || '',
                  roleLabel: headerData.currentRole.label,
                }}
                className="w-full"
              />
            </div>
          ) : (
            <SignInButton className="w-full justify-center" />
          )}
        </div>
      )}
    </header>
  )
}

export default ApplicationHeader
