import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface PageContainerProps {
  children: ReactNode
  className?: string
  isRtl?: boolean
}

/**
 * PageContainer component that wraps page content with proper RTL support
 * Ensures consistent layout direction across all pages
 */
export function PageContainer({
  children,
  className,
  isRtl = true,
}: PageContainerProps) {
  return (
    <div
      className={cn("space-y-8", className)}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {children}
    </div>
  )
}
