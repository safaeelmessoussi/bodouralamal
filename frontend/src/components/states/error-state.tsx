import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  isRtl?: boolean
}

export function ErrorState({
  title,
  message,
  onRetry,
  isRtl = true,
}: ErrorStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-12 text-center dark:border-red-900 dark:bg-red-900/30"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <AlertTriangle className="h-12 w-12 text-red-600 dark:text-red-400 mb-4" />
      {title && (
        <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
          {title}
        </h3>
      )}
      <p className="text-sm text-red-600 dark:text-red-400 mb-6 max-w-sm">
        {message}
      </p>
      {onRetry && (
        <Button
          onClick={onRetry}
          variant="outline"
          className="border-red-200 hover:bg-red-100 dark:border-red-900 dark:hover:bg-red-900/50"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          إعادة محاولة
        </Button>
      )}
    </div>
  )
}
