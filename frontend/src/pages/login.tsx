import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Globe } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { apiClient } from "@/services/api"
import { toast } from "sonner"
import { ar } from "@/i18n/ar"
import { Spinner } from "@/components/ui/spinner"

export default function LoginPage() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)

  // Handle OAuth callback with access token in URL fragment
  useEffect(() => {
    const fragment = window.location.hash.slice(1)
    const params = new URLSearchParams(fragment)
    const accessToken = params.get("access_token")

    if (accessToken) {
      // Store token in memory (TD-12: never in storage)
      localStorage.setItem("_temp_access_token", accessToken)
      // Check if this is a redirect from pending approval or onboarding
      const destination = sessionStorage.getItem("oauth_destination")
      if (destination) {
        navigate(destination)
        sessionStorage.removeItem("oauth_destination")
      } else {
        navigate("/dashboard")
      }
    }
  }, [navigate])

  // Handle OAuth error
  useEffect(() => {
    const error = searchParams.get("error")
    if (error) {
      const errorMessages: Record<string, string> = {
        user_denied: ar.login.error.userDenied,
        state_mismatch: ar.login.error.stateMismatch,
        account_deactivated: ar.login.error.accountDeactivated,
      }
      toast.error(errorMessages[error] || ar.common.error)
    }
  }, [searchParams])

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard")
    }
  }, [isAuthenticated, navigate])

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true)
      const authUrl = await apiClient.initiateGoogleAuth()
      window.location.href = authUrl
    } catch (error) {
      toast.error("Failed to initiate Google login")
      console.error("[v0] Google login initiation failed:", error)
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted px-4" dir="rtl">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <img
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo.png-kMUX9pf6eYIFbqTaPivPBbHvNW25ww.jpeg"
            alt="Bodour Al-Amal"
            className="mx-auto h-16 w-16"
          />
          <h1 className="mt-4 text-2xl font-bold text-foreground">{ar.common.appName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{ar.login.subtitle}</p>
        </div>

        {/* Card */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>{ar.login.title}</CardTitle>
            <CardDescription>{ar.login.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  {ar.login.signingIn}
                </>
              ) : (
                <>
                  <Globe className="mr-2 h-4 w-4" />
                  {ar.login.googleSignIn}
                </>
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">{ar.login.privacyNote}</p>

            <div className="border-t pt-4 text-center text-sm">
              <p className="text-muted-foreground mb-2">{ar.login.noAccount}</p>
              <p className="text-xs text-muted-foreground">
                {ar.login.signUpFlow}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
