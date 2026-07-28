import PageHeader from "@/components/page-header"
import StatsGrid from "@/components/dashboard/stats-grid"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ar } from "@/i18n/ar"
import { useNavigate } from "react-router-dom"
import { getTeacherStats } from "@/services/dashboard-adapter"

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const stats = getTeacherStats()

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title={ar.teacher.dashboard.title}
        description={ar.teacher.dashboard.myGroups}
        actions={
          <Button onClick={() => navigate("/teacher/groups")}>
            {ar.teacher.groups.manage}
          </Button>
        }
      />

      <StatsGrid metrics={stats.metrics} isLoading={stats.isLoading} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الواجبات الأخيرة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { name: "مراجعة سورة الفاتحة", group: "مجموعة أ1", due: "2026-01-29" },
              { name: "اختبار آيات القرآن", group: "مجموعة ب2", due: "2026-01-30" },
              { name: "وحدة الدراسات الإسلامية", group: "مجموعة ج1", due: "2026-02-01" },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.group}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-muted-foreground">{item.due}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الجلسات القادمة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { group: "مجموعة أ1", time: "10:00 صباحاً", room: "القاعة 1" },
              { group: "مجموعة ب2", time: "11:30 صباحاً", room: "القاعة 2" },
              { group: "مجموعة ج1", time: "02:00 مساءً", room: "القاعة 1" },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{item.group}</p>
                  <p className="text-xs text-muted-foreground">{item.room}</p>
                </div>
                <p className="text-sm font-medium text-foreground ms-2">{item.time}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
