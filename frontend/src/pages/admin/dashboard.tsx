import { Users, BookOpen, Building2, CheckCircle, TrendingUp, Clock, AlertCircle, GraduationCap } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import PageHeader from "@/components/page-header"
import StatCard from "@/components/stat-card"
import { Link } from "react-router-dom"

const recentRegistrations = [
  { name: "فاطمة الزهراء بنموسى", type: "طالبة", branch: "فرع الحي المحمدي", time: "منذ 10 دقائق", status: "pending" },
  { name: "خديجة العلوي", type: "أم / ولية", branch: "فرع القدس", time: "منذ 25 دقيقة", status: "pending" },
  { name: "مريم السعيدي", type: "طالبة", branch: "فرع السلام", time: "منذ ساعة", status: "pending" },
  { name: "نور الهدى شكيري", type: "معلمة", branch: "فرع الحي المحمدي", time: "منذ ساعتين", status: "pending" },
]

const branches = [
  { name: "فرع الحي المحمدي", students: 142, teachers: 8, capacity: 71 },
  { name: "فرع القدس", students: 98, teachers: 6, capacity: 65 },
  { name: "فرع السلام", students: 115, teachers: 7, capacity: 77 },
]

const upcomingEvents = [
  { title: "اختبار الحفظ الشهري", date: "غدًا، 9:00 ص", branch: "جميع الفروع", type: "exam" },
  { title: "اجتماع المعلمات", date: "الخميس، 3:00 م", branch: "فرع الحي المحمدي", type: "meeting" },
  { title: "حفل التكريم الفصلي", date: "السبت، 10:00 ص", branch: "المقر الرئيسي", type: "event" },
]

const eventColors: Record<string, string> = {
  exam: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  meeting: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  event: "bg-primary/10 text-primary",
}

export default function AdminDashboard() {
  return (
    <div dir="rtl">
      <PageHeader
        title="لوحة التحكم"
        description="نظرة عامة على منصة بذور الأمل"
        actions={
          <Button asChild>
            <Link to="/admin/approvals">
              <CheckCircle className="size-4 me-2" />
              مراجعة الطلبات
              <Badge className="ms-2 h-5 px-1.5 text-[10px] bg-white/20 border-0">12</Badge>
            </Link>
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="إجمالي المسجلين" value="355" delta="18% هذا الشهر" deltaUp icon={Users} />
        <StatCard title="المجموعات النشطة" value="28" description="في 3 فروع" icon={BookOpen} />
        <StatCard title="المعلمات" value="21" delta="2 جديدتين" deltaUp icon={GraduationCap} />
        <StatCard title="طلبات معلقة" value="12" description="تحتاج مراجعة" icon={AlertCircle} iconColor="text-orange-500" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Recent registrations */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">آخر طلبات التسجيل</CardTitle>
                  <CardDescription>12 طلبًا تنتظر المراجعة</CardDescription>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/admin/approvals">عرض الكل</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {recentRegistrations.map((reg, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {reg.name[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{reg.name}</p>
                      <p className="text-xs text-muted-foreground">{reg.branch} · {reg.type}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{reg.time}</span>
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-0">
                        معلق
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Branch capacity */}
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">الطاقة الاستيعابية للفروع</CardTitle>
              <CardDescription>نسبة الامتلاء الحالية</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {branches.map((branch, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{branch.name}</span>
                    <span className="text-muted-foreground tabular-nums">{branch.students} طالبة · {branch.capacity}%</span>
                  </div>
                  <Progress value={branch.capacity} className="h-1.5" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right panel */}
        <div className="space-y-5">
          {/* Upcoming events */}
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">الأحداث القادمة</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pb-4">
              {upcomingEvents.map((ev, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center pt-1">
                    <div className="size-2 rounded-full bg-primary mt-0.5" />
                    {i < upcomingEvents.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                  </div>
                  <div className="pb-3">
                    <p className="text-sm font-medium text-foreground">{ev.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ev.date}</p>
                    <Badge variant="secondary" className={`mt-1.5 text-[10px] h-5 px-1.5 border-0 ${eventColors[ev.type]}`}>
                      {ev.branch}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quick actions */}
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">إجراءات سريعة</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pb-4">
              <Button variant="outline" className="w-full justify-start gap-2 text-sm" asChild>
                <Link to="/admin/users">
                  <Users className="size-4 text-muted-foreground" />
                  إضافة مستخدم جديد
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2 text-sm" asChild>
                <Link to="/admin/groups">
                  <BookOpen className="size-4 text-muted-foreground" />
                  إنشاء مجموعة
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2 text-sm" asChild>
                <Link to="/admin/content">
                  <TrendingUp className="size-4 text-muted-foreground" />
                  رفع محتوى تعليمي
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2 text-sm" asChild>
                <Link to="/admin/calendar">
                  <Clock className="size-4 text-muted-foreground" />
                  جدولة حدث
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
