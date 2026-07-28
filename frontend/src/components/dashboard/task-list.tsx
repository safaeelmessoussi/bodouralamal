import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TaskItem } from "@/services/dashboard-adapter"
import { ar } from "@/i18n/ar"

interface TaskListProps {
  tasks: TaskItem[]
  title?: string
  emptyMessage?: string
}

export default function TaskList({
  tasks,
  title = ar.student.dashboard.upcomingTasks,
  emptyMessage = ar.emptyStates.noTasks,
}: TaskListProps) {
  if (tasks.length === 0) {
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
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 rounded-lg border border-border p-3"
          >
            <div className="flex-1">
              <p className="font-medium text-foreground">{task.title}</p>
              <p className="text-xs text-muted-foreground">
                {ar.student.dashboard.due}: {task.due}
              </p>
            </div>
            <Badge
              className={
                task.priority === "high"
                  ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                  : task.priority === "medium"
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                  : "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
              }
            >
              {task.priority === "high"
                ? ar.student.dashboard.high
                : task.priority === "medium"
                ? ar.student.dashboard.medium
                : ar.student.dashboard.low}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
