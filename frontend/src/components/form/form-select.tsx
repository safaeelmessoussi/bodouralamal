import { SelectHTMLAttributes } from "react"

export interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  error?: string
  hint?: string
  required?: boolean
  isRtl?: boolean
  options: Array<{
    value: string
    label: string
  }>
  placeholder?: string
}

export function FormSelect({
  label,
  error,
  hint,
  required,
  isRtl = true,
  options,
  placeholder,
  disabled,
  ...props
}: FormSelectProps) {
  return (
    <div className="space-y-2" dir={isRtl ? "rtl" : "ltr"}>
      <label className="block text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-red-500 mr-1">*</span>}
      </label>

      <select
        {...props}
        disabled={disabled}
        className={`
          flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm
          ring-offset-background placeholder:text-muted-foreground
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:opacity-50
          ${error ? "border-red-500 focus-visible:ring-red-500" : ""}
        `}
        aria-invalid={!!error}
        aria-describedby={error ? `${props.name}-error` : undefined}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {error && (
        <p id={`${props.name}-error`} className="text-sm text-red-500 flex items-center gap-1">
          <span className="text-lg">⚠️</span>
          {error}
        </p>
      )}

      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
