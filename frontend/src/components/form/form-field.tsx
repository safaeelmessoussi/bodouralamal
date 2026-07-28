import { ReactNode, InputHTMLAttributes } from "react"
import { Input } from "@/components/ui/input"

export interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
  required?: boolean
  isRtl?: boolean
  icon?: ReactNode
  helperText?: string
}

export function FormField({
  label,
  error,
  hint,
  required,
  isRtl = true,
  icon,
  helperText,
  disabled,
  ...props
}: FormFieldProps) {
  return (
    <div className="space-y-2" dir={isRtl ? "rtl" : "ltr"}>
      <label className="block text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-red-500 mr-1">*</span>}
      </label>

      <div className="relative">
        {icon && <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-muted-foreground">{icon}</div>}
        <Input
          {...props}
          disabled={disabled}
          className={`
            ${icon ? "pr-10" : ""}
            ${error ? "border-red-500 focus-visible:ring-red-500" : ""}
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          `}
          aria-invalid={!!error}
          aria-describedby={error ? `${props.name}-error` : undefined}
        />
      </div>

      {error && (
        <p id={`${props.name}-error`} className="text-sm text-red-500 flex items-center gap-1">
          <span className="text-lg">⚠️</span>
          {error}
        </p>
      )}

      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}

      {helperText && !error && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  )
}
