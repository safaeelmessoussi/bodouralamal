import { ReactNode } from 'react'
import { NavigationItem } from './navigation-item'
import { cn } from '@/lib/utils'

export interface NavigationMenuItemData {
  id: string
  label: string
  href?: string
  icon?: ReactNode
  children?: NavigationMenuItemData[]
}

interface NavigationMenuProps {
  items: NavigationMenuItemData[]
  className?: string
  isMobile?: boolean
  onItemClick?: (itemId: string) => void
}

/**
 * Reusable navigation menu component
 * Renders flat or hierarchical navigation items
 * Supports mobile and desktop layouts
 */
export function NavigationMenu({
  items,
  className,
  isMobile = false,
  onItemClick,
}: NavigationMenuProps) {
  const handleItemClick = (itemId: string) => {
    onItemClick?.(itemId)
  }

  return (
    <nav
      className={cn(
        'flex items-center',
        isMobile ? 'flex-col gap-1 w-full' : 'gap-1',
        className
      )}
      role="navigation"
      aria-label="Navigation menu"
    >
      {items.map((item) => (
        <div key={item.id} className={cn(isMobile && 'w-full')}>
          <NavigationItem
            label={item.label}
            href={item.href}
            icon={item.icon}
            isDropdown={!!item.children?.length}
            onClick={() => handleItemClick(item.id)}
            className={isMobile ? 'w-full justify-start' : undefined}
          />
          {item.children && isMobile && (
            <div className="ml-4 mt-1 space-y-1 border-r border-border/50 pr-2">
              {item.children.map((child) => (
                <NavigationItem
                  key={child.id}
                  label={child.label}
                  href={child.href}
                  icon={child.icon}
                  onClick={() => handleItemClick(child.id)}
                  className="text-xs"
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
