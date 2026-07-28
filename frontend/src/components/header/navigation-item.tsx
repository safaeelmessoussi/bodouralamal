import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface NavigationItemProps {
  label: string
  href?: string
  icon?: ReactNode
  isActive?: boolean
  isDropdown?: boolean
  onClick?: () => void
  children?: ReactNode
  className?: string
}

/**
 * Reusable navigation item component
 * Handles both standalone links and dropdown triggers
 * Keyboard accessible with proper focus management
 */
export function NavigationItem({
  label,
  href,
  icon,
  isActive,
  isDropdown,
  onClick,
  children,
  className,
}: NavigationItemProps) {
  const location = useLocation()
  
  // Auto-detect active state if href provided
  const active = isActive ?? (href ? location.pathname === href : false)

  const itemClasses = cn(
    'flex items-center gap-2 px-3 py-2 text-sm font-medium',
    'rounded-md transition-colors duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    active
      ? 'text-primary bg-primary/10'
      : 'text-foreground/70 hover:text-foreground hover:bg-accent',
    className
  )

  const content = (
    <>
      {icon && <span className="flex items-center justify-center text-base">{icon}</span>}
      <span>{label}</span>
      {isDropdown && (
        <svg
          className="w-4 h-4 ml-auto transition-transform duration-200"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          />
        </svg>
      )}
    </>
  )

  if (href) {
    return (
      <Link to={href} className={itemClasses}>
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(itemClasses, 'w-full text-right')}
      aria-haspopup={isDropdown ? 'true' : undefined}
      aria-expanded={isDropdown ? undefined : undefined}
    >
      {content}
    </button>
  )
}
