import { AlertCircle } from "lucide-react"

export interface ErrorAlertProps {
  title?: string
  message: string
  isRtl?: boolean
}

export function ErrorAlert({ title, message, isRtl = true }: ErrorAlertProps) {
  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-900/30"
      role="alert"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex gap-3">
        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          {title && <h3 className="font-semibold text-red-600 dark:text-red-400 mb-1">{title}</h3>}
          <p className="text-red-600 dark:text-red-400">{message}</p>
        </div>
      </div>
    </div>
  )
}
