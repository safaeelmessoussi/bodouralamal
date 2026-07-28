import { useNavigate } from 'react-router-dom'
import { LogOut, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logout } from '@/services/header-adapter'
import { cn } from '@/lib/utils'

interface SignInButtonProps {
  className?: string
  onClick?: () => void
}

/**
 * Reusable sign in button component
 * Used in header for anonymous visitors
 * Navigates to login page
 */
export function SignInButton({ className, onClick }: SignInButtonProps) {
  const navigate = useNavigate()

  const handleClick = () => {
    onClick?.()
    navigate('/login')
  }

  return (
    <Button
      onClick={handleClick}
      className={cn('gap-2 h-8', className)}
      size="sm"
      aria-label="Sign in to your account"
    >
      <LogIn className="h-4 w-4" />
      <span>تسجيل الدخول</span>
    </Button>
  )
}

interface SignOutButtonProps {
  className?: string
  onLogout?: () => void
  isLoading?: boolean
}

/**
 * Reusable sign out button component
 * Used in user menu dropdown
 * Calls logout adapter function
 */
export function SignOutButton({
  className,
  onLogout,
  isLoading,
}: SignOutButtonProps) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await logout()
      onLogout?.()
      navigate('/login')
    } catch (error) {
      console.error('[v0] Logout failed:', error)
    }
  }

  return (
    <Button
      onClick={handleLogout}
      disabled={isLoading}
      variant="ghost"
      className={cn('w-full justify-end gap-2 text-destructive hover:text-destructive', className)}
      size="sm"
      aria-label={isLoading ? 'Signing out...' : 'Sign out from your account'}
    >
      <LogOut className="h-4 w-4" />
      <span>{isLoading ? 'جاري تسجيل الخروج...' : 'تسجيل الخروج'}</span>
    </Button>
  )
}

interface DashboardButtonProps {
  className?: string
  onClick?: () => void
  href?: string
}

/**
 * Reusable dashboard button component
 * Routes to appropriate dashboard based on active role
 * Used in header for authenticated users
 */
export function DashboardButton({ className, onClick, href }: DashboardButtonProps) {
  const navigate = useNavigate()

  const handleClick = () => {
    onClick?.()
    // TODO: Get correct dashboard URL from role adapter
    const dashboardUrl = href || '/dashboard'
    navigate(dashboardUrl)
  }

  return (
    <Button
      onClick={handleClick}
      variant="outline"
      className={cn('gap-2 h-8', className)}
      size="sm"
      aria-label="Go to dashboard"
    >
      <span>لوحة التحكم</span>
    </Button>
  )
}
