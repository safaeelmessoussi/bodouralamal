import { useEffect, useState } from "react"
import { Users, BookOpen, Building2, CheckCircle, AlertCircle, GraduationCap, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Link } from "react-router-dom"
import { apiClient } from "@/services/api"
import { toast } from "sonner"
import PageHeader from "@/components/page-header"
import StatCard from "@/components/stat-card"

export default function AdminDashboard() {
  const [branchesCount, setBranchesCount] = useState(0)
  const [usersCount, setUsersCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [branches, setBranches] = useState([])

  useEffect(() => {
    const loadData = async () => {
      try {
        const branchesResp = await apiClient.getBranches(1, 100)
        setBranchesCount(branchesResp.total)
        setBranches(branchesResp.data.slice(0, 3))
        
        // Try to load users separately (may not be available yet)
        try {
          const usersResp = await apiClient.getUsers(1, 100)
          setUsersCount(usersResp.total)
        } catch (error) {
          console.warn("[v0] Users endpoint not available, using mock count")
          setUsersCount(3) // Mock fallback
        }
      } catch (error) {
        console.error("[v0] Failed to load dashboard data:", error)
        // Use mock data for fallback
        setBranchesCount(2)
        setUsersCount(3)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  const recentRegistrations = [
    { name: "فاطمة الزهراء بنموسى", type: "طالبة", branch: "فرع الحي المحمدي", time: "منذ 10 دقائق", status: "pending" },
    { name: "خديجة العلوي", type: "أم / ولية", branch: "فرع القدس", time: "منذ 25 دقيقة", status: "pending" },
    { name: "مريم السعيدي", type: "طالبة", branch: "فرع السلام", time: "منذ ساعة", status: "pending" },
    { name: "نور الهدى شكيري", type: "معلمة", branch: "فرع الحي المحمدي", time: "منذ ساعتين", status: "pending" },
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

  return (
    <div dir="rtl">
      <PageHeader
        title="لوحة التحكم"
        description="نظرة عامة على منصة بذور الأمل"
        action={
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
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard title="إجمالي المسجلين" value={String(usersCount)} description="جميع الأدوار" icon={Users} />
          <StatCard title="الفروع" value={String(branchesCount)} description="فروع نشطة" icon={Building2} />
          <StatCard title="إجمالي المجموعات" value="28" description="في جميع الفروع" icon={BookOpen} />
          <StatCard title="طلبات معلقة" value="12" description="تحتاج مراجعة" icon={AlertCircle} iconColor="text-orange-500" />
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Branches Overview */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">نظرة على الفروع</CardTitle>
            <CardDescription>توزيع الطلاب والمعلمات</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i}>
                    <Skeleton className="h-4 w-24 mb-2" />
                    <Skeleton className="h-2 w-full" />
                  </div>
                ))}
              </div>
            ) : branches.length > 0 ? (
              branches.map((branch) => (
                <div key={branch.id} className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">{branch.name}</span>
                    <Badge variant="secondary" className="text-[10px]">{branch.rooms_count} قاعات</Badge>
                  </div>
                  <Progress value={50} className="h-2" />
                  <p className="text-xs text-muted-foreground">Created {new Date(branch.created_at).toLocaleDateString()}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد فروع حتى الآن</p>
            )}
            <Separator className="my-2" />
            <Button asChild variant="ghost" className="w-full text-sm" size="sm">
              <Link to="/admin/branches">عرض جميع الفروع</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Upcoming Events */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">الأحداث القادمة</CardTitle>
            <CardDescription>أهم المناسبات والاجتماعات</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingEvents.map((event, i) => (
              <div key={i} className="flex items-start gap-3 pb-3 border-b last:border-0 last:pb-0">
                <Badge className={eventColors[event.type]} variant="secondary">
                  {event.type === "exam" ? "اختبار" : event.type === "meeting" ? "اجتماع" : "حدث"}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{event.title}</p>
                  <p className="text-xs text-muted-foreground">{event.date} • {event.branch}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recent Registrations */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">أحدث التسجيلات</CardTitle>
              <CardDescription>طلبات التسجيل المنتظرة للمراجعة</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/approvals">عرض الكل</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentRegistrations.map((reg, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarFallback className="bg-primary/20 text-xs">
                    {reg.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{reg.name}</p>
                  <p className="text-xs text-muted-foreground">{reg.type} • {reg.branch}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="outline" className="text-[10px]">{reg.time}</Badge>
                  <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-[10px]">
                    في الانتظار
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
