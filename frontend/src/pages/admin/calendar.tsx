import { useState } from "react"
import { toast } from "sonner"
import { ChevronRight, ChevronLeft, Plus, Clock, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import PageHeader from "@/components/page-header"
import { getCalendarEvents, getAvailableBranches, type CalendarEvent } from "@/services/calendar-adapter"

const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]

const events: CalendarEvent[] = getCalendarEvents()
const availableBranches = getAvailableBranches()

const typeColors = {
  exam: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  meeting: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  ceremony: "bg-primary/10 text-primary",
  holiday: "bg-muted text-muted-foreground",
}
const typeLabels = { exam: "اختبار", meeting: "اجتماع", ceremony: "حفل", holiday: "عطلة" }

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [addOpen, setAddOpen] = useState(false)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)
  const today = now.getDate()
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  function eventsForDay(day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    return events.filter((e) => e.date === dateStr)
  }

  const selectedDayEvents = selectedDay ? eventsForDay(selectedDay) : []
  const upcomingEvents = events.filter((e) => new Date(e.date) >= now).slice(0, 5)

  return (
    <div dir="rtl">
      <PageHeader
        title="التقويم"
        description="جدولة الأحداث والاختبارات والاجتماعات"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 me-2" />إضافة حدث
          </Button>
        }
      />

      <div className="grid lg:grid-cols-4 gap-5">
        {/* Calendar */}
        <div className="lg:col-span-3">
          <Card className="shadow-none">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" className="size-8" onClick={prevMonth}>
                  <ChevronRight className="size-4" />
                </Button>
                <CardTitle className="text-base font-semibold">
                  {MONTHS_AR[month]} {year}
                </CardTitle>
                <Button variant="ghost" size="icon" className="size-8" onClick={nextMonth}>
                  <ChevronLeft className="size-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAYS_AR.map((d) => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">
                    {d.slice(0, 3)}
                  </div>
                ))}
              </div>
              {/* Day cells */}
              <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`} className="bg-background min-h-[72px] p-1" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1
                  const dayEvents = eventsForDay(day)
                  const isToday = isCurrentMonth && day === today
                  const isSelected = selectedDay === day
                  return (
                    <div
                      key={day}
                      className={`bg-background min-h-[72px] p-1.5 cursor-pointer hover:bg-muted/40 transition-colors ${isSelected ? "ring-1 ring-inset ring-primary" : ""}`}
                      onClick={() => setSelectedDay(isSelected ? null : day)}
                    >
                      <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>
                        {day}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {dayEvents.slice(0, 2).map((ev) => (
                          <div key={ev.id} className={`text-[9px] leading-tight rounded px-1 py-0.5 truncate font-medium ${typeColors[ev.type]}`}>
                            {ev.title}
                          </div>
                        ))}
                        {dayEvents.length > 2 && (
                          <div className="text-[9px] text-muted-foreground">+{dayEvents.length - 2} أخرى</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Selected day events */}
          {selectedDay && (
            <Card className="shadow-none mt-4">
              <CardContent className="p-4">
                <p className="text-sm font-semibold text-foreground mb-3">
                  أحداث {selectedDay} {MONTHS_AR[month]}
                </p>
                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد أحداث في هذا اليوم</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {selectedDayEvents.map((ev) => (
                      <EventRow key={ev.id} event={ev} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Upcoming sidebar */}
        <div>
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">الأحداث القادمة</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pb-4">
              {upcomingEvents.map((ev) => (
                <EventRow key={ev.id} event={ev} compact />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add event dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة حدث جديد</DialogTitle>
            <DialogDescription>أدخل تفاصيل الحدث</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">عنوان الحدث</label>
              <Input placeholder="مثال: اختبار الحفظ" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">التاريخ</label>
                <Input type="date" className="h-9" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">الوقت</label>
                <Input type="time" className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">النوع</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="النوع" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="exam">اختبار</SelectItem>
                    <SelectItem value="meeting">اجتماع</SelectItem>
                    <SelectItem value="ceremony">حفل</SelectItem>
                    <SelectItem value="holiday">عطلة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">الفرع</label>
                <Select>
                  <SelectTrigger className="h-9"><SelectValue placeholder="الفرع" /></SelectTrigger>
                  <SelectContent dir="rtl">
                    {availableBranches.map((branch) => (
                      <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={() => { toast.success("تمت إضافة الحدث"); setAddOpen(false) }}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EventRow({ event, compact }: { event: CalendarEvent; compact?: boolean }) {
  return (
    <div className={`flex items-start gap-2.5 ${compact ? "" : "rounded-lg border border-border px-3 py-2.5"}`}>
      <div className={`size-2 rounded-full mt-1.5 shrink-0 ${event.type === "exam" ? "bg-orange-500" : event.type === "meeting" ? "bg-blue-500" : event.type === "ceremony" ? "bg-primary" : "bg-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{event.title}</p>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1"><Clock className="size-3" />{event.time}</span>
          {!compact && <span className="flex items-center gap-1"><MapPin className="size-3" />{event.location}</span>}
        </div>
        {compact && (
          <p className="text-xs text-muted-foreground mt-0.5">{new Date(event.date).toLocaleDateString("ar-MA")}</p>
        )}
      </div>
      <Badge className={`text-[10px] h-4 px-1.5 border-0 shrink-0 ${(typeColors as Record<string, string>)[event.type]}`}>
        {(typeLabels as Record<string, string>)[event.type]}
      </Badge>
    </div>
  )
}
