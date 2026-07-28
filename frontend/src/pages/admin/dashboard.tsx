import { useEffect, useState } from "react"
import { CheckCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Link } from "react-router-dom"
import { apiClient } from "@/services/api"
import PageHeader from "@/components/page-header"
import StatsGrid from "@/components/dashboard/stats-grid"
import EventList from "@/components/dashboard/event-list"
import RegistrationList from "@/components/dashboard/registration-list"
import { ar } from "@/i18n/ar"
import {
  getAdminStats,
  getRecentRegistrations,
  getUpcomingEvents,
} from "@/services/dashboard-adapter"

export default function AdminDashboard() {
  const [branchesCount, setBranchesCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [branches, setBranches] = useState([])
  
  const stats = getAdminStats()
  const registrations = getRecentRegistrations()
  const events = getUpcomingEvents()

  useEffect(() => {
    const loadData = async () => {
      try {
        const branchesResp = await apiClient.getBranches(1, 100)
        setBranchesCount(branchesResp.total)
        setBranches(branchesResp.data.slice(0, 3))
      } catch (error) {
        console.warn("[v0] Failed to load branches, using mock data")
        setBranchesCount(12)
        setBranches([])
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title={ar.admin?.dashboard?.title || "لوحة التحكم"}
        description={ar.admin?.dashboard?.description || "نظرة عامة على منصة بذور الأمل"}
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

      <StatsGrid metrics={stats.metrics} isLoading={stats.isLoading} columns={4} />

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
                  <p className="text-xs text-muted-foreground">
                    تم الإنشاء: {new Date(branch.created_at).toLocaleDateString('ar')}
                  </p>
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
        <div className="lg:col-span-2">
          <EventList events={events} title="الأحداث القادمة" />
        </div>
      </div>

      {/* Recent Registrations */}
      <div>
        <RegistrationList registrations={registrations} title="أحدث التسجيلات" />
      </div>
    </div>
  )
}
