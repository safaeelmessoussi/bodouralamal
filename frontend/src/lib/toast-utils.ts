import { toast } from "sonner"
import { CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react"

/**
 * Enhanced toast notification utilities with Arabic support
 * Provides consistent toast styling and messaging across the application
 */

interface ToastOptions {
  duration?: number
  description?: string
}

/**
 * Show success toast
 */
export function toastSuccess(
  message: string,
  options?: ToastOptions
) {
  toast.success(message, {
    duration: options?.duration || 3000,
    description: options?.description,
  })
}

/**
 * Show error toast with more prominent styling
 */
export function toastError(
  message: string,
  options?: ToastOptions
) {
  toast.error(message, {
    duration: options?.duration || 4000,
    description: options?.description,
  })
}

/**
 * Show warning toast
 */
export function toastWarning(
  message: string,
  options?: ToastOptions
) {
  toast.warning(message, {
    duration: options?.duration || 3500,
    description: options?.description,
  })
}

/**
 * Show info toast
 */
export function toastInfo(
  message: string,
  options?: ToastOptions
) {
  toast.info(message, {
    duration: options?.duration || 3000,
    description: options?.description,
  })
}

/**
 * Show loading toast
 */
export function toastLoading(message: string) {
  return toast.loading(message)
}

/**
 * Update a toast by ID
 */
export function toastUpdate(
  toastId: string | number,
  message: string,
  type: "success" | "error" | "warning" | "info" = "info"
) {
  toast[type](message, {
    id: toastId,
  })
}

/**
 * Dismiss a specific toast
 */
export function toastDismiss(toastId: string | number) {
  toast.dismiss(toastId)
}

/**
 * Dismiss all toasts
 */
export function toastDismissAll() {
  toast.dismiss()
}
