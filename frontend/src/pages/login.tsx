import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNavigate, Link, useSearchParams } from "react-router-dom"
import { Mail, Lock, Globe } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { apiClient } from "@/services/api"
import { toast } from "sonner"

export default function LoginPage() {
  const navigate = useNavigate()
  const { loginWithGoogle, isAuthenticated } = useAuth()
  const [searchParams] = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({ email: "", password: "" })

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get("code")
    if (code) {
      handleOAuthCallback(code)
    }
  }, [searchParams])

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/admin")
    }
  }, [isAuthenticated, navigate])

  const handleOAuthCallback = async (code: string) => {
    try {
      setIsLoading(true)
      await loginWithGoogle(code)
      navigate("/admin")
      toast.success("Signed in successfully!")
    } catch (error) {
      toast.error("Failed to sign in with Google")
      console.error("[v0] OAuth login failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    toast.error("Email/password login not yet available. Please use Google Sign-In.")
  }

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo.png-kMUX9pf6eYIFbqTaPivPBbHvNW25ww.jpeg"
            alt="Bodour Al-Amal"
            className="mx-auto h-16 w-16"
          />
          <h1 className="mt-4 text-2xl font-bold text-foreground">بذور الأمل</h1>
          <p className="mt-2 text-muted-foreground">Institute Management Platform</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>
              Enter your credentials to access the platform
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={handleChange}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={handleChange}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <Button
              onClick={handleGoogleLogin}
              variant="outline"
              className="w-full"
            >
              <Globe className="mr-2 h-4 w-4" />
              Sign in with Google
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link to="/register" className="text-primary hover:underline">
                Register here
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
