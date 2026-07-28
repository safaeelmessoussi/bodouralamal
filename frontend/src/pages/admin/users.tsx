import { useState } from "react"
import { toast } from "sonner"
import { Search, UserPlus, MoreHorizontal, Edit2, Trash2, ShieldCheck, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import PageHeader from "@/components/page-header"

type Role = "admin" | "branch_manager" | "teacher" | "parent" | "student"
type Status = "active" | "inactive" | "suspended"

interface User {
  id: number
  name: string
  email: string
  phone: string
  role: Role
  branch: string
  status: Status
  joinedAt: string
}

const users: User[] = [
  { id: 1, name: "حفصة القادري", email: "hafsa@bodour.ma", phone: "0661000001", role: "admin", branch: "المقر الرئيسي", status: "active", joinedAt: "يناير 2025" },
  { id: 2, name: "رجاء المنصوري", email: "rajaa@bodour.ma", phone: "0661000002", role: "branch_manager", branch: "فرع الحي المحمدي", status: "active", joinedAt: "مارس 2025" },
  { id: 3, name: "زينب الشريف", email: "zainab@bodour.ma", phone: "0661000003", role: "teacher", branch: "فرع القدس", status: "active", joinedAt: "سبتمبر 2024" },
  { id: 4, name: "ليلى بن يوسف", email: "layla@bodour.ma", phone: "0661000004", role: "teacher", branch: "فرع السلام", status: "active", joinedAt: "أكتوبر 2024" },
  { id: 5, name: "نادية الغازي", email: "nadia@bodour.ma", phone: "0661000005", role: "parent", branch: "فرع الحي المحمدي", status: "active", joinedAt: "يناير 2026" },
  { id: 6, name: "كريمة بوشنتوف", email: "karima@bodour.ma", phone: "0661000006", role: "student", branch: "فرع القدس", status: "active", joinedAt: "سبتمبر 2025" },
  { id: 7, name: "سناء الحبيبي", email: "sanaa@bodour.ma", phone: "0661000007", role: "teacher", branch: "فرع الحي المحمدي", status: "inactive", joinedAt: "أبريل 2024" },
  { id: 8, name: "إيمان الدرقاوي", email: "iman@bodour.ma", phone: "0661000008", role: "student", branch: "فرع السلام", status: "active", joinedAt: "سبتمبر 2025" },
]

const roleLabels: Record<Role, string> = {
  admin: "مدير النظام", branch_manager: "مدير الفرع", teacher: "معلمة", parent: "أم / ولية", student: "طالبة",
}
const roleColors: Record<Role, string> = {
  admin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  branch_manager: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  teacher: "bg-primary/10 text-primary",
  parent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  student: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
}
const statusColors: Record<Status, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  inactive: "bg-muted text-muted-foreground",
  suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}
const statusLabels: Record<Status, string> = { active: "نشط", inactive: "غير نشط", suspended: "موقوف" }

export default function UsersPage() {
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)

  const filtered = users.filter((u) => {
    const matchSearch = u.name.includes(search) || u.email.includes(search)
    const matchRole = roleFilter === "all" || u.role === roleFilter
    return matchSearch && matchRole
  })

  return (
    <div dir="rtl">
      <PageHeader
        title="إدارة المستخدمين"
        description={`${users.length} مستخدم مسجل في المنصة`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4 me-2" />
            إضافة مستخدم
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute right-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            placeholder="بحث بالاسم أو الإيميل..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pe-9 h-8 text-sm"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-8 w-44 text-sm">
            <Filter className="size-3.5 me-1.5 text-muted-foreground" />
            <SelectValue placeholder="كل الأدوار" />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الأدوار</SelectItem>
            {(Object.keys(roleLabels) as Role[]).map((r) => (
              <SelectItem key={r} value={r}>{roleLabels[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="shadow-none">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-right px-5 py-3 font-medium text-muted-foreground">المستخدمة</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">الدور</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">الفرع</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">الانضمام</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">الحالة</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8 shrink-0">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">{u.name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{u.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <Badge className={`text-[10px] h-5 px-1.5 border-0 ${roleColors[u.role]}`}>
                        {roleLabels[u.role]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{u.branch}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{u.joinedAt}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] h-5 px-1.5 border-0 ${statusColors[u.status]}`}>
                        {statusLabels[u.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7">
                            <MoreHorizontal className="size-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" dir="rtl">
                          <DropdownMenuItem className="gap-2"><Edit2 className="size-4" />تعديل</DropdownMenuItem>
                          <DropdownMenuItem className="gap-2"><ShieldCheck className="size-4" />تغيير الدور</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={() => setDeleteTarget(u)}>
                            <Trash2 className="size-4" />حذف
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add user dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة مستخدم جديد</DialogTitle>
            <DialogDescription>أدخل بيانات المستخدم الجديد</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">الاسم الكامل</label>
                <Input placeholder="الاسم الكامل" className="h-9" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">رقم الهاتف</label>
                <Input placeholder="0600000000" className="h-9" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">البريد الإلكتروني</label>
              <Input type="email" placeholder="email@example.com" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">الدور</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر الدور" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    {(Object.keys(roleLabels) as Role[]).map((r) => (
                      <SelectItem key={r} value={r}>{roleLabels[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">الفرع</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="فرع الحي المحمدي">فرع الحي المحمدي</SelectItem>
                    <SelectItem value="فرع القدس">فرع القدس</SelectItem>
                    <SelectItem value="فرع السلام">فرع السلام</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={() => { toast.success("تمت إضافة المستخدم"); setAddOpen(false) }}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد الحذف</DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف <strong>{deleteTarget?.name}</strong>؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={() => { toast.error("تم حذف المستخدم"); setDeleteTarget(null) }}>حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
