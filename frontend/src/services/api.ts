const API_BASE = "/api/v1"

export interface AuthResponse {
  access_token: string
  refresh_token: string
  user: {
    id: string
    email: string
    name: string
    role: "admin" | "teacher" | "parent" | "student" | "branch_manager"
  }
}

export interface Branch {
  id: string
  name: string
  location: string
  manager_id: string
  created_at: string
  rooms_count?: number
}

export interface BranchesResponse {
  data: Branch[]
  total: number
  page: number
}

export interface User {
  id: string
  email: string
  name: string
  role: "admin" | "teacher" | "parent" | "student" | "branch_manager"
  status: "active" | "inactive" | "pending"
  created_at: string
  last_login?: string
}

export interface UsersResponse {
  data: User[]
  total: number
  page: number
}

export class ApiClient {
  private accessToken: string | null = null
  private refreshToken: string | null = null

  constructor() {
    this.loadTokens()
  }

  private loadTokens() {
    this.accessToken = localStorage.getItem("access_token")
    this.refreshToken = localStorage.getItem("refresh_token")
  }

  private saveTokens(access: string, refresh: string) {
    this.accessToken = access
    this.refreshToken = refresh
    localStorage.setItem("access_token", access)
    localStorage.setItem("refresh_token", refresh)
  }

  private clearTokens() {
    this.accessToken = null
    this.refreshToken = null
    localStorage.removeItem("access_token")
    localStorage.removeItem("refresh_token")
  }

  private async request(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<any> {
    const url = `${API_BASE}${endpoint}`
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    }

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      })

      if (response.status === 401 && this.refreshToken) {
        // Try to refresh token
        const refreshed = await this.refreshAccessToken()
        if (refreshed) {
          // Retry request with new token
          return this.request(endpoint, options)
        } else {
          this.clearTokens()
          window.location.href = "/login"
          throw new Error("Session expired")
        }
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.message || `API Error: ${response.status}`)
      }

      return response.json()
    } catch (error) {
      console.error("[v0] API request failed:", error)
      throw error
    }
  }

  async initiateGoogleAuth(): Promise<string> {
    const response = await this.request("/auth/google")
    return response.auth_url
  }

  async handleGoogleCallback(code: string): Promise<AuthResponse> {
    const response = await this.request("/auth/google/callback", {
      method: "POST",
      body: JSON.stringify({ code }),
    })

    this.saveTokens(response.access_token, response.refresh_token)
    return response
  }

  async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false

    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      })

      if (!response.ok) {
        return false
      }

      const data = await response.json()
      this.saveTokens(data.access_token, data.refresh_token)
      return true
    } catch {
      return false
    }
  }

  async getCurrentUser(): Promise<AuthResponse["user"]> {
    return this.request("/me")
  }

  async logout(): Promise<void> {
    try {
      await this.request("/auth/logout", { method: "POST" })
    } finally {
      this.clearTokens()
    }
  }

  async getBranches(page: number = 1, limit: number = 10): Promise<BranchesResponse> {
    return this.request(`/admin/branches?page=${page}&limit=${limit}`)
  }

  async getBranch(id: string): Promise<Branch> {
    return this.request(`/admin/branches/${id}`)
  }

  async createBranch(data: Partial<Branch>): Promise<Branch> {
    return this.request("/admin/branches", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updateBranch(id: string, data: Partial<Branch>): Promise<Branch> {
    return this.request(`/admin/branches/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }

  async deleteBranch(id: string): Promise<void> {
    await this.request(`/admin/branches/${id}`, { method: "DELETE" })
  }

  async getUsers(page: number = 1, limit: number = 10): Promise<UsersResponse> {
    return this.request(`/admin/users?page=${page}&limit=${limit}`)
  }

  async getUser(id: string): Promise<User> {
    return this.request(`/admin/users/${id}`)
  }

  async createUser(data: Partial<User>): Promise<User> {
    return this.request("/admin/users", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    return this.request(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }

  async deleteUser(id: string): Promise<void> {
    await this.request(`/admin/users/${id}`, { method: "DELETE" })
  }

  isAuthenticated(): boolean {
    return !!this.accessToken
  }

  getAccessToken(): string | null {
    return this.accessToken
  }
}

export const apiClient = new ApiClient()
