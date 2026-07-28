import { useState, useCallback } from "react"

export type AlertType = "success" | "error" | "warning" | "info"

export interface Alert {
  id: string
  type: AlertType
  title?: string
  message: string
  dismissible?: boolean
  autoClose?: number
}

/**
 * Hook for managing application alerts with auto-dismiss functionality
 * Useful for displaying multiple alerts on a page (forms, pages, etc.)
 */
export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([])

  const addAlert = useCallback(
    (alert: Omit<Alert, "id">) => {
      const id = `alert-${Date.now()}-${Math.random()}`
      const newAlert: Alert = {
        ...alert,
        id,
        dismissible: alert.dismissible !== false,
        autoClose: alert.autoClose || 5000,
      }

      setAlerts((prev) => [...prev, newAlert])

      // Auto-dismiss if autoClose is set
      if (newAlert.autoClose) {
        setTimeout(() => {
          removeAlert(id)
        }, newAlert.autoClose)
      }

      return id
    },
    []
  )

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id))
  }, [])

  const clearAlerts = useCallback(() => {
    setAlerts([])
  }, [])

  const addSuccess = useCallback(
    (message: string, title?: string) => {
      return addAlert({ type: "success", message, title })
    },
    [addAlert]
  )

  const addError = useCallback(
    (message: string, title?: string) => {
      return addAlert({ type: "error", message, title })
    },
    [addAlert]
  )

  const addWarning = useCallback(
    (message: string, title?: string) => {
      return addAlert({ type: "warning", message, title })
    },
    [addAlert]
  )

  const addInfo = useCallback(
    (message: string, title?: string) => {
      return addAlert({ type: "info", message, title })
    },
    [addAlert]
  )

  return {
    alerts,
    addAlert,
    removeAlert,
    clearAlerts,
    addSuccess,
    addError,
    addWarning,
    addInfo,
  }
}
