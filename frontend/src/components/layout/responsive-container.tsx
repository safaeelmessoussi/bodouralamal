import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface ResponsiveContainerProps {
  children: ReactNode
  size?: "sm" | "md" | "lg" | "xl" | "full"
  padding?: boolean
  className?: string
}

/**
 * Responsive container with consistent max-width and padding across breakpoints
 */
export function ResponsiveContainer({
  children,
  size = "lg",
  padding = true,
  className,
}: ResponsiveContainerProps) {
  const sizeMap = {
    sm: "max-w-md",
    md: "max-w-2xl",
    lg: "max-w-4xl",
    xl: "max-w-6xl",
    full: "w-full",
  }

  return (
    <div
      className={cn(
        "mx-auto w-full",
        sizeMap[size],
        padding && "px-4 sm:px-6 md:px-8",
        className
      )}
      dir="rtl"
    >
      {children}
    </div>
  )
}

interface ResponsiveGridProps {
  children: ReactNode
  columns?: 1 | 2 | 3 | 4 | 6
  gap?: "xs" | "sm" | "md" | "lg" | "xl"
  className?: string
}

/**
 * Responsive grid with preset breakpoints and gap sizes
 */
export function ResponsiveGrid({
  children,
  columns = 2,
  gap = "md",
  className,
}: ResponsiveGridProps) {
  const columnsMap = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
    6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
  }

  const gapMap = {
    xs: "gap-2 sm:gap-2.5",
    sm: "gap-3 sm:gap-4",
    md: "gap-4 sm:gap-5 md:gap-6",
    lg: "gap-5 sm:gap-6 md:gap-8",
    xl: "gap-6 sm:gap-8 md:gap-10",
  }

  return (
    <div className={cn("grid", columnsMap[columns], gapMap[gap], className)}>
      {children}
    </div>
  )
}

interface ResponsiveFlexProps {
  children: ReactNode
  direction?: "row" | "col"
  gap?: "xs" | "sm" | "md" | "lg"
  align?: "start" | "center" | "end" | "between"
  className?: string
}

/**
 * Responsive flex layout that stacks on mobile
 */
export function ResponsiveFlex({
  children,
  direction = "row",
  gap = "md",
  align = "start",
  className,
}: ResponsiveFlexProps) {
  const gapMap = {
    xs: "gap-2",
    sm: "gap-3",
    md: "gap-4",
    lg: "gap-6",
  }

  const alignMap = {
    start: "justify-start",
    center: "justify-center",
    end: "justify-end",
    between: "justify-between",
  }

  const directionMap = {
    row: "flex-row md:flex-row flex-col",
    col: "flex-col",
  }

  return (
    <div
      className={cn(
        "flex",
        directionMap[direction],
        gapMap[gap],
        alignMap[align],
        className
      )}
    >
      {children}
    </div>
  )
}

interface CardGridProps {
  children: ReactNode
  minWidth?: "xs" | "sm" | "md" | "lg"
  gap?: "sm" | "md" | "lg"
  className?: string
}

/**
 * Auto-responsive grid that maintains minimum card width
 */
export function CardGrid({
  children,
  minWidth = "sm",
  gap = "md",
  className,
}: CardGridProps) {
  const minWidthMap = {
    xs: "min-w-32",
    sm: "min-w-56",
    md: "min-w-80",
    lg: "min-w-96",
  }

  const gapMap = {
    sm: "gap-4",
    md: "gap-6",
    lg: "gap-8",
  }

  return (
    <div
      className={cn(
        "grid auto-fit",
        `grid-cols-[repeat(auto-fit,${minWidthMap[minWidth]})]`,
        gapMap[gap],
        className
      )}
    >
      {children}
    </div>
  )
}
