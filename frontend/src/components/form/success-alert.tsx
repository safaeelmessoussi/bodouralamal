import { CheckCircle, Info } from "lucide-react"

export interface SuccessAlertProps {
  title?: string
  message: string
  type?: "success" | "info"
  isRtl?: boolean
}

export function SuccessAlert({
  title,
  message,
  type = "success",
  isRtl = true,
}: SuccessAlertProps) {
  const isSuccess = type === "success"
  const bgColor = isSuccess
    ? "bg-green-50 dark:bg-green-900/30"
    : "bg-blue-50 dark:bg-blue-900/30"
  const borderColor = isSuccess
    ? "border-green-200 dark:border-green-900"
    : "border-blue-200 dark:border-blue-900"
  const textColor = isSuccess
    ? "text-green-600 dark:text-green-400"
    : "text-blue-600 dark:text-blue-400"
  const Icon = isSuccess ? CheckCircle : Info

  return (
    <div
      className={`rounded-lg border ${borderColor} ${bgColor} p-4 text-sm`}
      role="status"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex gap-3">
        <Icon className={`h-5 w-5 ${textColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1">
          {title && <h3 className={`font-semibold ${textColor} mb-1`}>{title}</h3>}
          <p className={textColor}>{message}</p>
        </div>
      </div>
    </div>
  )
}
