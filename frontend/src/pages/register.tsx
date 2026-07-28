import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { ar } from "@/i18n/ar"
import { Spinner } from "@/components/ui/spinner"
import { FormField } from "@/components/form/form-field"
import { FormSelect } from "@/components/form/form-select"
import { ErrorAlert } from "@/components/form/error-alert"
import { SuccessAlert } from "@/components/form/success-alert"
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
  const [errors, setErrors] = useState<Record<string, string>>({})

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
    // Clear error for this field when user starts editing
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }))
    }
  }

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.firstName.trim()) {
      newErrors.firstName = ar.registration.validation.firstNameRequired
    }
    if (!formData.lastName.trim()) {
      newErrors.lastName = ar.registration.validation.lastNameRequired
    }
    if (!formData.gender) {
      newErrors.gender = ar.registration.validation.genderRequired
    }
    if (!formData.category) {
      newErrors.category = ar.registration.validation.categoryRequired
    }

    // Validate conditional fields based on backend metadata
    if (metadata?.requiresParentInformation) {
      if (!formData.parentName?.trim()) {
        newErrors.parentName = "اسم ولي الأمر مطلوب"
      }
      if (!formData.parentPhone?.trim()) {
        newErrors.parentPhone = ar.registration.validation.phoneRequired
      }
    } else {
      if (!formData.phone?.trim()) {
        newErrors.phone = ar.registration.validation.phoneRequired
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
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
              <FormField
                name="firstName"
                label={ar.registration.fields.firstName}
                value={formData.firstName}
                onChange={handleChange}
                placeholder={ar.registration.placeholders.firstName}
                disabled={isLoading}
                error={errors.firstName}
                required
              />

              <FormField
                name="lastName"
                label={ar.registration.fields.lastName}
                value={formData.lastName}
                onChange={handleChange}
                placeholder={ar.registration.placeholders.lastName}
                disabled={isLoading}
                error={errors.lastName}
                required
              />

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
              <FormSelect
                name="gender"
                label={ar.registration.fields.gender}
                value={formData.gender}
                onChange={handleChange}
                disabled={isLoading || !metadata}
                options={metadata?.availableGenders || []}
                placeholder={ar.common.loading}
                error={errors.gender}
                required
              />

              {/* Category - Rendered from backend metadata */}
              <FormSelect
                name="category"
                label={ar.registration.fields.category}
                value={formData.category}
                onChange={handleChange}
                disabled={isLoading || !metadata}
                options={metadata?.availableCategories || []}
                placeholder={ar.common.loading}
                error={errors.category}
                required
              />

              {/* Parent Fields - Shown based on backend metadata */}
              {metadata?.requiresParentInformation && (
                <>
                  <div className="space-y-3 border-t pt-4">
                    <h4 className="font-medium text-foreground">{ar.registration.parentInfo.title}</h4>

                    <FormField
                      name="parentName"
                      label={ar.registration.parentInfo.parentName}
                      value={formData.parentName || ""}
                      onChange={handleChange}
                      placeholder={ar.registration.placeholders.firstName}
                      disabled={isLoading}
                      error={errors.parentName}
                      required
                    />

                    <FormField
                      name="parentPhone"
                      type="tel"
                      label={ar.registration.parentInfo.parentPhone}
                      value={formData.parentPhone || ""}
                      onChange={handleChange}
                      placeholder={ar.registration.placeholders.phone}
                      disabled={isLoading}
                      error={errors.parentPhone}
                      required
                    />

                    <FormField
                      name="parentEmail"
                      type="email"
                      label={ar.registration.parentInfo.parentEmail}
                      value={formData.parentEmail || ""}
                      onChange={handleChange}
                      disabled={isLoading}
                    />
                  </div>
                </>
              )}

              {/* Adult Fields - Shown based on backend metadata */}
              {!metadata?.requiresParentInformation && formData.category && (
                <>
                  <div className="space-y-3 border-t pt-4">
                    <h4 className="font-medium text-foreground">{ar.registration.adultInfo.title}</h4>

                    <FormField
                      name="phone"
                      type="tel"
                      label={ar.registration.adultInfo.phone}
                      value={formData.phone || ""}
                      onChange={handleChange}
                      placeholder={ar.registration.placeholders.phone}
                      disabled={isLoading}
                      error={errors.phone}
                      required
                    />
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
