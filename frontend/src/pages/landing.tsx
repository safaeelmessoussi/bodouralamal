import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"
import { Lightbulb, Users, BookOpen, Zap } from "lucide-react"

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo.png-kMUX9pf6eYIFbqTaPivPBbHvNW25ww.jpeg"
              alt="Bodour Al-Amal"
              className="h-10 w-10"
            />
            <span className="text-xl font-bold text-foreground">بذور الأمل</span>
          </div>
          <nav className="flex items-center gap-4">
            <Button
              onClick={() => navigate("/login")}
              variant="ghost"
            >
              Login
            </Button>
            <Button onClick={() => navigate("/register")}>
              Register
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
          Institut Management Platform
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-xl text-muted-foreground">
          Streamline Quran memorization, Islamic studies, and adult literacy programs with our comprehensive institute management system.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Button size="lg" onClick={() => navigate("/login")}>
            Get Started
          </Button>
          <Button size="lg" variant="outline">
            Learn More
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="bg-card/50 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-foreground">
            Powerful Features
          </h2>
          <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-background p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">Quran Tracking</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Monitor memorization progress and Surah completion
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">User Management</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Manage administrators, teachers, students, and parents
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">Exam Management</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Create and grade exams, track student progress
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Lightbulb className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">Smart Analytics</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Insights into student performance and attendance
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/50">
        <div className="mx-auto max-w-7xl px-4 py-8 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          <p>&copy; 2026 جمعية بذور الأمل. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
