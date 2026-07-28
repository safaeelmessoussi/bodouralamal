import { ReactNode } from "react"
import { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
  isRtl?: boolean
  children?: ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  isRtl = true,
  children,
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 p-12 text-center"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <Icon className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">{description}</p>
      {children}
      {action && (
        <Button onClick={action.onClick} variant="outline">
          {action.label}
        </Button>
      )}
    </div>
  )
}
