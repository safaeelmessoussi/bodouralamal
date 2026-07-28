import PageHeader from "@/components/page-header"
import StatCard from "@/components/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, BookOpen, Award, Clock } from "lucide-react"
import { useNavigate } from "react-router-dom"

export default function TeacherDashboard() {
  const navigate = useNavigate()

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title="لوحة تحكم المعلمة"
        description="أدر مجموعاتك، تابع تقدم الطلاب، وأجر الامتحانات"
      >
        <Button onClick={() => navigate("/teacher/groups")}>
          Manage Groups
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Groups"
          value="4"
          description="Groups you manage"
          icon={Users}
          trend={{ value: 12, label: "from last month" }}
        />
        <StatCard
          title="Total Students"
          value="48"
          description="Students in your groups"
          icon={Users}
          trend={{ value: 8, label: "new this month" }}
        />
        <StatCard
          title="Exams Pending"
          value="6"
          description="Awaiting grading"
          icon={Award}
          trend={{ value: 2, label: "past due" }}
        />
        <StatCard
          title="Avg. Progress"
          value="62%"
          description="Student memorization"
          icon={BookOpen}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Assignments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { name: "Surah Al-Fatiha Review", group: "Group A1", due: "2026-01-29" },
              { name: "Quran Verses Quiz", group: "Group B2", due: "2026-01-30" },
              { name: "Islamic Studies Module", group: "Group C1", due: "2026-02-01" },
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
            <CardTitle>Upcoming Sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { group: "Group A1", time: "10:00 AM", room: "Room 1" },
              { group: "Group B2", time: "11:30 AM", room: "Room 2" },
              { group: "Group C1", time: "02:00 PM", room: "Room 1" },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <Clock className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">{item.group}</p>
                  <p className="text-xs text-muted-foreground">{item.room}</p>
                </div>
                <p className="text-sm font-medium text-foreground">{item.time}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
