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

// Day names from Sunday to Saturday (right-to-left layout)
const DAY_NAMES = ["الأحد", "السبت", "الجمعة", "الخميس", "الأربعاء", "الثلاثاء", "الاثنين"]

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
  const [selectedBranch, setSelectedBranch] = useState("جميع الفروع")
  
  const branches = getAvailableBranches()
  const events = getCalendarEvents()

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (year: number, month: number) => {
    const day = new Date(year, month, 1).getDay()
    // Convert from JS (0=Sunday) to our RTL layout (0=Sunday on right)
    return day
  }

  const handlePreviousMonth = () => {
    setCalendar(prev => {
      if (prev.month === 0) {
        return { year: prev.year - 1, month: 11 }
      }
      return { ...prev, month: prev.month - 1 }
    })
  }

  const handleNextMonth = () => {
    setCalendar(prev => {
      if (prev.month === 11) {
        return { year: prev.year + 1, month: 0 }
      }
      return { ...prev, month: prev.month + 1 }
    })
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

  const renderCalendarGrid = () => {
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

    // Reverse days array for RTL (right-to-left) layout
    const reversedDays: (number | null)[] = []
    for (let i = days.length - 1; i >= 0; i--) {
      reversedDays.push(days[i])
    }

    const hijriDate = getHijriDate(calendar.month)
    const branchEvents = selectedBranch === "جميع الفروع" 
      ? events 
      : events.filter(e => e.branch === selectedBranch || e.branch === "جميع الفروع")

    return (
      <div className="flex-1" dir="rtl">
        {/* Calendar Grid */}
        <div className="bg-white border border-border rounded">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-border bg-muted">
            {DAY_NAMES.map(day => (
              <div
                key={day}
                className="p-3 text-center font-bold text-sm border-l border-border last:border-l-0 text-foreground"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 auto-rows-fr">
            {reversedDays.map((day, idx) => {
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
                    min-h-24 p-2 border-l border-b border-border last-of-type:border-l-0 flex flex-col
                    ${day ? "cursor-pointer hover:bg-accent/30" : "bg-muted/20"}
                    ${isSelected ? "bg-blue-50" : ""}
                    ${isToday && !isSelected ? "border-orange-400 border-2 border-l-2" : ""}
                    ${!day ? "bg-muted/30" : "bg-white"}
                  `}
                >
                  {day && (
                    <>
                      <div className={`text-sm font-bold mb-1 ${isToday ? "text-orange-500" : "text-muted-foreground"}`}>
                        {day}
                      </div>
                      <div className="flex-1 flex flex-col gap-0.5 overflow-hidden text-xs">
                        {dayEvents.slice(0, 3).map((event, i) => (
                          <div
                            key={i}
                            className={`
                              px-1 py-0.5 rounded text-white font-medium truncate
                              ${event.type === "exam" ? "bg-orange-500" : ""}
                              ${event.type === "meeting" ? "bg-blue-500" : ""}
                              ${event.type === "ceremony" ? "bg-purple-500" : ""}
                              ${event.type === "holiday" ? "bg-gray-500" : ""}
                            `}
                            title={event.title}
                          >
                            {event.title}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-6 gap-6" dir="rtl">
      {/* Branch selector chips */}
      <div className="flex flex-wrap gap-2 justify-center pb-4 border-b border-border">
        <button
          onClick={() => setSelectedBranch("جميع الفروع")}
          className={`
            px-4 py-2 rounded-full border-2 font-medium text-sm transition-colors
            ${selectedBranch === "جميع الفروع" 
              ? "bg-gray-800 text-white border-gray-800" 
              : "bg-white text-foreground border-gray-300 hover:border-gray-400"}
          `}
        >
          ⋮
        </button>
        {branches.map((branch, idx) => {
          const colors = [
            "border-teal-400 text-teal-600",
            "border-red-300 text-red-600",
            "border-cyan-400 text-cyan-600",
            "border-pink-400 text-pink-600",
            "border-purple-400 text-purple-600",
            "border-amber-400 text-amber-600",
            "border-green-400 text-green-600",
          ]
          const colorClass = colors[idx % colors.length]
          
          return (
            <button
              key={branch}
              onClick={() => setSelectedBranch(branch)}
              className={`
                px-4 py-2 rounded-full border-2 font-medium text-sm transition-colors
                ${selectedBranch === branch 
                  ? `bg-white ${colorClass}` 
                  : `bg-white border-gray-300 text-gray-600 hover:border-gray-400`}
              `}
            >
              • {branch.split(" ")[1]}
            </button>
          )
        })}
      </div>

      {/* Main content with sidebar layout */}
      <div className="flex gap-6 flex-1 overflow-hidden">
        {/* Left sidebar - View mode toggles */}
        <div className="flex flex-col gap-2 w-24">
          <button
            onClick={() => setViewMode("agenda")}
            className={`px-3 py-2 text-sm font-medium rounded border transition-colors
              ${viewMode === "agenda" 
                ? "bg-gray-200 text-gray-800 border-gray-300" 
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}
          >
            أجندة
          </button>
          <button
            onClick={() => setViewMode("weekly")}
            className={`px-3 py-2 text-sm font-medium rounded border transition-colors
              ${viewMode === "weekly" 
                ? "bg-gray-200 text-gray-800 border-gray-300" 
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}
          >
            أسبوعي
          </button>
          <button
            onClick={() => setViewMode("monthly")}
            className={`px-3 py-2 text-sm font-medium rounded border transition-colors
              ${viewMode === "monthly" 
                ? "bg-gray-200 text-gray-800 border-gray-300" 
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}
          >
            شهري
          </button>
        </div>

        {/* Center - Calendar grid */}
        {viewMode === "monthly" && renderCalendarGrid()}

        {/* Right sidebar - Day navigation and month info */}
        <div className="flex flex-col gap-4 w-28">
          <div className="text-center">
            <div className="text-lg font-bold text-orange-500">
              {GREGORIAN_MONTHS[calendar.month]} {calendar.year}
            </div>
            <div className="text-xs text-muted-foreground">
              {getHijriDate(calendar.month).month} / {getHijriDate(calendar.month).year}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              className="w-full text-xs"
            >
              اليوم
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextMonth}
              className="w-full text-xs"
            >
              التالي
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousMonth}
              className="w-full text-xs"
            >
              السابق
            </Button>
          </div>
        </div>
      </div>

      {/* Weekly and Agenda view placeholders */}
      {viewMode === "weekly" && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          العرض الأسبوعي قريباً
        </div>
      )}
      {viewMode === "agenda" && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          عرض الأجندة قريباً
        </div>
      )}
    </div>
  )
}
