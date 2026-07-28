import { useState } from 'react'
import { ChevronDown, User } from 'lucide-react'
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
import { switchChild } from '@/services/header-adapter'

export interface ChildOption {
  id: string
  name: string
  grade?: string
  status?: string
}

interface ChildSwitcherProps {
  children: ChildOption[]
  currentChild?: ChildOption
  onChildChange?: (childId: string) => void
  className?: string
}

/**
 * Reusable child switcher dropdown component
 * Only displayed for parent accounts with multiple children
 * Allows switching context between children
 * Keyboard accessible with proper ARIA labels
 */
export function ChildSwitcher({
  children,
  currentChild,
  onChildChange,
  className,
}: ChildSwitcherProps) {
  const [open, setOpen] = useState(false)

  // Only show if there are children to switch between
  if (!children || children.length === 0) {
    return null
  }

  // Only show dropdown if multiple children
  if (children.length === 1) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2', className)}>
        <User className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{currentChild?.name || children[0].name}</span>
        {children[0].grade && (
          <Badge variant="secondary" className="text-xs">
            {children[0].grade}
          </Badge>
        )}
      </div>
    )
  }

  const selected = currentChild || children[0]

  const handleChildChange = (childId: string) => {
    switchChild(childId)
    onChildChange?.(childId)
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>
        <button
          className={cn('h-8 gap-2 px-2 inline-flex items-center gap-1 rounded-md bg-transparent hover:bg-accent hover:text-accent-foreground', className)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Current child: ${selected.name}. Click to switch child`}
        >
          <User className="h-4 w-4" />
          <div className="flex flex-col items-end gap-0.5 max-w-[120px]">
            <span className="text-xs font-medium truncate leading-tight">{selected.name}</span>
            {selected.grade && (
              <span className="text-[11px] text-muted-foreground leading-tight">
                {selected.grade}
              </span>
            )}
          </div>
          <ChevronDown className={cn('h-4 w-4 transition-transform flex-shrink-0', open && 'rotate-180')} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" role="listbox" dir="rtl">
        <div className="px-2 py-1.5 text-xs text-muted-foreground border-b">
          <p className="font-semibold text-foreground">اختر الطالب/الطالبة</p>
        </div>
        {children.map((child) => (
          <DropdownMenuItem
            key={child.id}
            onClick={() => handleChildChange(child.id)}
            className={cn(
              'cursor-pointer flex items-center gap-2',
              selected.id === child.id && 'bg-accent font-semibold'
            )}
            role="option"
            aria-selected={selected.id === child.id}
          >
            <div className="flex-1">
              <p className="font-medium text-sm">{child.name}</p>
              {child.grade && <p className="text-xs text-muted-foreground">{child.grade}</p>}
            </div>
            {selected.id === child.id && (
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
