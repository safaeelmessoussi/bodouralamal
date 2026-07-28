import { useState } from "react"
import { toast } from "sonner"
import { Plus, Search, Users, Clock, BookOpen, MoreHorizontal, Edit2, Trash2, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import PageHeader from "@/components/page-header"

interface Group {
  id: number
  name: string
  branch: string
  teacher: string
  type: string
  level: string
  students: number
  capacity: number
  schedule: string
  status: "active" | "full" | "inactive"
}

const groups: Group[] = [
  { id: 1, name: "مجموعة الفجر", branch: "فرع الحي المحمدي", teacher: "زينب الشريف", type: "حفظ القرآن", level: "مبتدئ", students: 18, capacity: 20, schedule: "السبت والثلاثاء 9:00–11:00", status: "active" },
  { id: 2, name: "مجموعة النور", branch: "فرع الحي المحمدي", teacher: "ليلى بن يوسف", type: "دراسات إسلامية", level: "متوسط", students: 20, capacity: 20, schedule: "الإثنين والأربعاء 2:00–4:00", status: "full" },
  { id: 3, name: "مجموعة الأمل", branch: "فرع القدس", teacher: "سناء الحبيبي", type: "محو الأمية", level: "مبتدئ", students: 12, capacity: 15, schedule: "الثلاثاء والخميس 10:00–12:00", status: "active" },
  { id: 4, name: "مجموعة الرحمة", branch: "فرع السلام", teacher: "نادية الغازي", type: "حفظ القرآن", level: "متقدم", students: 15, capacity: 18, schedule: "الاثنين والخميس 8:00–10:00", status: "active" },
  { id: 5, name: "مجموعة الهدى", branch: "فرع القدس", teacher: "إيمان الدرقاوي", type: "دراسات إسلامية", level: "مبتدئ", students: 14, capacity: 20, schedule: "الأحد والأربعاء 3:00–5:00", status: "active" },
  { id: 6, name: "مجموعة البركة", branch: "فرع السلام", teacher: "زينب الشريف", type: "محو الأمية", level: "متوسط", students: 8, capacity: 15, schedule: "الجمعة 9:00–12:00", status: "inactive" },
]

const typeColors: Record<string, string> = {
  "حفظ القرآن": "bg-primary/10 text-primary",
  "دراسات إسلامية": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "محو الأمية": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
}
const statusColors = { active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", full: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400", inactive: "bg-muted text-muted-foreground" }
const statusLabels = { active: "نشطة", full: "ممتلئة", inactive: "متوقفة" }

export default function GroupsPage() {
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [branchFilter, setBranchFilter] = useState("all")
  const [addOpen, setAddOpen] = useState(false)

  const filtered = groups.filter((g) => {
    const matchSearch = g.name.includes(search) || g.teacher.includes(search)
    const matchType = typeFilter === "all" || g.type === typeFilter
    const matchBranch = branchFilter === "all" || g.branch === branchFilter
    return matchSearch && matchType && matchBranch
  })

  return (
    <div dir="rtl">
      <PageHeader
        title="المجموعات الدراسية"
        description={`${groups.length} مجموعة في 3 فروع`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 me-2" />إنشاء مجموعة
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute right-2.5 top-2 size-4 text-muted-foreground" />
          <Input placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} className="pe-9 h-8 text-sm" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-44 text-sm">
            <Filter className="size-3.5 me-1.5 text-muted-foreground" />
            <SelectValue placeholder="كل الأنواع" />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="حفظ القرآن">حفظ القرآن</SelectItem>
            <SelectItem value="دراسات إسلامية">دراسات إسلامية</SelectItem>
            <SelectItem value="محو الأمية">محو الأمية</SelectItem>
          </SelectContent>
        </Select>
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="h-8 w-44 text-sm">
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

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((group) => (
          <Card key={group.id} className="shadow-none hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{group.name}</p>
                    <Badge className={`text-[10px] h-4 px-1.5 border-0 ${statusColors[group.status]}`}>
                      {statusLabels[group.status]}
                    </Badge>
                  </div>
                  <Badge className={`mt-1 text-[10px] h-4 px-1.5 border-0 ${typeColors[group.type] ?? ""}`}>
                    {group.type}
                  </Badge>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7 shrink-0">
                      <MoreHorizontal className="size-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" dir="rtl">
                    <DropdownMenuItem className="gap-2"><Edit2 className="size-4" />تعديل</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive">
                      <Trash2 className="size-4" />حذف
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex flex-col gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Avatar className="size-5">
                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary">{group.teacher[0]}</AvatarFallback>
                  </Avatar>
                  <span>{group.teacher}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Users className="size-3.5 shrink-0" />
                  <span>{group.students}/{group.capacity} طالبة · {group.level}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="size-3.5 shrink-0" />
                  <span className="truncate">{group.schedule}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <BookOpen className="size-3.5 shrink-0" />
                  <span>{group.branch}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add group dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>إنشاء مجموعة جديدة</DialogTitle>
            <DialogDescription>أدخل معلومات المجموعة الدراسية</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">اسم المجموعة</label>
              <Input placeholder="مثال: مجموعة الفجر" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">نوع البرنامج</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر النوع" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="quran">حفظ القرآن</SelectItem>
                    <SelectItem value="islamic">دراسات إسلامية</SelectItem>
                    <SelectItem value="literacy">محو الأمية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">الفرع</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="branch1">فرع الحي المحمدي</SelectItem>
                    <SelectItem value="branch2">فرع القدس</SelectItem>
                    <SelectItem value="branch3">فرع السلام</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">الطاقة الاستيعابية</label>
                <Input type="number" placeholder="20" className="h-9" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">المستوى</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="المستوى" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="beginner">مبتدئ</SelectItem>
                    <SelectItem value="intermediate">متوسط</SelectItem>
                    <SelectItem value="advanced">متقدم</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={() => { toast.success("تمت إضافة المجموعة"); setAddOpen(false) }}>إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
