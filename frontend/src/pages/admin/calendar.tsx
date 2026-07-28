import { useState } from "react"
import { toast } from "sonner"
import { ChevronRight, ChevronLeft, Plus, Clock, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCalendarEvents, getAvailableBranches, type CalendarEvent } from "@/services/calendar-adapter"

const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
const HIJRI_MONTHS = ["محرم", "صفر", "ربيع الأول", "ربيع الثاني", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"]

const events: CalendarEvent[] = getCalendarEvents()
const availableBranches = getAvailableBranches()

const typeColors = {
  exam: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  meeting: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  ceremony: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  holiday: "bg-muted text-muted-foreground",
}
const typeLabels = { exam: "اختبار", meeting: "اجتماع", ceremony: "حفل", holiday: "عطلة" }

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function getGregorianToHijri(date: Date) {
  const jd = Math.floor((11 * date.getFullYear() + 3) / 25) + 365 * date.getFullYear() + Math.floor(date.getMonth() / 2) + date.getDate() - 2
  const l = jd + 1948439
  const n = Math.floor((4 * l + 274277) / 146097)
  const g = l + 1 - Math.floor(146097 * n / 4)
  const i = Math.floor((4 * g + 3) / 1461)
  const gg = g - Math.floor(1461 * i / 4)
  const k = Math.floor((5 * gg + 2) / 153)
  const hijriDay = gg - Math.floor((153 * k + 2) / 5)
  const hijriMonth = k + (Math.floor(3 / 11) === 0 ? 1 : 13)
  const hijriYear = 100 * n + i - 100 * Math.floor(3 / 11) - 4 + (Math.floor(1 / 1) === 0 ? 1 : 0)
  return { day: hijriDay, month: hijriMonth - 1, year: hijriYear }
}

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate())
  const [selectedBranch, setSelectedBranch] = useState(availableBranches[0] || "جميع الفروع")
  const [addOpen, setAddOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"monthly" | "weekly" | "agenda">("monthly")

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

  function goToToday() {
    setYear(now.getFullYear())
    setMonth(now.getMonth())
    setSelectedDay(today)
  }

  function eventsForDay(day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    return events.filter((e) => e.date === dateStr)
  }

  const selectedDayEvents = selectedDay ? eventsForDay(selectedDay) : []
  const hijri = getGregorianToHijri(new Date(year, month, 1))

  return (
    <div dir="rtl" className="space-y-6 p-6">
      {/* Title and Branch Selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">جدول مقر {selectedBranch}</h1>
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              {availableBranches.map((branch) => (
                <SelectItem key={branch} value={branch}>
                  {branch}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Calendar Container */}
      <div className="grid lg:grid-cols-4 gap-6">
        {/* Calendar Section */}
        <div className="lg:col-span-3 space-y-6">
          {/* Toolbar */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-4">
                {/* Day Navigation */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={goToToday}>
                      اليوم
                    </Button>
                    <Button variant="ghost" size="icon" onClick={prevMonth}>
                      <ChevronRight className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={nextMonth}>
                      <ChevronLeft className="size-4" />
                    </Button>
                  </div>
                  <span className="text-sm font-medium">
                    {MONTHS_AR[month]} {year} | {HIJRI_MONTHS[hijri.month]} {hijri.year}
                  </span>
                </div>

                {/* View Mode Toggle */}
                <div className="flex gap-2">
                  <Button
                    variant={viewMode === "monthly" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("monthly")}
                  >
                    شهري
                  </Button>
                  <Button
                    variant={viewMode === "weekly" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("weekly")}
                  >
                    أسبوعي
                  </Button>
                  <Button
                    variant={viewMode === "agenda" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("agenda")}
                  >
                    أجندة
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Calendar Grid */}
          {viewMode === "monthly" && (
            <Card>
              <CardContent className="p-4">
                {/* Day Headers */}
                <div className="grid grid-cols-7 gap-0 mb-2">
                  {DAYS_AR.map((day) => (
                    <div key={day} className="h-10 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Cells */}
                <div className="grid grid-cols-7 gap-px bg-border rounded overflow-hidden">
                  {/* Empty cells for days before month starts */}
                  {Array.from({ length: firstDay }).map((_, i) => (
                    <div key={`empty-${i}`} className="bg-muted/30 min-h-24" />
                  ))}

                  {/* Day cells */}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1
                    const dayEvents = eventsForDay(day)
                    const isToday = isCurrentMonth && day === today
                    const isSelected = selectedDay === day

                    return (
                      <div
                        key={day}
                        onClick={() => setSelectedDay(day)}
                        className={`min-h-24 p-2 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-primary/10 border-2 border-primary"
                            : isToday
                              ? "bg-background border-2 border-orange-400"
                              : "bg-background hover:bg-muted/50 border border-border"
                        }`}
                      >
                        <div
                          className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold mb-1 ${
                            isToday
                              ? "bg-orange-400 text-white"
                              : isSelected
                                ? "bg-primary text-primary-foreground"
                                : "text-foreground"
                          }`}
                        >
                          {day}
                        </div>
                        <div className="space-y-0.5">
                          {dayEvents.slice(0, 2).map((event) => (
                            <div
                              key={event.id}
                              className={`text-[10px] px-1 py-0.5 rounded truncate font-medium ${typeColors[event.type]}`}
                            >
                              {event.title}
                            </div>
                          ))}
                          {dayEvents.length > 2 && (
                            <div className="text-[10px] text-muted-foreground px-1">
                              +{dayEvents.length - 2}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Selected Day Events */}
          {selectedDay && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  أحداث {selectedDay} {MONTHS_AR[month]}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد أحداث في هذا اليوم</p>
                ) : (
                  selectedDayEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: Upcoming Events */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                الأحداث القادمة
                <Button size="icon" variant="ghost" className="size-8" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {events
                .filter((e) => new Date(e.date) >= now)
                .slice(0, 10)
                .map((event) => (
                  <EventCard key={event.id} event={event} compact />
                ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Event Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة حدث جديد</DialogTitle>
            <DialogDescription>أدخل تفاصيل الحدث</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">عنوان الحدث</label>
              <Input placeholder="مثال: اختبار الحفظ" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium block mb-1.5">التاريخ</label>
                <Input type="date" className="h-9" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">الوقت</label>
                <Input type="time" className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium block mb-1.5">النوع</label>
                <Select>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="النوع" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="exam">اختبار</SelectItem>
                    <SelectItem value="meeting">اجتماع</SelectItem>
                    <SelectItem value="ceremony">حفل</SelectItem>
                    <SelectItem value="holiday">عطلة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">الفرع</label>
                <Select>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="الفرع" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {availableBranches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={() => {
                toast.success("تمت إضافة الحدث")
                setAddOpen(false)
              }}
            >
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EventCard({ event, compact }: { event: CalendarEvent; compact?: boolean }) {
  return (
    <div className={`flex items-start gap-2.5 p-2.5 rounded-lg border border-border ${compact ? "text-sm" : ""}`}>
      <div
        className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
          event.type === "exam"
            ? "bg-orange-500"
            : event.type === "meeting"
              ? "bg-blue-500"
              : event.type === "ceremony"
                ? "bg-purple-500"
                : "bg-muted-foreground"
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className={`font-medium truncate ${compact ? "text-xs" : "text-sm"}`}>{event.title}</p>
        <div className={`flex items-center gap-1.5 mt-0.5 text-muted-foreground ${compact ? "text-[10px]" : "text-xs"}`}>
          <Clock className="w-3 h-3" />
          <span>{event.time}</span>
        </div>
        {!compact && (
          <div className={`flex items-center gap-1.5 mt-0.5 text-muted-foreground text-xs`}>
            <MapPin className="w-3 h-3" />
            <span>{event.location}</span>
          </div>
        )}
      </div>
      <Badge className={`text-[10px] h-5 px-2 flex-shrink-0 ${(typeColors as Record<string, string>)[event.type]}`}>
        {(typeLabels as Record<string, string>)[event.type]}
      </Badge>
    </div>
  )
}
