import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { UpcomingEvent } from "@/services/dashboard-adapter"
import { Calendar } from "lucide-react"

interface EventListProps {
  events: UpcomingEvent[]
  title?: string
  emptyMessage?: string
}

const eventTypeColors = {
  exam: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  meeting: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  event: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
}

const eventTypeLabels = {
  exam: "امتحان",
  meeting: "اجتماع",
  event: "حدث",
}

export default function EventList({
  events,
  title = "الأحداث القادمة",
  emptyMessage = "لا توجد أحداث قادمة",
}: EventListProps) {
  if (events.length === 0) {
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
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-center gap-3 rounded-lg border border-border p-3"
          >
            <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{event.title}</p>
              <p className="text-xs text-muted-foreground">{event.date}</p>
            </div>
            <Badge className={eventTypeColors[event.type]}>
              {eventTypeLabels[event.type]}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
