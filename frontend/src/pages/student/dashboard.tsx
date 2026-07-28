import PageHeader from "@/components/page-header"
import StatsGrid from "@/components/dashboard/stats-grid"
import TaskList from "@/components/dashboard/task-list"
import ClassList from "@/components/dashboard/class-list"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Target, CheckCircle2, AlertCircle } from "lucide-react"
import { ar } from "@/i18n/ar"
import {
  getStudentStats,
  getStudentTasks,
  getStudentClasses,
} from "@/services/dashboard-adapter"

export default function StudentDashboard() {
  const stats = getStudentStats()
  const tasks = getStudentTasks()
  const classes = getStudentClasses()

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title={ar.student.dashboard.title}
        description={ar.student.dashboard.myGrade}
      />

      <StatsGrid metrics={stats.metrics} isLoading={stats.isLoading} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TaskList tasks={tasks} />
        <ClassList classes={classes} />
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
              إنجاز جديد
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium text-foreground">إتمام حفظ سورة الفاتحة</p>
            <p className="text-sm text-muted-foreground mt-1">تم الإنجاز في 2026-01-20</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              يحتاج إلى اهتمام
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium text-foreground">مراجعة قواعد التجويد</p>
            <p className="text-sm text-muted-foreground mt-1">يوصي معلمك بالممارسة الإضافية</p>
            <Button size="sm" variant="outline" className="mt-3">
              عرض الدروس
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
