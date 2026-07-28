import { useState } from 'react'
import { User, Settings, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { SignOutButton } from './auth-buttons'
import { cn } from '@/lib/utils'

export interface UserMenuUser {
  id: string
  name: string
  email: string
  avatar?: string
  roleLabel?: string
}

interface UserMenuProps {
  user: UserMenuUser
  onProfileClick?: () => void
  onSettingsClick?: () => void
  onLogout?: () => void
  isLoading?: boolean
  className?: string
}

/**
 * Reusable user menu dropdown component
 * Shows user info, profile/settings links, and logout
 * Keyboard accessible with proper ARIA labels
 */
export function UserMenu({
  user,
  onProfileClick,
  onSettingsClick,
  onLogout,
  isLoading,
  className,
}: UserMenuProps) {
  const [open, setOpen] = useState(false)

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleProfileClick = () => {
    onProfileClick?.()
    setOpen(false)
  }

  const handleSettingsClick = () => {
    onSettingsClick?.()
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>
        <button
          className={cn('h-8 gap-2 px-2 inline-flex items-center gap-1 rounded-md bg-transparent hover:bg-accent hover:text-accent-foreground', className)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`User menu: ${user.name}`}
        >
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-xs font-bold bg-primary text-primary-foreground">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="hidden sm:flex flex-col items-end gap-0">
            <span className="text-xs font-medium leading-tight">{user.name}</span>
            {user.roleLabel && (
              <span className="text-[10px] text-muted-foreground leading-tight">
                {user.roleLabel}
              </span>
            )}
          </div>
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" role="menu" dir="rtl">
        {/* User Info Section */}
        <div className="px-3 py-2 text-xs text-muted-foreground border-b">
          <p className="font-semibold text-foreground">{user.name}</p>
          <p className="text-[11px] break-all">{user.email}</p>
          {user.roleLabel && (
            <Badge variant="secondary" className="mt-1.5 text-[10px] capitalize">
              {user.roleLabel}
            </Badge>
          )}
        </div>

        {/* Menu Items */}
        <DropdownMenuItem
          onClick={handleProfileClick}
          className="gap-2 cursor-pointer"
          role="menuitem"
        >
          <User className="h-4 w-4" />
          <span>الملف الشخصي</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={handleSettingsClick}
          className="gap-2 cursor-pointer"
          role="menuitem"
        >
          <Settings className="h-4 w-4" />
          <span>الإعدادات</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Logout Button */}
        <div className="px-1 py-1" role="none">
          <SignOutButton
            isLoading={isLoading}
            onLogout={() => {
              onLogout?.()
              setOpen(false)
            }}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
