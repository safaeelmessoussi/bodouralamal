import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { switchRole } from '@/services/header-adapter'

export interface RoleOption {
  id: string
  name: string
  label: string
  icon?: string
}

interface RoleSwitcherProps {
  currentRole: RoleOption
  availableRoles: RoleOption[]
  userName?: string
  onRoleChange?: (roleId: string) => void
  className?: string
}

/**
 * Reusable role switcher dropdown component
 * Allows users to switch between their available roles
 * Keyboard accessible dropdown with proper ARIA labels
 */
export function RoleSwitcher({
  currentRole,
  availableRoles,
  userName,
  onRoleChange,
  className,
}: RoleSwitcherProps) {
  const [open, setOpen] = useState(false)

  const handleRoleChange = (roleId: string) => {
    switchRole(roleId)
    onRoleChange?.(roleId)
    setOpen(false)
  }

  if (!availableRoles.length) {
    return null
  }

  // Only show if multiple roles available
  if (availableRoles.length === 1) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {userName && <span className="text-sm font-medium text-foreground">{userName}</span>}
        <Badge variant="secondary" className="text-xs">
          {currentRole.label}
        </Badge>
      </div>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>
        <button
          className={cn('h-8 gap-2 px-2 inline-flex items-center gap-1 rounded-md bg-transparent hover:bg-accent hover:text-accent-foreground', className)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Current role: ${currentRole.label}. Click to change role`}
        >
          <div className="flex flex-col items-end gap-0.5">
            {userName && <span className="text-xs font-medium leading-tight">{userName}</span>}
            <span className="text-xs text-muted-foreground leading-tight">
              {currentRole.label}
            </span>
          </div>
          <ChevronDown className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" role="listbox" dir="rtl">
        <div className="px-2 py-1.5 text-xs text-muted-foreground border-b">
          <p className="font-semibold text-foreground">{userName}</p>
          <p className="text-[11px]">الأدوار المتاحة</p>
        </div>
        {availableRoles.map((role) => (
          <DropdownMenuItem
            key={role.id}
            onClick={() => handleRoleChange(role.id)}
            className={cn(
              'cursor-pointer gap-2',
              currentRole.id === role.id && 'bg-accent font-semibold'
            )}
            role="option"
            aria-selected={currentRole.id === role.id}
          >
            <span className="flex-1 text-right">{role.label}</span>
            {currentRole.id === role.id && (
              <span className="ml-auto text-primary" aria-label="selected">
                ✓
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
