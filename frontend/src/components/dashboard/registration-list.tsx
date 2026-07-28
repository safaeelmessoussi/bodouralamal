import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { RecentEvent } from "@/services/dashboard-adapter"
import { UserPlus } from "lucide-react"

interface RegistrationListProps {
  registrations: RecentEvent[]
  title?: string
  emptyMessage?: string
}

const statusColors = {
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
}

const statusLabels = {
  pending: "قيد الانتظار",
  approved: "موافق عليه",
  rejected: "مرفوض",
}

export default function RegistrationList({
  registrations,
  title = "التسجيلات الأخيرة",
  emptyMessage = "لا توجد تسجيلات جديدة",
}: RegistrationListProps) {
  if (registrations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">
            {emptyMessage}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {registrations.map((reg) => (
          <div
            key={reg.id}
            className="flex items-center gap-3 rounded-lg border border-border p-3"
          >
            <UserPlus className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{reg.name}</p>
              <p className="text-xs text-muted-foreground">
                {reg.type} • {reg.branch}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <Badge className={statusColors[reg.status]}>
                {statusLabels[reg.status]}
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">{reg.time}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
