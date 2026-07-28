import PageHeader from "@/components/page-header"
import StatCard from "@/components/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Trophy, BookOpen, Clock, Target, CheckCircle2, AlertCircle } from "lucide-react"
import { ar } from "@/i18n/ar"

export default function StudentDashboard() {
  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title={ar.student.dashboard.title}
        description={ar.student.dashboard.myGrade}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={ar.student.dashboard.myGrade}
          value="8.7/10"
          description={ar.student.dashboard.currentAverage}
          icon={Trophy}
        />
        <StatCard
          title={ar.student.dashboard.surahsCompleted}
          value="12"
          description={`${ar.student.dashboard.of} 114`}
          icon={BookOpen}
          trend={{ value: 2, label: ar.student.dashboard.thisMonth }}
        />
        <StatCard
          title={ar.student.dashboard.attendance}
          value="96%"
          description={ar.student.dashboard.thisTerm}
          icon={CheckCircle2}
        />
        <StatCard
          title={ar.student.dashboard.nextClass}
          value={ar.student.dashboard.today}
          description="10:00 صباحاً - مجموعة أ1"
          icon={Clock}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{ar.student.dashboard.upcomingTasks}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { title: ar.student.dashboard.surahReview, due: "2026-01-29", priority: "high" },
              { title: ar.student.dashboard.islamicStudiesQuiz, due: "2026-01-30", priority: "medium" },
              { title: ar.student.dashboard.tajweedAssignment, due: "2026-02-01", priority: "low" },
            ].map((task, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{task.title}</p>
                  <p className="text-xs text-muted-foreground">{ar.student.dashboard.due}: {task.due}</p>
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
                  {task.priority === "high" ? ar.student.dashboard.high : task.priority === "medium" ? ar.student.dashboard.medium : ar.student.dashboard.low}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{ar.student.dashboard.myClasses}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { group: "مجموعة أ1", teacher: "أحمد حسن", day: "السبت، الإثنين، الأربعاء", time: "10:00 صباحاً" },
              { group: "الدراسات الإسلامية", teacher: "فاطمة علي", day: "الأحد، الثلاثاء، الخميس", time: "11:30 صباحاً" },
            ].map((cls, idx) => (
              <div key={idx} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-foreground">{cls.group}</p>
                    <p className="text-xs text-muted-foreground">مع {cls.teacher}</p>
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
            أهدافي التعليمية
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                إكمال حفظ القرآن الكريم
              </span>
              <span className="text-sm font-medium text-primary">62%</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-[62%] bg-primary transition-all" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">74 من 114 سورة مكتملة</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                تحسين درجات الدراسات الإسلامية
              </span>
              <span className="text-sm font-medium text-primary">85%</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-[85%] bg-primary transition-all" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">الهدف: 9.0/10</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                حضور مثالي هذا الفصل
              </span>
              <span className="text-sm font-medium text-primary">96%</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-[96%] bg-primary transition-all" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">يُسمح بغياب واحد فقط</p>
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
