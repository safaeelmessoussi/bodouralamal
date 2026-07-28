/**
 * Dashboard Data Adapter - Centralized mock data and dashboard backends
 * 
 * TODO: Replace mock functions with real API calls once backend provides endpoints
 * This adapter isolates all dashboard data dependencies in one place
 */

export interface StatMetric {
  title: string
  value: string
  description: string
  trend?: {
    value: number | string
    direction?: 'up' | 'down'
  }
}

export interface TaskItem {
  id: string
  title: string
  due: string
  priority: "high" | "medium" | "low"
}

export interface ClassItem {
  id: string
  name: string
  instructor: string
  days: string
  time: string
}

export interface RecentEvent {
  id: string
  name: string
  type: string
  branch: string
  time: string
  status: "pending" | "approved" | "rejected"
}

export interface UpcomingEvent {
  id: string
  title: string
  date: string
  branch: string
  type: "exam" | "meeting" | "event"
}

export interface DashboardStats {
  metrics: StatMetric[]
  isLoading: boolean
  error?: string
}

// Student Dashboard Data
// TODO: Backend should provide student-specific stats endpoint
export function getStudentStats(): DashboardStats {
  return {
    isLoading: false,
    metrics: [
      {
        title: "درجتي",
        value: "8.7/10",
        description: "المعدل الحالي",
      },
      {
        title: "السور المكتملة",
        value: "12",
        description: "من 114",
        trend: { value: "2", direction: "up" },
      },
      {
        title: "الحضور",
        value: "96%",
        description: "هذا الفصل",
      },
      {
        title: "الحصة القادمة",
        value: "اليوم",
        description: "10:00 صباحاً - مجموعة أ1",
      },
    ],
  }
}

export function getStudentTasks(): TaskItem[] {
  return [
    {
      id: "1",
      title: "مراجعة السورة",
      due: "2026-01-29",
      priority: "high",
    },
    {
      id: "2",
      title: "اختبار الدراسات الإسلامية",
      due: "2026-01-30",
      priority: "medium",
    },
    {
      id: "3",
      title: "واجب التجويد",
      due: "2026-02-01",
      priority: "low",
    },
  ]
}

export function getStudentClasses(): ClassItem[] {
  return [
    {
      id: "1",
      name: "مجموعة أ1",
      instructor: "أحمد حسن",
      days: "السبت، الإثنين، الأربعاء",
      time: "10:00 صباحاً",
    },
    {
      id: "2",
      name: "الدراسات الإسلامية",
      instructor: "فاطمة علي",
      days: "الأحد، الثلاثاء، الخميس",
      time: "11:30 صباحاً",
    },
  ]
}

// Parent Dashboard Data
// TODO: Backend should provide parent-specific stats endpoint
export function getParentStats(): DashboardStats {
  return {
    isLoading: false,
    metrics: [
      {
        title: "الدرجة الإجمالية",
        value: "8.5/10",
        description: "المعدل الحالي",
      },
      {
        title: "الحضور",
        value: "94%",
        description: "الشهر الحالي",
        trend: { value: "2%", direction: "up" },
      },
      {
        title: "السور المكتملة",
        value: "12",
        description: "من 114",
        trend: { value: "3", direction: "up" },
      },
      {
        title: "التقييم القادم",
        value: "بعد 5 أيام",
        description: "الدراسات الإسلامية",
      },
    ],
  }
}

// Teacher Dashboard Data
// TODO: Backend should provide teacher-specific stats endpoint
export function getTeacherStats(): DashboardStats {
  return {
    isLoading: false,
    metrics: [
      {
        title: "إجمالي الطلاب",
        value: "45",
        description: "في جميع المجموعات",
      },
      {
        title: "المجموعات",
        value: "3",
        description: "مجموعات نشطة",
      },
      {
        title: "متوسط الحضور",
        value: "92%",
        description: "هذا الفصل",
        trend: { value: "5%", direction: "up" },
      },
      {
        title: "الجلسات هذا الأسبوع",
        value: "9",
        description: "جلسات مجدولة",
      },
    ],
  }
}

// Admin Dashboard Data
// TODO: Backend should provide admin-specific stats endpoint
export function getAdminStats(): DashboardStats {
  return {
    isLoading: false,
    metrics: [
      {
        title: "إجمالي الفروع",
        value: "12",
        description: "فروع نشطة",
      },
      {
        title: "المستخدمون",
        value: "234",
        description: "حساب مسجل",
      },
      {
        title: "الطلاب",
        value: "156",
        description: "طلاب نشطون",
      },
      {
        title: "المعلمون",
        value: "28",
        description: "معلمون نشطون",
      },
    ],
  }
}

export function getRecentRegistrations(): RecentEvent[] {
  return [
    {
      id: "1",
      name: "فاطمة الزهراء بنموسى",
      type: "طالبة",
      branch: "فرع الحي المحمدي",
      time: "منذ 10 دقائق",
      status: "pending",
    },
    {
      id: "2",
      name: "خديجة العلوي",
      type: "أم / ولية",
      branch: "فرع القدس",
      time: "منذ 25 دقيقة",
      status: "pending",
    },
    {
      id: "3",
      name: "مريم السعيدي",
      type: "طالبة",
      branch: "فرع السلام",
      time: "منذ ساعة",
      status: "pending",
    },
    {
      id: "4",
      name: "نور الهدى شكيري",
      type: "معلمة",
      branch: "فرع الحي المحمدي",
      time: "منذ ساعتين",
      status: "pending",
    },
  ]
}

export function getUpcomingEvents(): UpcomingEvent[] {
  return [
    {
      id: "1",
      title: "اختبار الحفظ الشهري",
      date: "غدًا، 9:00 ص",
      branch: "جميع الفروع",
      type: "exam",
    },
    {
      id: "2",
      title: "اجتماع المعلمات",
      date: "الخميس، 3:00 م",
      branch: "فرع الحي المحمدي",
      type: "meeting",
    },
    {
      id: "3",
      title: "حفل التكريم الفصلي",
      date: "السبت، 10:00 ص",
      branch: "المقر الرئيسي",
      type: "event",
    },
  ]
}
