import { useState } from "react"
import { toast } from "sonner"
import { Check, X, Eye, Filter, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import PageHeader from "@/components/page-header"

type Status = "pending" | "approved" | "rejected"
type Role = "student" | "parent" | "teacher"

interface Registration {
  id: number
  name: string
  phone: string
  email: string
  role: Role
  branch: string
  submittedAt: string
  status: Status
  notes?: string
  age?: number
  nationalId?: string
}

const initialData: Registration[] = [
  { id: 1, name: "فاطمة الزهراء بنموسى", phone: "0661234567", email: "fatima@email.com", role: "student", branch: "فرع الحي المحمدي", submittedAt: "2026-07-25", status: "pending", age: 12, nationalId: "BJ123456" },
  { id: 2, name: "خديجة العلوي", phone: "0672345678", email: "khadija@email.com", role: "parent", branch: "فرع القدس", submittedAt: "2026-07-25", status: "pending" },
  { id: 3, name: "مريم السعيدي", phone: "0683456789", email: "mariam@email.com", role: "student", branch: "فرع السلام", submittedAt: "2026-07-24", status: "pending", age: 15, nationalId: "BK234567" },
  { id: 4, name: "نور الهدى شكيري", phone: "0694567890", email: "nour@email.com", role: "teacher", branch: "فرع الحي المحمدي", submittedAt: "2026-07-24", status: "pending" },
  { id: 5, name: "أسماء الحسناوي", phone: "0665678901", email: "asmaa@email.com", role: "student", branch: "فرع القدس", submittedAt: "2026-07-23", status: "pending", age: 10, nationalId: "BL345678" },
  { id: 6, name: "سميرة بنعلي", phone: "0676789012", email: "samira@email.com", role: "parent", branch: "فرع السلام", submittedAt: "2026-07-22", status: "approved" },
  { id: 7, name: "هاجر المرابط", phone: "0687890123", email: "hajar@email.com", role: "teacher", branch: "فرع القدس", submittedAt: "2026-07-20", status: "rejected", notes: "ملف ناقص" },
]

const roleLabels: Record<Role, string> = { student: "طالبة", parent: "أم / ولية", teacher: "معلمة" }
const roleColors: Record<Role, string> = {
  student: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  parent: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  teacher: "bg-primary/10 text-primary",
}
const statusLabels: Record<Status, string> = { pending: "معلق", approved: "مقبول", rejected: "مرفوض" }
const statusColors: Record<Status, string> = {
  pending: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function ApprovalsPage() {
  const [data, setData] = useState<Registration[]>(initialData)
  const [search, setSearch] = useState("")
  const [branchFilter, setBranchFilter] = useState("all")
  const [selected, setSelected] = useState<Registration | null>(null)
  const [activeTab, setActiveTab] = useState("pending")

  const filtered = data.filter((r) => {
    const matchSearch = r.name.includes(search) || r.phone.includes(search)
    const matchBranch = branchFilter === "all" || r.branch === branchFilter
    const matchTab = activeTab === "all" || r.status === activeTab
    return matchSearch && matchBranch && matchTab
  })

  const counts = {
    pending: data.filter((r) => r.status === "pending").length,
    approved: data.filter((r) => r.status === "approved").length,
    rejected: data.filter((r) => r.status === "rejected").length,
  }

  function approve(id: number) {
    setData((d) => d.map((r) => (r.id === id ? { ...r, status: "approved" } : r)))
    toast.success("تم قبول الطلب بنجاح")
    setSelected(null)
  }

  function reject(id: number) {
    setData((d) => d.map((r) => (r.id === id ? { ...r, status: "rejected" } : r)))
    toast.error("تم رفض الطلب")
    setSelected(null)
  }

  return (
    <div dir="rtl">
      <PageHeader
        title="طلبات التسجيل"
        description="مراجعة وإدارة طلبات التسجيل الواردة"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="pending">
              معلقة
              <Badge className="ms-1.5 h-4 px-1 text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-0">
                {counts.pending}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="approved">مقبولة ({counts.approved})</TabsTrigger>
            <TabsTrigger value="rejected">مرفوضة ({counts.rejected})</TabsTrigger>
            <TabsTrigger value="all">الكل</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute right-2.5 top-2 size-4 text-muted-foreground" />
              <Input
                placeholder="بحث..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-3 pe-9 h-8 w-48 text-sm"
              />
            </div>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="h-8 w-44 text-sm">
                <Filter className="size-3.5 me-1.5 text-muted-foreground" />
                <SelectValue placeholder="كل الفروع" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">كل الفروع</SelectItem>
                <SelectItem value="فرع الحي المحمدي">فرع الحي المحمدي</SelectItem>
                <SelectItem value="فرع القدس">فرع القدس</SelectItem>
                <SelectItem value="فرع السلام">فرع السلام</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value={activeTab} className="mt-0">
          <Card className="shadow-none">
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <CheckCircle className="size-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-foreground">لا توجد طلبات</p>
                  <p className="text-xs text-muted-foreground mt-1">لا توجد نتائج للمعايير المختارة</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map((reg) => (
                    <div key={reg.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                      <Avatar className="size-9 shrink-0">
                        <AvatarFallback className="text-sm bg-primary/10 text-primary">{reg.name[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">{reg.name}</p>
                          <Badge className={`text-[10px] h-4 px-1.5 border-0 ${roleColors[reg.role]}`}>
                            {roleLabels[reg.role]}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{reg.branch} · {reg.phone} · {reg.submittedAt}</p>
                      </div>
                      <Badge className={`text-[10px] h-5 px-2 border-0 shrink-0 ${statusColors[reg.status]}`}>
                        {statusLabels[reg.status]}
                      </Badge>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => setSelected(reg)}>
                          <Eye className="size-3.5 text-muted-foreground" />
                        </Button>
                        {reg.status === "pending" && (
                          <>
                            <Button size="icon" className="size-7 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground" onClick={() => approve(reg.id)}>
                              <Check className="size-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7 text-destructive hover:bg-destructive/10" onClick={() => reject(reg.id)}>
                              <X className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تفاصيل الطلب</DialogTitle>
            <DialogDescription>مراجعة معلومات المتقدمة واتخاذ القرار</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-12">
                  <AvatarFallback className="text-lg bg-primary/10 text-primary">{selected.name[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-foreground">{selected.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge className={`text-[10px] h-4 px-1.5 border-0 ${roleColors[selected.role]}`}>
                      {roleLabels[selected.role]}
                    </Badge>
                    <Badge className={`text-[10px] h-4 px-1.5 border-0 ${statusColors[selected.status]}`}>
                      {statusLabels[selected.status]}
                    </Badge>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Detail label="الفرع" value={selected.branch} />
                <Detail label="الهاتف" value={selected.phone} />
                <Detail label="البريد الإلكتروني" value={selected.email} />
                <Detail label="تاريخ التقديم" value={selected.submittedAt} />
                {selected.age && <Detail label="العمر" value={`${selected.age} سنة`} />}
                {selected.nationalId && <Detail label="رقم البطاقة" value={selected.nationalId} />}
              </div>
              {selected.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">ملاحظات</p>
                    <p className="text-sm text-foreground">{selected.notes}</p>
                  </div>
                </>
              )}
            </div>
          )}
          {selected?.status === "pending" && (
            <DialogFooter className="gap-2">
              <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1.5" onClick={() => reject(selected.id)}>
                <X className="size-4" /> رفض
              </Button>
              <Button className="gap-1.5" onClick={() => approve(selected.id)}>
                <Check className="size-4" /> قبول
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground mt-0.5">{value}</p>
    </div>
  )
}
