import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"
import { Lightbulb, Users, BookOpen, Zap } from "lucide-react"
import { ar } from "@/i18n/ar"

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-4">
            <Button
              onClick={() => navigate("/login")}
              variant="ghost"
            >
              {ar.login.title}
            </Button>
            <Button onClick={() => navigate("/register")}>
              {ar.registration.title}
            </Button>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-foreground">{ar.common.appName}</span>
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo.png-kMUX9pf6eYIFbqTaPivPBbHvNW25ww.jpeg"
              alt="Bodour Al-Amal"
              className="h-10 w-10"
            />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
          {ar.landing.heroTitle}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-xl text-muted-foreground">
          {ar.landing.heroSubtitle}
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
          {ar.landing.heroDescription}
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Button size="lg" onClick={() => navigate("/login")}>
            {ar.landing.registerButton}
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="bg-card/50 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-foreground">
            {ar.landing.featuresTitle}
          </h2>
          <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-background p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">{ar.landing.featureQuran.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {ar.landing.featureQuran.description}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">{ar.landing.featureIslamic.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {ar.landing.featureIslamic.description}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">{ar.landing.featureLiteracy.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {ar.landing.featureLiteracy.description}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Lightbulb className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground">{ar.landing.featureTracking.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {ar.landing.featureTracking.description}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/50">
        <div className="mx-auto max-w-7xl px-4 py-8 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          <p>&copy; 2026 {ar.common.appName}</p>
        </div>
      </footer>
    </div>
  )
}
