import { useState } from "react"
import { useLocation } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/components/theme-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Menu,
  Bell,
  Search,
  Sun,
  Moon,
  LogOut,
  User,
  Settings,
  ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"

const breadcrumbMap: Record<string, string[]> = {
  "/admin": ["الإدارة", "لوحة التحكم"],
  "/admin/approvals": ["الإدارة", "طلبات التسجيل"],
  "/admin/users": ["الإدارة", "المستخدمون"],
  "/admin/branches": ["الإدارة", "الفروع والقاعات"],
  "/admin/groups": ["الإدارة", "المجموعات"],
  "/admin/calendar": ["الإدارة", "التقويم"],
  "/admin/content": ["الإدارة", "المحتوى"],
  "/admin/settings": ["الإدارة", "الإعدادات"],
  "/teacher": ["المعلمة", "لوحتي"],
  "/teacher/groups": ["المعلمة", "مجموعاتي"],
  "/teacher/quran": ["المعلمة", "تتبع القرآن"],
  "/teacher/exams": ["المعلمة", "الاختبارات"],
  "/teacher/content": ["المعلمة", "المحتوى التعليمي"],
  "/parent": ["الأسرة", "لوحة الأم / الولي"],
  "/student": ["الأسرة", "لوحة الطالبة"],
}

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { theme, setTheme } = useTheme()
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)
  const crumbs = breadcrumbMap[location.pathname] ?? ["الرئيسية"]

  return (
    <header
      className="flex items-center gap-3 h-14 px-4 border-b border-border bg-background/80 backdrop-blur-sm shrink-0"
      dir="rtl"
    >
      <Button variant="ghost" size="icon" onClick={onMenuClick} className="size-8 lg:hidden">
        <Menu className="size-4" />
      </Button>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm min-w-0 flex-1">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-border">/</span>}
            <span
              className={cn(
                i === crumbs.length - 1
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-4" />
          <span className="sr-only">بحث</span>
        </Button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          <span className="sr-only">تبديل الوضع</span>
        </Button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground relative">
          <Bell className="size-4" />
          <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
          <span className="sr-only">إشعارات</span>
        </Button>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 px-2 text-sm">
              <div className="flex items-center justify-center size-6 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                م
              </div>
              <span className="hidden sm:block text-sm font-medium">مدير النظام</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" dir="rtl">
            <DropdownMenuItem className="gap-2">
              <User className="size-4" />
              الملف الشخصي
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2">
              <Settings className="size-4" />
              الإعدادات
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive">
              <LogOut className="size-4" />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/40"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-popover border border-border rounded-xl shadow-xl p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search className="size-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                placeholder="ابحث عن مستخدم، مجموعة، محتوى..."
                className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
                dir="rtl"
              />
            </div>
            <div className="py-2 px-3 text-xs text-muted-foreground">
              اكتب للبحث...
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
