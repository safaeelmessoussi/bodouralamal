/**
 * Calendar Adapter
 * 
 * Provides mock event data for the calendar page.
 * TODO: Replace with real API calls when backend is available.
 */

export type EventType = "exam" | "meeting" | "ceremony" | "holiday"

export interface CalendarEvent {
  id: number
  title: string
  date: string // YYYY-MM-DD
  time: string
  location: string
  type: EventType
  branch: string
}

/**
 * Get all calendar events
 * TODO: Call GET /api/v1/calendar/events from backend
 */
export function getCalendarEvents(): CalendarEvent[] {
  return [
    {
      id: 1,
      title: "اختبار الحفظ الشهري",
      date: "2026-07-26",
      time: "9:00–11:00",
      location: "جميع الفروع",
      type: "exam",
      branch: "all",
    },
    {
      id: 2,
      title: "اجتماع المعلمات",
      date: "2026-07-28",
      time: "3:00–5:00",
      location: "فرع الحي المحمدي",
      type: "meeting",
      branch: "فرع الحي المحمدي",
    },
    {
      id: 3,
      title: "حفل التكريم الفصلي",
      date: "2026-08-02",
      time: "10:00–13:00",
      location: "المقر الرئيسي",
      type: "ceremony",
      branch: "all",
    },
    {
      id: 4,
      title: "عطلة رسمية",
      date: "2026-08-14",
      time: "طوال اليوم",
      location: "—",
      type: "holiday",
      branch: "all",
    },
    {
      id: 5,
      title: "اختبار التجويد",
      date: "2026-07-30",
      time: "10:00–12:00",
      location: "فرع القدس",
      type: "exam",
      branch: "فرع القدس",
    },
  ]
}

/**
 * Get branches for filter/select
 * TODO: Call GET /api/v1/branches from backend
 */
export function getAvailableBranches(): string[] {
  return [
    "جميع الفروع",
    "فرع الحي المحمدي",
    "فرع القدس",
    "فرع السلام",
  ]
}

/**
 * Add a new calendar event
 * TODO: Call POST /api/v1/calendar/events from backend
 */
export function addCalendarEvent(event: Omit<CalendarEvent, "id">): CalendarEvent {
  // Mock: Generate ID
  const newEvent: CalendarEvent = {
    ...event,
    id: Math.max(...getCalendarEvents().map(e => e.id), 0) + 1,
  }
  // TODO: Save to backend
  return newEvent
}
