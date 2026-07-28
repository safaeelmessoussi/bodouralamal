import { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

interface LoadingOverlayProps {
  isLoading: boolean
  children: ReactNode
  message?: string
  blur?: boolean
  fullScreen?: boolean
  className?: string
}

/**
 * Loading overlay that dims content while loading
 * Supports both inline and full-screen modes
 */
export function LoadingOverlay({
  isLoading,
  children,
  message = "جاري التحميل...",
  blur = true,
  fullScreen = false,
  className,
}: LoadingOverlayProps) {
  return (
    <div className={cn("relative", className)}>
      {children}
      {isLoading && (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "bg-background/50 backdrop-blur-sm z-50",
            "rounded-lg transition-opacity",
            fullScreen && "fixed"
          )}
          role="status"
          aria-live="polite"
          aria-label={message}
        >
          <div className="flex flex-col items-center gap-3">
            <Spinner className="h-8 w-8" />
            {message && (
              <p className="text-sm text-foreground font-medium">{message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface SkeletonLoadingProps {
  isLoading: boolean
  children: ReactNode
  skeleton: ReactNode
}

/**
 * Shows skeleton placeholder while loading
 */
export function SkeletonLoading({
  isLoading,
  children,
  skeleton,
}: SkeletonLoadingProps) {
  return isLoading ? <>{skeleton}</> : <>{children}</>
}

interface ProgressLoadingProps {
  isLoading: boolean
  progress?: number // 0-100
  children: ReactNode
}

/**
 * Shows progress bar while loading
 */
export function ProgressLoading({
  isLoading,
  progress = 0,
  children,
}: ProgressLoadingProps) {
  return (
    <>
      {isLoading && (
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
      {children}
    </>
  )
}

interface PendingUIProps {
  isPending: boolean
  children: ReactNode
}

/**
 * Dimmed UI state while operation is pending
 * Useful for form submissions and async operations
 */
export function PendingUI({ isPending, children }: PendingUIProps) {
  return (
    <div
      className={cn(
        "transition-opacity duration-200",
        isPending && "opacity-50 pointer-events-none"
      )}
      aria-disabled={isPending}
    >
      {children}
    </div>
  )
}
