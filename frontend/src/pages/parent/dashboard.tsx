import PageHeader from "@/components/page-header"
import StatsGrid from "@/components/dashboard/stats-grid"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Award } from "lucide-react"
import { ar } from "@/i18n/ar"
import { getParentStats } from "@/services/dashboard-adapter"

export default function ParentDashboard() {
  const stats = getParentStats()

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title={ar.parent.dashboard.title}
        description={ar.parent.dashboard.childGrade}
      />

      <StatsGrid metrics={stats.metrics} isLoading={stats.isLoading} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>التقييمات الأخيرة</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التقييم</TableHead>
                  <TableHead className="text-right">الدرجة</TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { name: "اختبار سورة الفاتحة", grade: "9/10", date: "2026-01-28" },
                  { name: "أساسيات الإسلام", grade: "8/10", date: "2026-01-25" },
                  { name: "اختبار التلاوة", grade: "8.5/10", date: "2026-01-22" },
                ].map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                      {item.grade}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{item.date}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الفصول الحالية</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { group: "مجموعة أ1", teacher: "أحمد حسن", room: "القاعة 1", time: "10:00 صباحاً" },
              { group: "الدراسات الإسلامية", teacher: "فاطمة علي", room: "القاعة 3", time: "02:00 مساءً" },
            ].map((item, idx) => (
              <div key={idx} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-foreground">{item.group}</p>
                    <p className="text-xs text-muted-foreground">{item.teacher}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {item.time}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{item.room}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Learning Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">Quran Memorization</span>
                <span className="text-sm text-muted-foreground">62%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full w-[62%] bg-primary" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">Islamic Studies</span>
                <span className="text-sm text-muted-foreground">85%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full w-[85%] bg-primary" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">Class Participation</span>
                <span className="text-sm text-muted-foreground">78%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full w-[78%] bg-primary" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
