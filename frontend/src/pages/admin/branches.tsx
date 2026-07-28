import { useState } from "react"
import { toast } from "sonner"
import { Building2, Plus, Users, MapPin, DoorOpen, MoreHorizontal, Edit2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import PageHeader from "@/components/page-header"

interface Room {
  id: number
  name: string
  capacity: number
  current: number
  type: string
}

interface Branch {
  id: number
  name: string
  address: string
  manager: string
  phone: string
  students: number
  teachers: number
  maxCapacity: number
  status: "active" | "inactive"
  rooms: Room[]
}

const branches: Branch[] = [
  {
    id: 1, name: "فرع الحي المحمدي", address: "شارع محمد الخامس، الحي المحمدي، الدار البيضاء", manager: "رجاء المنصوري", phone: "0522111111", students: 142, teachers: 8, maxCapacity: 200, status: "active",
    rooms: [
      { id: 1, name: "قاعة 1", capacity: 25, current: 22, type: "حفظ القرآن" },
      { id: 2, name: "قاعة 2", capacity: 20, current: 18, type: "دراسات إسلامية" },
      { id: 3, name: "قاعة 3", capacity: 30, current: 15, type: "محو الأمية" },
      { id: 4, name: "قاعة 4", capacity: 25, current: 25, type: "حفظ القرآن" },
    ],
  },
  {
    id: 2, name: "فرع القدس", address: "حي القدس، عين الشق، الدار البيضاء", manager: "سمية الرحالي", phone: "0522222222", students: 98, teachers: 6, maxCapacity: 150, status: "active",
    rooms: [
      { id: 5, name: "قاعة 1", capacity: 20, current: 18, type: "حفظ القرآن" },
      { id: 6, name: "قاعة 2", capacity: 25, current: 20, type: "دراسات إسلامية" },
      { id: 7, name: "قاعة 3", capacity: 20, current: 14, type: "محو الأمية" },
    ],
  },
  {
    id: 3, name: "فرع السلام", address: "حي السلام، سيدي معروف، الدار البيضاء", manager: "منى الحجاوي", phone: "0522333333", students: 115, teachers: 7, maxCapacity: 180, status: "active",
    rooms: [
      { id: 8, name: "قاعة 1", capacity: 25, current: 23, type: "حفظ القرآن" },
      { id: 9, name: "قاعة 2", capacity: 30, current: 22, type: "دراسات إسلامية" },
      { id: 10, name: "قاعة 3", capacity: 20, current: 10, type: "محو الأمية" },
    ],
  },
]

export default function BranchesPage() {
  const [selected, setSelected] = useState<Branch>(branches[0])
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div dir="rtl">
      <PageHeader
        title="الفروع والقاعات"
        description={`${branches.length} فروع نشطة`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 me-2" />
            إضافة فرع
          </Button>
        }
      />

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Branch list */}
        <div className="flex flex-col gap-3">
          {branches.map((branch) => {
            const fill = Math.round((branch.students / branch.maxCapacity) * 100)
            return (
              <Card
                key={branch.id}
                className={`shadow-none cursor-pointer transition-colors ${selected.id === branch.id ? "border-primary/50 bg-primary/5" : "hover:border-border/80"}`}
                onClick={() => setSelected(branch)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center justify-center size-9 rounded-lg bg-primary/10 shrink-0">
                        <Building2 className="size-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{branch.name}</p>
                        <p className="text-xs text-muted-foreground">{branch.manager}</p>
                      </div>
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
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="size-3" />{branch.students} طالبة</span>
                    <span>{fill}% ممتلئ</span>
                  </div>
                  <Progress value={fill} className="mt-1.5 h-1.5" />
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Branch detail */}
        <div className="lg:col-span-2">
          <Card className="shadow-none h-full">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                  <CardDescription className="flex items-center gap-1 mt-1">
                    <MapPin className="size-3" />{selected.address}
                  </CardDescription>
                </div>
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">نشط</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {/* Info grid */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "الطالبات", value: selected.students, icon: Users },
                  { label: "المعلمات", value: selected.teachers, icon: Users },
                  { label: "القاعات", value: selected.rooms.length, icon: DoorOpen },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col items-center justify-center rounded-xl border border-border p-4 gap-1">
                    <item.icon className="size-5 text-primary mb-1" />
                    <p className="text-xl font-semibold tabular-nums text-foreground">{item.value}</p>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                  </div>
                ))}
              </div>

              <Separator />

              {/* Rooms */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-foreground">القاعات</p>
                  <Button variant="outline" size="sm" onClick={() => toast.info("إضافة قاعة")}>
                    <Plus className="size-3.5 me-1" />إضافة قاعة
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  {selected.rooms.map((room) => {
                    const fill = Math.round((room.current / room.capacity) * 100)
                    return (
                      <div key={room.id} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                        <div className="flex items-center justify-center size-7 rounded-md bg-muted shrink-0">
                          <DoorOpen className="size-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-foreground">{room.name}</span>
                            <span className="text-xs text-muted-foreground">{room.current}/{room.capacity}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Progress value={fill} className="h-1 flex-1" />
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">{room.type}</Badge>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add branch dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة فرع جديد</DialogTitle>
            <DialogDescription>أدخل معلومات الفرع الجديد</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">اسم الفرع</label>
              <Input placeholder="مثال: فرع المحمدية" className="h-9" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">العنوان</label>
              <Input placeholder="العنوان الكامل" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">مدير الفرع</label>
                <Input placeholder="الاسم الكامل" className="h-9" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">رقم الهاتف</label>
                <Input placeholder="0522000000" className="h-9" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">الطاقة الاستيعابية القصوى</label>
              <Input type="number" placeholder="200" className="h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={() => { toast.success("تمت إضافة الفرع"); setAddOpen(false) }}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
