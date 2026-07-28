import { useState } from "react"
import { toast } from "sonner"
import { Upload, Search, FileText, Video, Headphones, Image, MoreHorizontal, Download, Trash2, Eye, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import PageHeader from "@/components/page-header"

type FileType = "pdf" | "video" | "audio" | "image"
type Access = "all" | "teacher" | "student"

interface ContentItem {
  id: number
  title: string
  description: string
  type: FileType
  size: string
  uploader: string
  uploadedAt: string
  access: Access
  program: string
  downloads: number
}

const content: ContentItem[] = [
  { id: 1, title: "سورة البقرة - تفسير مبسط", description: "شرح مفصل لمعاني سورة البقرة", type: "pdf", size: "2.4 MB", uploader: "زينب الشريف", uploadedAt: "2026-07-20", access: "all", program: "دراسات إسلامية", downloads: 48 },
  { id: 2, title: "تلاوة الجزء الأول", description: "تلاوة بصوت الشيخ محمود خليل الحصري", type: "audio", size: "18 MB", uploader: "حفصة القادري", uploadedAt: "2026-07-18", access: "all", program: "حفظ القرآن", downloads: 120 },
  { id: 3, title: "درس التجويد - الإدغام", description: "شرح مصور لأحكام الإدغام", type: "video", size: "145 MB", uploader: "ليلى بن يوسف", uploadedAt: "2026-07-15", access: "student", program: "حفظ القرآن", downloads: 67 },
  { id: 4, title: "مناهج محو الأمية - الفصل الأول", description: "المنهج الكامل للمستوى الأول", type: "pdf", size: "5.1 MB", uploader: "حفصة القادري", uploadedAt: "2026-07-10", access: "teacher", program: "محو الأمية", downloads: 21 },
  { id: 5, title: "أسماء الله الحسنى - صور تعليمية", description: "بطاقات بصرية للأسماء الحسنى", type: "image", size: "8.3 MB", uploader: "سناء الحبيبي", uploadedAt: "2026-07-08", access: "all", program: "دراسات إسلامية", downloads: 95 },
]

const typeIcons: Record<FileType, React.ElementType> = { pdf: FileText, video: Video, audio: Headphones, image: Image }
const typeColors: Record<FileType, string> = {
  pdf: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  video: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  audio: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  image: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
}
const typeLabels: Record<FileType, string> = { pdf: "PDF", video: "فيديو", audio: "صوت", image: "صورة" }
const accessLabels: Record<Access, string> = { all: "للجميع", teacher: "للمعلمات", student: "للطالبات" }

export default function ContentPage() {
  const [search, setSearch] = useState("")
  const [programFilter, setProgramFilter] = useState("all")
  const [uploadOpen, setUploadOpen] = useState(false)

  const filtered = content.filter((c) => {
    const matchSearch = c.title.includes(search) || c.description.includes(search)
    const matchProgram = programFilter === "all" || c.program === programFilter
    return matchSearch && matchProgram
  })

  return (
    <div dir="rtl">
      <PageHeader
        title="المكتبة التعليمية"
        description={`${content.length} ملفًا متاحًا`}
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="size-4 me-2" />رفع محتوى
          </Button>
        }
      />

      <Tabs defaultValue="grid" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute right-2.5 top-2 size-4 text-muted-foreground" />
              <Input placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} className="pe-9 h-8 w-52 text-sm" />
            </div>
            <Select value={programFilter} onValueChange={setProgramFilter}>
              <SelectTrigger className="h-8 w-44 text-sm">
                <Filter className="size-3.5 me-1.5 text-muted-foreground" />
                <SelectValue placeholder="كل البرامج" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">كل البرامج</SelectItem>
                <SelectItem value="حفظ القرآن">حفظ القرآن</SelectItem>
                <SelectItem value="دراسات إسلامية">دراسات إسلامية</SelectItem>
                <SelectItem value="محو الأمية">محو الأمية</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TabsList className="h-8">
            <TabsTrigger value="grid" className="text-xs px-3 h-6">شبكة</TabsTrigger>
            <TabsTrigger value="list" className="text-xs px-3 h-6">قائمة</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="grid" className="mt-0">
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((item) => {
              const Icon = typeIcons[item.type]
              return (
                <Card key={item.id} className="shadow-none hover:border-primary/30 transition-colors group">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`flex items-center justify-center size-10 rounded-xl shrink-0 ${typeColors[item.type]}`}>
                        <Icon className="size-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" className="size-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="size-3.5 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" dir="rtl">
                          <DropdownMenuItem className="gap-2"><Eye className="size-4" />معاينة</DropdownMenuItem>
                          <DropdownMenuItem className="gap-2"><Download className="size-4" />تحميل</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={() => toast.error("تم حذف الملف")}>
                            <Trash2 className="size-4" />حذف
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge className={`text-[10px] h-4 px-1.5 border-0 ${typeColors[item.type]}`}>{typeLabels[item.type]}</Badge>
                        <span>{item.size}</span>
                        <span>·</span>
                        <span>{item.downloads} تحميل</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 border-0">{accessLabels[item.access]}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">{item.uploader} · {item.uploadedAt}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="list" className="mt-0">
          <Card className="shadow-none">
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {filtered.map((item) => {
                  const Icon = typeIcons[item.type]
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                      <div className={`flex items-center justify-center size-8 rounded-lg shrink-0 ${typeColors[item.type]}`}>
                        <Icon className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.uploader} · {item.size} · {item.downloads} تحميل</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 hidden sm:flex border-0">{accessLabels[item.access]}</Badge>
                      <span className="text-xs text-muted-foreground hidden md:block">{item.uploadedAt}</span>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => toast.success("جاري التحميل...")}>
                        <Download className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>رفع محتوى تعليمي</DialogTitle>
            <DialogDescription>ارفع ملفًا جديدًا إلى المكتبة</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
              <Upload className="size-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium text-foreground">اسحب الملف هنا أو انقر للاختيار</p>
              <p className="text-xs text-muted-foreground mt-1">PDF، فيديو، صوت، صور</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">العنوان</label>
              <Input placeholder="عنوان الملف" className="h-9" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">الوصف</label>
              <Textarea placeholder="وصف مختصر..." className="resize-none h-16 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">البرنامج</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="quran">حفظ القرآن</SelectItem>
                    <SelectItem value="islamic">دراسات إسلامية</SelectItem>
                    <SelectItem value="literacy">محو الأمية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">الوصول</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="all">للجميع</SelectItem>
                    <SelectItem value="teacher">للمعلمات فقط</SelectItem>
                    <SelectItem value="student">للطالبات فقط</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>إلغاء</Button>
            <Button onClick={() => { toast.success("تم رفع الملف بنجاح"); setUploadOpen(false) }}>رفع</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
