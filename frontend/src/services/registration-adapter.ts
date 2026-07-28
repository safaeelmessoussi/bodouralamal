/**
 * Registration Adapter - Isolated Backend Dependency Layer
 * 
 * This adapter encapsulates all backend contract dependencies for the registration flow.
 * It uses mock data and local state for now. Once backend contracts are finalized,
 * replace the implementation below with real API calls.
 * 
 * TODO: Replace with real backend API once contract is defined
 */

export interface OnboardingSession {
  email: string
  googleId?: string
  givenName?: string
  familyName?: string
}

export interface RegistrationFormData {
  firstName: string
  lastName: string
  gender: "male" | "female"
  category: "child" | "youth" | "woman"
  phone?: string
  parentName?: string
  parentPhone?: string
  parentEmail?: string
}

export interface RegistrationResponse {
  success: boolean
  message: string
  registrationId?: string
}

/**
 * ADAPTER: Extract onboarding session from URL fragment
 * 
 * Expected format (from backend): #onboarding_token=<jwt>
 * JWT payload should contain: { email, googleId, givenName, familyName, ... }
 * 
 * TODO: Backend must define the onboarding token payload structure
 * TODO: Backend must clarify if token is JWT, opaque string, or other format
 */
export function extractOnboardingSession(): OnboardingSession | null {
  try {
    const fragment = window.location.hash.slice(1)
    const params = new URLSearchParams(fragment)
    const token = params.get("onboarding_token")

    if (!token) return null

    // TODO: Backend to define token format and decoding mechanism
    // For now, we'll use mock data since we don't know the real format
    // Once backend is ready, replace with actual token decoding
    
    // Mock: Extract from query params as fallback (for testing)
    const mockEmail = params.get("email") || "user@example.com"
    const mockGivenName = params.get("given_name") || "محمد"
    const mockFamilyName = params.get("family_name") || "أحمد"

    return {
      email: mockEmail,
      googleId: token.slice(0, 20), // Mock Google ID
      givenName: mockGivenName,
      familyName: mockFamilyName,
    }
  } catch (error) {
    console.error("[registration-adapter] Error extracting session:", error)
    return null
  }
}

/**
 * ADAPTER: Submit registration form
 * 
 * TODO: Backend must define:
 * - POST /api/v1/registration endpoint URL
 * - Request payload schema
 * - Response payload schema
 * - Validation rules
 * - Error handling codes
 * 
 * For now, this is a mock implementation that stores data locally
 */
export async function submitRegistration(
  onboardingToken: string,
  formData: RegistrationFormData
): Promise<RegistrationResponse> {
  // TODO: Replace with real API call once backend contract is defined
  // Example placeholder for future implementation:
  /*
  return apiClient.request("POST", "/registration", {
    onboarding_token: onboardingToken,
    first_name: formData.firstName,
    last_name: formData.lastName,
    gender: formData.gender,
    category: formData.category,
    phone: formData.phone,
    parent_name: formData.parentName,
    parent_phone: formData.parentPhone,
    parent_email: formData.parentEmail,
  })
  */

  // MOCK: Store locally and simulate backend response
  return new Promise((resolve) => {
    setTimeout(() => {
      // Store in sessionStorage as mock persistence
      sessionStorage.setItem("registration_pending", JSON.stringify({
        ...formData,
        onboardingToken,
        submittedAt: new Date().toISOString(),
      }))

      resolve({
        success: true,
        message: "تم استقبال طلب التسجيل بنجاح",
        registrationId: `REG-${Date.now()}`,
      })
    }, 500)
  })
}

/**
 * ADAPTER: Check if applicant is a minor
 * 
 * TODO: Backend must define:
 * - How minors are determined (age, category, explicit flag?)
 * - Whether this info comes from Google profile or user form
 * - API endpoint to fetch this metadata
 * 
 * For now, we hardcode: "child" category means minor
 */
export function isMinor(category: string): boolean {
  // TODO: This should come from backend based on actual business logic
  // For now: assume "child" category means a minor
  return category === "child"
}

/**
 * ADAPTER: Get pending registration status
 * 
 * TODO: Backend must define:
 * - GET /api/v1/registration/status endpoint
 * - Status values (pending, approved, rejected, etc.)
 * - Whether to poll or use websockets
 */
export async function getPendingRegistrationStatus(): Promise<{
  status: "pending" | "approved" | "rejected"
  message: string
}> {
  // TODO: Replace with real API call
  // For now, return mock pending status
  const pending = sessionStorage.getItem("registration_pending")
  if (pending) {
    return {
      status: "pending",
      message: "في انتظار الموافقة من فريق إدارة المؤسسة",
    }
  }

  return {
    status: "pending",
    message: "في انتظار الموافقة من فريق إدارة المؤسسة",
  }
}

/**
 * ADAPTER: Clear registration session
 */
export function clearRegistrationSession(): void {
  sessionStorage.removeItem("registration_pending")
  sessionStorage.removeItem("oauth_destination")
}
