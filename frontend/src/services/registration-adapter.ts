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
  gender: string
  category: string
  phone?: string
  parentName?: string
  parentPhone?: string
  parentEmail?: string
}

/**
 * Registration Metadata - Defines how the form should behave
 * 
 * TODO: These values should come from backend API
 * The backend determines what fields to show, what values are valid, etc.
 * Frontend simply renders according to this metadata.
 */
export interface RegistrationMetadata {
  // What type of registration profile is this person (determines which fields to show)
  registrationProfile: "adult" | "minor"

  // Whether parent information is required for this registration
  requiresParentInformation: boolean

  // Available gender options (backend determines valid values)
  availableGenders: Array<{
    value: string
    label: string
  }>

  // Available category options (backend determines valid values and their meanings)
  availableCategories: Array<{
    value: string
    label: string
  }>

  // Additional levels/groups if applicable (e.g., educational levels)
  availableLevels?: Array<{
    value: string
    label: string
  }>
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
 * ADAPTER: Get registration metadata that determines form behavior
 * 
 * This metadata tells the frontend what fields to show, what values are valid, etc.
 * It's determined entirely by backend business logic, not frontend assumptions.
 * 
 * TODO: Backend must provide API endpoint that returns this metadata
 * Endpoint should be called after authentication to determine:
 * - Is this person registering as adult or minor?
 * - Do they need to provide parent information?
 * - What are the valid gender options for this region/context?
 * - What are the valid category options and their labels?
 * 
 * For now, this is mock metadata with TODO comments for backend replacement
 */
export function getRegistrationMetadata(): RegistrationMetadata {
  // TODO: Replace entire function with real API call:
  // const response = await apiClient.get("/registration/metadata")
  // return response.data

  // MOCK METADATA: What the backend would determine
  // These values represent business rules that only backend should know
  return {
    // TODO: Backend determines if this is adult or minor registration
    // Could be based on: age from Google profile, previous preferences, etc.
    registrationProfile: "adult", // or "minor"

    // TODO: Backend determines if parent info is needed
    // Derived from registrationProfile and business rules
    requiresParentInformation: false,

    // TODO: Backend provides available gender options
    // Could vary by region, organization policy, or other factors
    availableGenders: [
      { value: "male", label: "ذكر" },
      { value: "female", label: "أنثى" },
    ],

    // TODO: Backend provides available category options
    // Category names and availability are business decisions
    // Frontend has no hardcoded knowledge of what they mean
    availableCategories: [
      { value: "child", label: "الطفل" },
      { value: "youth", label: "اليافعات" },
      { value: "woman", label: "المرأة" },
    ],

    // availableLevels could be used for educational tiers, etc.
  }
}

/**
 * ADAPTER: Get pending registration status
 * 
 * TODO: Backend must define:
 * - GET /api/v1/registration/status endpoint
 * - Status values (pending, approved, rejected, etc.)
 * - Whether to poll or use websockets
 * - Error messages for each status
 */
export async function getPendingRegistrationStatus(): Promise<{
  status: "pending" | "approved" | "rejected"
  message: string
}> {
  // TODO: Replace with real API call:
  // const response = await apiClient.get("/registration/status")
  // return response.data

  // MOCK: Return pending status
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
