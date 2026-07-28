import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNavigate } from "react-router-dom"
import { Clock, Mail, Phone } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { ar } from "@/i18n/ar"

export default function PendingApprovalPage() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  const handleLogout = async () => {
    try {
      await logout()
      navigate("/login")
    } catch (error) {
      console.error("[v0] Logout failed:", error)
    }
  }

  return (
    <div 
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-12"
      dir="rtl"
    >
      <div className="w-full max-w-md">
        <Card className="border-0 shadow-lg">
          <CardHeader className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-primary/10 p-3">
                <Clock className="h-8 w-8 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl">{ar.pendingApproval.title}</CardTitle>
            <CardDescription>{ar.pendingApproval.subtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg bg-card p-4 text-center">
              <p className="text-sm text-muted-foreground">
                {ar.pendingApproval.message}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">
                {ar.pendingApproval.nextSteps}
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <Mail className="h-4 w-4 flex-shrink-0 text-primary mt-0.5" />
                  <span>{ar.pendingApproval.step1}</span>
                </li>
                <li className="flex gap-2">
                  <Clock className="h-4 w-4 flex-shrink-0 text-primary mt-0.5" />
                  <span>{ar.pendingApproval.step2}</span>
                </li>
                <li className="flex gap-2">
                  <Phone className="h-4 w-4 flex-shrink-0 text-primary mt-0.5" />
                  <span>{ar.pendingApproval.step3}</span>
                </li>
              </ul>
            </div>

            <div className="rounded-lg bg-muted p-4">
              <p className="text-center text-sm text-muted-foreground">
                {ar.pendingApproval.contactSupport}
              </p>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                📧 contact@bodour.ma
              </p>
            </div>

            <Button 
              onClick={handleLogout}
              variant="outline"
              className="w-full"
            >
              {ar.common.logout}
            </Button>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © 2026 جمعية بذور الأمل لتعليم القرآن الكريم
        </p>
      </div>
    </div>
  )
}
