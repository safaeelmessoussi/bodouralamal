import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: string | number
  delta?: string
  deltaUp?: boolean
  icon: React.ElementType
  iconColor?: string
  description?: string
}

export default function StatCard({
  title,
  value,
  delta,
  deltaUp,
  icon: Icon,
  iconColor = "text-primary",
  description,
}: StatCardProps) {
  return (
    <Card className="shadow-none" dir="rtl">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground truncate">{title}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
            {delta && (
              <p
                className={cn(
                  "mt-1 text-xs font-medium",
                  deltaUp ? "text-green-600 dark:text-green-400" : "text-destructive"
                )}
              >
                {deltaUp ? "↑" : "↓"} {delta}
              </p>
            )}
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <div className={cn("flex items-center justify-center size-10 rounded-xl bg-primary/10 shrink-0", iconColor)}>
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
