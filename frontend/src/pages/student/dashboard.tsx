import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Trophy, BookOpen, Clock, Target, CheckCircle2, AlertCircle } from "lucide-react"

export default function StudentDashboard() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="My Learning Dashboard"
        description="Track your progress and upcoming tasks"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="My Grade"
          value="8.7/10"
          description="Current average"
          icon={Trophy}
        />
        <StatCard
          title="Surahs Completed"
          value="12"
          description="Of 114"
          icon={BookOpen}
          trend={{ value: 2, label: "this month" }}
        />
        <StatCard
          title="Attendance"
          value="96%"
          description="This term"
          icon={CheckCircle2}
        />
        <StatCard
          title="Next Class"
          value="Today"
          description="10:00 AM - Group A1"
          icon={Clock}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Tasks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { title: "Surah Al-Baqarah Review", due: "2026-01-29", priority: "high" },
              { title: "Islamic Studies Quiz", due: "2026-01-30", priority: "medium" },
              { title: "Tajweed Rules Assignment", due: "2026-02-01", priority: "low" },
            ].map((task, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{task.title}</p>
                  <p className="text-xs text-muted-foreground">Due: {task.due}</p>
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
                  {task.priority}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My Classes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { group: "Group A1", teacher: "Ahmed Hassan", day: "Sat, Mon, Wed", time: "10:00 AM" },
              { group: "Islamic Studies", teacher: "Fatima Ali", day: "Sun, Tue, Thu", time: "11:30 AM" },
            ].map((cls, idx) => (
              <div key={idx} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-foreground">{cls.group}</p>
                    <p className="text-xs text-muted-foreground">with {cls.teacher}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs whitespace-nowrap ml-2">
                    {cls.time}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{cls.day}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            My Learning Goals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                Complete Quran Memorization
              </span>
              <span className="text-sm font-medium text-primary">62%</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-[62%] bg-primary transition-all" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">74 of 114 Surahs completed</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                Improve Islamic Studies Grade
              </span>
              <span className="text-sm font-medium text-primary">85%</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-[85%] bg-primary transition-all" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Target: 9.0/10</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                Perfect Attendance This Term
              </span>
              <span className="text-sm font-medium text-primary">96%</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-[96%] bg-primary transition-all" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">1 absence allowed</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Recent Achievement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium text-foreground">Completed Surah Al-Fatiha</p>
            <p className="text-sm text-muted-foreground mt-1">Achieved on 2026-01-20</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              Attention Needed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium text-foreground">Review Tajweed Rules</p>
            <p className="text-sm text-muted-foreground mt-1">Your teacher recommends additional practice</p>
            <Button size="sm" variant="outline" className="mt-3">
              View Lessons
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
