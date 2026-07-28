import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface PageLayoutProps {
  children: ReactNode
  className?: string
}

/**
 * Standard page layout with consistent spacing and responsive behavior
 * Handles padding for all breakpoints and RTL direction
 */
export function PageLayout({ children, className }: PageLayoutProps) {
  return (
    <div
      className={cn(
        "w-full h-full flex flex-col",
        "space-y-6",
        "p-4 sm:p-5 md:p-6 lg:p-8",
        "max-w-screen-2xl mx-auto",
        className
      )}
      dir="rtl"
    >
      {children}
    </div>
  )
}

interface GridLayoutProps {
  children: ReactNode
  columns?: 1 | 2 | 3 | 4
  gap?: "sm" | "md" | "lg"
  className?: string
}

/**
 * Responsive grid layout with consistent column and gap settings
 * Automatically adjusts columns based on screen size
 */
export function GridLayout({
  children,
  columns = 2,
  gap = "md",
  className,
}: GridLayoutProps) {
  const gapMap = {
    sm: "gap-3 sm:gap-4",
    md: "gap-4 sm:gap-5 md:gap-6",
    lg: "gap-5 sm:gap-6 md:gap-8",
  }

  const columnsMap = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  }

  return (
    <div
      className={cn("grid", columnsMap[columns], gapMap[gap], className)}
    >
      {children}
    </div>
  )
}

interface ContentGridProps {
  children: ReactNode
  columns?: 1 | 2 | 3
  gap?: "sm" | "md" | "lg"
  className?: string
}

/**
 * Two-column layout where primary content takes more space
 * Useful for layouts with main content and sidebar
 */
export function TwoColumnLayout({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 lg:grid-cols-3",
        "gap-4 sm:gap-5 md:gap-6",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Primary column wrapper for left/main content (2/3 width on desktop)
 */
export function PrimaryColumn({ children }: { children: ReactNode }) {
  return <div className="lg:col-span-2 space-y-4 sm:space-y-5 md:space-y-6">{children}</div>
}

/**
 * Sidebar column wrapper for right/secondary content (1/3 width on desktop)
 */
export function SidebarColumn({ children }: { children: ReactNode }) {
  return <div className="space-y-4 sm:space-y-5 md:space-y-6">{children}</div>
}

interface StackLayoutProps {
  children: ReactNode
  direction?: "vertical" | "horizontal"
  gap?: "xs" | "sm" | "md" | "lg"
  align?: "start" | "center" | "end" | "stretch"
  className?: string
}

/**
 * Flexbox stack layout for consistent spacing between items
 */
export function Stack({
  children,
  direction = "vertical",
  gap = "md",
  align = "start",
  className,
}: StackLayoutProps) {
  const gapMap = {
    xs: "gap-2",
    sm: "gap-3",
    md: "gap-4",
    lg: "gap-6",
  }

  const alignMap = {
    start: "items-start",
    center: "items-center",
    end: "items-end",
    stretch: "items-stretch",
  }

  return (
    <div
      className={cn(
        "flex",
        direction === "vertical" ? "flex-col" : "flex-row",
        gapMap[gap],
        alignMap[align],
        className
      )}
    >
      {children}
    </div>
  )
}
