import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { ar } from "@/i18n/ar"
import { Spinner } from "@/components/ui/spinner"
import {
  extractOnboardingSession,
  submitRegistration,
  getRegistrationMetadata,
  RegistrationFormData,
  RegistrationMetadata,
  OnboardingSession,
} from "@/services/registration-adapter"

type RegistrationData = RegistrationFormData

export default function RegisterPage() {
  const navigate = useNavigate()
  const [session, setSession] = useState<OnboardingSession | null>(null)
  const [onboardingToken, setOnboardingToken] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<RegistrationMetadata | null>(null)
  const [formData, setFormData] = useState<RegistrationData>({
    firstName: "",
    lastName: "",
    gender: "",
    category: "",
  })
  const [isLoading, setIsLoading] = useState(false)

  // Extract onboarding session and metadata from backend
  useEffect(() => {
    const onboarding = extractOnboardingSession()
    if (!onboarding) {
      navigate("/login")
      return
    }

    setSession(onboarding)

    // TODO: Backend must clarify token format and handling
    const fragment = window.location.hash.slice(1)
    const params = new URLSearchParams(fragment)
    const token = params.get("onboarding_token")
    if (token) {
      setOnboardingToken(token)
    }

    // Populate name fields from Google data if available
    if (onboarding.givenName || onboarding.familyName) {
      setFormData((prev) => ({
        ...prev,
        firstName: onboarding.givenName || "",
        lastName: onboarding.familyName || "",
      }))
    }

    // Get registration metadata from backend (determines form behavior)
    const meta = getRegistrationMetadata()
    setMetadata(meta)
  }, [navigate])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const validateForm = (): boolean => {
    if (!formData.firstName.trim()) {
      toast.error(ar.registration.validation.firstNameRequired)
      return false
    }
    if (!formData.lastName.trim()) {
      toast.error(ar.registration.validation.lastNameRequired)
      return false
    }
    if (!formData.gender) {
      toast.error(ar.registration.validation.genderRequired)
      return false
    }
    if (!formData.category) {
      toast.error(ar.registration.validation.categoryRequired)
      return false
    }

    // Validate conditional fields based on backend metadata
    if (metadata?.requiresParentInformation) {
      if (!formData.parentName?.trim()) {
        toast.error("اسم ولي الأمر مطلوب")
        return false
      }
      if (!formData.parentPhone?.trim()) {
        toast.error(ar.registration.validation.phoneRequired)
        return false
      }
    } else {
      if (!formData.phone?.trim()) {
        toast.error(ar.registration.validation.phoneRequired)
        return false
      }
    }

    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm() || !onboardingToken) return

    setIsLoading(true)
    try {
      // TODO: Replace with real backend API call once contract is defined
      const response = await submitRegistration(onboardingToken, formData)

      if (response.success) {
        toast.success(response.message || ar.registration.buttons.submit)
        navigate("/pending-approval")
      } else {
        toast.error(response.message || ar.registration.errors.registrationFailed)
      }
    } catch (error: any) {
      const errorMessage = error?.message || ar.registration.errors.registrationFailed
      toast.error(errorMessage)
      console.error("[v0] Registration failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!session || !metadata) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted" dir="rtl">
        <Card className="border-0 shadow-lg">
          <CardContent className="pt-6">
            <div className="text-center">
              <Spinner className="mx-auto mb-4" size="lg" />
              <p className="text-muted-foreground">{ar.common.loading}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted px-4 py-12" dir="rtl">
      <div className="mx-auto max-w-md">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/login")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {ar.common.back}
        </Button>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>{ar.registration.title}</CardTitle>
            <CardDescription>{ar.registration.subtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name Fields */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ar.registration.fields.firstName}
                </label>
                <Input
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  placeholder={ar.registration.placeholders.firstName}
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ar.registration.fields.lastName}
                </label>
                <Input
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  placeholder={ar.registration.placeholders.lastName}
                  disabled={isLoading}
                />
              </div>

              {/* Email (Read-only) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ar.registration.fields.email}
                </label>
                <Input
                  type="email"
                  value={session?.email || ""}
                  disabled
                  className="bg-muted"
                />
              </div>

              {/* Gender - Rendered from backend metadata */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ar.registration.fields.gender}
                </label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  disabled={isLoading || !metadata}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{ar.common.loading}</option>
                  {metadata?.availableGenders.map((gender) => (
                    <option key={gender.value} value={gender.value}>
                      {gender.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Category - Rendered from backend metadata */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ar.registration.fields.category}
                </label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  disabled={isLoading || !metadata}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{ar.common.loading}</option>
                  {metadata?.availableCategories.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Parent Fields - Shown based on backend metadata */}
              {metadata?.requiresParentInformation && (
                <>
                  <div className="space-y-3 border-t pt-4">
                    <h4 className="font-medium text-foreground">{ar.registration.parentInfo.title}</h4>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        {ar.registration.parentInfo.parentName}
                      </label>
                      <Input
                        name="parentName"
                        value={formData.parentName || ""}
                        onChange={handleChange}
                        placeholder={ar.registration.placeholders.firstName}
                        disabled={isLoading}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        {ar.registration.parentInfo.parentPhone}
                      </label>
                      <Input
                        name="parentPhone"
                        type="tel"
                        value={formData.parentPhone || ""}
                        onChange={handleChange}
                        placeholder={ar.registration.placeholders.phone}
                        disabled={isLoading}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        {ar.registration.parentInfo.parentEmail}
                      </label>
                      <Input
                        name="parentEmail"
                        type="email"
                        value={formData.parentEmail || ""}
                        onChange={handleChange}
                        disabled={isLoading}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Adult Fields - Shown based on backend metadata */}
              {!metadata?.requiresParentInformation && formData.category && (
                <>
                  <div className="space-y-3 border-t pt-4">
                    <h4 className="font-medium text-foreground">{ar.registration.adultInfo.title}</h4>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        {ar.registration.adultInfo.phone}
                      </label>
                      <Input
                        name="phone"
                        type="tel"
                        value={formData.phone || ""}
                        onChange={handleChange}
                        placeholder={ar.registration.placeholders.phone}
                        disabled={isLoading}
                      />
                    </div>
                  </div>
                </>
              )}

              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    {ar.registration.buttons.submitting}
                  </>
                ) : (
                  ar.registration.buttons.submit
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
