import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BarChart3, BookOpen, Award, AlertCircle } from "lucide-react"

export default function ParentDashboard() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Parent Dashboard"
        description="Monitor your child's progress and achievements"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Overall Grade"
          value="8.5/10"
          description="Current average"
          icon={Award}
        />
        <StatCard
          title="Attendance"
          value="94%"
          description="Present this month"
          icon={BarChart3}
          trend={{ value: 2, label: "from last month" }}
        />
        <StatCard
          title="Surahs Completed"
          value="12"
          description="Of 114"
          icon={BookOpen}
          trend={{ value: 3, label: "this month" }}
        />
        <StatCard
          title="Next Assessment"
          value="In 5 days"
          description="Islamic Studies"
          icon={AlertCircle}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Assessments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assessment</TableHead>
                  <TableHead className="text-right">Grade</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { name: "Surah Al-Fatiha Quiz", grade: "9/10", date: "2026-01-28" },
                  { name: "Islamic Principles", grade: "8/10", date: "2026-01-25" },
                  { name: "Recitation Test", grade: "8.5/10", date: "2026-01-22" },
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
            <CardTitle>Current Classes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { group: "Group A1", teacher: "Ahmed Hassan", room: "Room 1", time: "10:00 AM" },
              { group: "Islamic Studies", teacher: "Fatima Ali", room: "Room 3", time: "02:00 PM" },
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
