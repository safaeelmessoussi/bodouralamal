import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ClassItem } from "@/services/dashboard-adapter"
import { ar } from "@/i18n/ar"

interface ClassListProps {
  classes: ClassItem[]
  title?: string
  emptyMessage?: string
}

export default function ClassList({
  classes,
  title = ar.student.dashboard.myClasses,
  emptyMessage = "لا توجد فصول حتى الآن",
}: ClassListProps) {
  if (classes.length === 0) {
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
        {classes.map((cls) => (
          <div key={cls.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-foreground">{cls.name}</p>
                <p className="text-xs text-muted-foreground">مع {cls.instructor}</p>
              </div>
              <Badge variant="secondary" className="text-xs whitespace-nowrap ms-2">
                {cls.time}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{cls.days}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
