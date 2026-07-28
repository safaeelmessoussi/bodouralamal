import { NavLink, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  LayoutDashboard,
  CheckCircle,
  Users,
  Building2,
  BookOpen,
  CalendarDays,
  Library,
  Settings,
  ChevronRight,
  GraduationCap,
  BookMarked,
  FileText,
  ClipboardList,
  Heart,
  Baby,
} from "lucide-react"

interface SidebarProps {
  open: boolean
  onClose: () => void
}

const adminNav = [
  { label: "لوحة التحكم", href: "/admin", icon: LayoutDashboard },
  { label: "طلبات التسجيل", href: "/admin/approvals", icon: CheckCircle, badge: "12" },
  { label: "المستخدمون", href: "/admin/users", icon: Users },
  { label: "الفروع والقاعات", href: "/admin/branches", icon: Building2 },
  { label: "المجموعات", href: "/admin/groups", icon: BookOpen },
  { label: "التقويم", href: "/admin/calendar", icon: CalendarDays },
  { label: "المحتوى", href: "/admin/content", icon: Library },
  { label: "الإعدادات", href: "/admin/settings", icon: Settings },
]

const teacherNav = [
  { label: "لوحتي", href: "/teacher", icon: LayoutDashboard },
  { label: "مجموعاتي", href: "/teacher/groups", icon: GraduationCap },
  { label: "تتبع القرآن", href: "/teacher/quran", icon: BookMarked },
  { label: "الاختبارات", href: "/teacher/exams", icon: ClipboardList },
  { label: "المحتوى التعليمي", href: "/teacher/content", icon: FileText },
]

const parentStudentNav = [
  { label: "لوحة الأم / الولي", href: "/parent", icon: Heart },
  { label: "لوحة الطالبة", href: "/student", icon: Baby },
]

export default function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation()

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-30 flex flex-col w-64 bg-sidebar border-l border-sidebar-border transition-transform duration-200 lg:static lg:translate-x-0 lg:z-auto",
          open ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        )}
        dir="rtl"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-border">
          <div className="flex items-center justify-center size-9 rounded-xl bg-primary/10">
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo.png-kMUX9pf6eYIFbqTaPivPBbHvNW25ww.jpeg"
              alt="بذور الأمل"
              className="size-7 object-contain rounded"
            />
          </div>
          <div>
            <p className="text-sm font-semibold text-sidebar-foreground leading-tight">بذور الأمل</p>
            <p className="text-xs text-muted-foreground">للمرأة والطفل</p>
          </div>
        </div>

        <ScrollArea className="flex-1 py-3">
          <nav className="px-2 flex flex-col gap-0.5" dir="rtl">
            <SectionLabel label="الإدارة" />
            {adminNav.map((item) => (
              <NavItem key={item.href} {...item} current={location.pathname === item.href} />
            ))}

            <Separator className="my-3 mx-2" />
            <SectionLabel label="المعلمات" />
            {teacherNav.map((item) => (
              <NavItem key={item.href} {...item} current={location.pathname === item.href} />
            ))}

            <Separator className="my-3 mx-2" />
            <SectionLabel label="الأسرة والطالبات" />
            {parentStudentNav.map((item) => (
              <NavItem key={item.href} {...item} current={location.pathname === item.href} />
            ))}
          </nav>
        </ScrollArea>

        {/* Bottom user */}
        <div className="border-t border-sidebar-border px-3 py-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-sidebar-accent cursor-pointer">
            <div className="flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
              م
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">مدير النظام</p>
              <p className="text-xs text-muted-foreground truncate">admin@bodour.ma</p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground rotate-180 shrink-0" />
          </div>
        </div>
      </aside>
    </>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </p>
  )
}

interface NavItemProps {
  label: string
  href: string
  icon: React.ElementType
  badge?: string
  current: boolean
}

function NavItem({ label, href, icon: Icon, badge, current }: NavItemProps) {
  return (
    <NavLink
      to={href}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        current
          ? "bg-primary/10 text-primary font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          current ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-accent-foreground"
        )}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <Badge className="h-5 min-w-5 px-1.5 text-[10px] bg-primary/15 text-primary hover:bg-primary/15 border-0">
          {badge}
        </Badge>
      )}
    </NavLink>
  )
}
