import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getCalendarEvents, getAvailableBranches } from "@/services/calendar-adapter"

const GREGORIAN_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليوز", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
]

const HIJRI_MONTHS = [
  "محرم", "صفر", "ربيع الأول", "ربيع الثاني", "جمادى الأولى", "جمادى الآخرة",
  "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"
]

const DAY_NAMES = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]

interface CalendarState {
  year: number
  month: number
}

export default function CalendarPage() {
  const [calendar, setCalendar] = useState<CalendarState>({
    year: 2026,
    month: 6 // July (0-indexed)
  })
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<"monthly" | "weekly" | "agenda">("monthly")
  const branches = getAvailableBranches()
  const events = getCalendarEvents()

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (year: number, month: number) => {
    const day = new Date(year, month, 1).getDay()
    // Convert from JS (0=Sunday) to our format (0=Monday)
    return day === 0 ? 6 : day - 1
  }

  const handlePreviousMonth = () => {
    setCalendar(prev => {
      if (prev.month === 0) {
        return { year: prev.year - 1, month: 11 }
      }
      return { ...prev, month: prev.month - 1 }
    })
    setSelectedDay(null)
  }

  const handleNextMonth = () => {
    setCalendar(prev => {
      if (prev.month === 11) {
        return { year: prev.year + 1, month: 0 }
      }
      return { ...prev, month: prev.month + 1 }
    })
    setSelectedDay(null)
  }

  const handleToday = () => {
    const today = new Date()
    setCalendar({
      year: today.getFullYear(),
      month: today.getMonth()
    })
    setSelectedDay(today.getDate())
  }

  const getHijriDate = (gregorianMonth: number) => {
    // Approximation for display purposes
    const hijriMonth = (gregorianMonth + 8) % 12
    return {
      month: HIJRI_MONTHS[hijriMonth],
      year: 1448
    }
  }

  const renderCalendarForBranch = (branch: string) => {
    const daysInMonth = getDaysInMonth(calendar.year, calendar.month)
    const firstDay = getFirstDayOfMonth(calendar.year, calendar.month)
    const days: (number | null)[] = []

    // Add empty cells for days before the first of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null)
    }

    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i)
    }

    // Add empty cells for days after the end of the month
    while (days.length % 7 !== 0) {
      days.push(null)
    }

    const hijriDate = getHijriDate(calendar.month)
    const branchEvents = events.filter(e => e.branch === branch || e.branch === "all")

    return (
      <div key={branch} className="mb-12" dir="rtl">
        {/* Branch Title */}
        <h2 className="text-2xl font-bold mb-6 text-foreground">جدول مقر {branch}</h2>

        {/* Controls Row */}
        <div className="flex items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              className="px-3 py-1 text-sm h-8"
            >
              اليوم
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNextMonth}
              className="p-1 h-8 w-8"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePreviousMonth}
              className="p-1 h-8 w-8"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium whitespace-nowrap">
              {GREGORIAN_MONTHS[calendar.month]} {calendar.year}|{hijriDate.month} / {hijriDate.year}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "monthly" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("monthly")}
              className="px-3 py-1 text-sm h-8"
            >
              شهري
            </Button>
            <Button
              variant={viewMode === "weekly" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("weekly")}
              className="px-3 py-1 text-sm h-8"
            >
              أسبوعي
            </Button>
            <Button
              variant={viewMode === "agenda" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("agenda")}
              className="px-3 py-1 text-sm h-8"
            >
              أجندة
            </Button>
          </div>
        </div>

        {/* Calendar Grid */}
        {viewMode === "monthly" && (
          <div className="border border-border rounded-lg overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 bg-muted border-b border-border">
              {DAY_NAMES.map(day => (
                <div
                  key={day}
                  className="p-3 text-center font-semibold text-sm border-e border-border last:border-e-0"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7">
              {days.map((day, idx) => {
                const isSelected = day === selectedDay
                const isToday = 
                  day === new Date().getDate() &&
                  calendar.month === new Date().getMonth() &&
                  calendar.year === new Date().getFullYear()
                
                const dayEvents = day ? branchEvents.filter(e => {
                  const eventDate = new Date(e.date)
                  return (
                    eventDate.getDate() === day &&
                    eventDate.getMonth() === calendar.month &&
                    eventDate.getFullYear() === calendar.year
                  )
                }) : []

                return (
                  <div
                    key={idx}
                    onClick={() => day && setSelectedDay(day)}
                    className={`
                      aspect-square p-2 border-e border-b border-border last-of-type:border-e-0 flex flex-col
                      ${day ? "cursor-pointer hover:bg-accent/50" : "bg-muted/30"}
                      ${isSelected ? "bg-primary/20 border-primary border-2" : ""}
                      ${isToday && !isSelected ? "border-orange-500 border-2" : ""}
                      ${!day ? "bg-muted/50" : ""}
                    `}
                  >
                    {day && (
                      <>
                        <div className="text-xs font-semibold text-foreground mb-1">{day}</div>
                        <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
                          {dayEvents.slice(0, 2).map((event, i) => (
                            <div
                              key={i}
                              className={`
                                text-xs px-1 py-0.5 rounded truncate text-white font-medium
                                ${event.type === "exam" ? "bg-orange-500" : ""}
                                ${event.type === "meeting" ? "bg-blue-500" : ""}
                                ${event.type === "ceremony" ? "bg-purple-500" : ""}
                                ${event.type === "holiday" ? "bg-gray-500" : ""}
                              `}
                            >
                              {event.title}
                            </div>
                          ))}
                          {dayEvents.length > 2 && (
                            <div className="text-xs text-muted-foreground">
                              +{dayEvents.length - 2}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Weekly view placeholder */}
        {viewMode === "weekly" && (
          <div className="text-center py-8 text-muted-foreground">
            العرض الأسبوعي قريباً
          </div>
        )}

        {/* Agenda view placeholder */}
        {viewMode === "agenda" && (
          <div className="text-center py-8 text-muted-foreground">
            عرض الأجندة قريباً
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-8 py-6">
      {branches.map(branch => renderCalendarForBranch(branch))}
    </div>
  )
}
