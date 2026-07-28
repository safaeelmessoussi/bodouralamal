import { Alert } from "@/hooks/use-alerts"
import { AlertCircle, CheckCircle, AlertTriangle, Info, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AlertListProps {
  alerts: Alert[]
  onDismiss: (id: string) => void
  isRtl?: boolean
}

const alertConfig = {
  success: {
    icon: CheckCircle,
    bgColor: "bg-green-50 dark:bg-green-900/30",
    borderColor: "border-green-200 dark:border-green-900",
    textColor: "text-green-600 dark:text-green-400",
  },
  error: {
    icon: AlertCircle,
    bgColor: "bg-red-50 dark:bg-red-900/30",
    borderColor: "border-red-200 dark:border-red-900",
    textColor: "text-red-600 dark:text-red-400",
  },
  warning: {
    icon: AlertTriangle,
    bgColor: "bg-yellow-50 dark:bg-yellow-900/30",
    borderColor: "border-yellow-200 dark:border-yellow-900",
    textColor: "text-yellow-600 dark:text-yellow-400",
  },
  info: {
    icon: Info,
    bgColor: "bg-blue-50 dark:bg-blue-900/30",
    borderColor: "border-blue-200 dark:border-blue-900",
    textColor: "text-blue-600 dark:text-blue-400",
  },
}

export function AlertList({
  alerts,
  onDismiss,
  isRtl = true,
}: AlertListProps) {
  if (alerts.length === 0) return null

  return (
    <div
      className="space-y-2"
      dir={isRtl ? "rtl" : "ltr"}
      role="region"
      aria-label="Notifications"
    >
      {alerts.map((alert) => {
        const config = alertConfig[alert.type]
        const Icon = config.icon

        return (
          <div
            key={alert.id}
            className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-4 flex gap-3 items-start animate-in fade-in duration-300`}
            role="alert"
          >
            <Icon className={`h-5 w-5 ${config.textColor} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              {alert.title && (
                <h4 className={`font-semibold ${config.textColor} mb-1`}>
                  {alert.title}
                </h4>
              )}
              <p className={`text-sm ${config.textColor}`}>{alert.message}</p>
            </div>
            {alert.dismissible && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDismiss(alert.id)}
                className="flex-shrink-0 h-8 w-8 p-0"
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
