import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { apiClient, AuthResponse } from "@/services/api"

interface AuthContextType {
  user: AuthResponse["user"] | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: (code: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthResponse["user"] | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Check if user is already logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        console.log("[v0] Checking authentication state...")
        if (apiClient.isAuthenticated()) {
          console.log("[v0] User has token, fetching user data...")
          try {
            const currentUser = await apiClient.getCurrentUser()
            console.log("[v0] User data loaded:", currentUser)
            setUser(currentUser)
          } catch (err) {
            console.warn("[v0] Failed to load user data, clearing tokens:", err)
            // Clear invalid tokens
            localStorage.removeItem("access_token")
            localStorage.removeItem("refresh_token")
          }
        } else {
          console.log("[v0] No authentication token found")
        }
      } catch (error) {
        console.error("[v0] Error in checkAuth:", error)
        // Clear invalid tokens
        localStorage.removeItem("access_token")
        localStorage.removeItem("refresh_token")
      } finally {
        console.log("[v0] Auth check complete, setting loading to false")
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [])

  const login = async (email: string, password: string) => {
    setIsLoading(true)
    try {
      // For now, just use email/password placeholder
      // This will be implemented when backend adds email/password auth
      console.warn("[v0] Email/password auth not yet implemented")
      throw new Error("Email/password authentication not available yet. Please use Google login.")
    } finally {
      setIsLoading(false)
    }
  }

  const loginWithGoogle = async (code: string) => {
    setIsLoading(true)
    try {
      const response = await apiClient.handleGoogleCallback(code)
      setUser(response.user)
    } catch (error) {
      console.error("[v0] Google login failed:", error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const logout = async () => {
    setIsLoading(true)
    try {
      await apiClient.logout()
      setUser(null)
    } catch (error) {
      console.error("[v0] Logout failed:", error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const value = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    loginWithGoogle,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}
