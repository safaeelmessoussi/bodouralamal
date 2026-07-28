import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { ar } from "@/i18n/ar"
import { Spinner } from "@/components/ui/spinner"

interface RegistrationData {
  firstName: string
  lastName: string
  gender: "male" | "female" | ""
  category: "child" | "youth" | "woman" | ""
  phone?: string
  parentName?: string
  parentPhone?: string
  parentEmail?: string
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const [onboardingToken, setOnboardingToken] = useState<string | null>(null)
  const [email, setEmail] = useState<string>("")
  const [formData, setFormData] = useState<RegistrationData>({
    firstName: "",
    lastName: "",
    gender: "",
    category: "",
  })
  const [isLoading, setIsLoading] = useState(false)
  const [showParentFields, setShowParentFields] = useState(false)

  // Extract onboarding token from URL fragment
  useEffect(() => {
    const fragment = window.location.hash.slice(1)
    const params = new URLSearchParams(fragment)
    const token = params.get("onboarding_token")

    if (token) {
      setOnboardingToken(token)
      // Decode token to extract email (it's a JWT in base64url format)
      try {
        const payload = token.split(".")[0]
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
        setEmail(decoded.email || "")
        // TODO: backend should return whether this applicant is a minor
        // For now, we'll show parent fields if category is "child"
      } catch (error) {
        toast.error(ar.registration.errors.invalidToken)
        navigate("/login")
      }
    } else {
      navigate("/login")
    }
  }, [navigate])

  // Show parent fields based on category (this should be driven by backend metadata)
  useEffect(() => {
    setShowParentFields(formData.category === "child")
  }, [formData.category])

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

    if (showParentFields) {
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
      // TODO: Call backend registration endpoint once it's available
      // For now, store data in session and show pending approval
      sessionStorage.setItem("registration_data", JSON.stringify(formData))
      sessionStorage.setItem("oauth_destination", "/pending-approval")

      // This would normally call:
      // const response = await apiClient.register({
      //   onboarding_token: onboardingToken,
      //   first_name: formData.firstName,
      //   last_name: formData.lastName,
      //   gender: formData.gender,
      //   category: formData.category,
      //   phone: formData.phone,
      //   parent_name: formData.parentName,
      //   parent_phone: formData.parentPhone,
      //   parent_email: formData.parentEmail,
      // })

      toast.success(ar.registration.buttons.submit)
      // Redirect to pending approval page
      navigate("/pending-approval")
    } catch (error: any) {
      const errorMessage = error?.message || ar.registration.errors.registrationFailed
      toast.error(errorMessage)
      console.error("[v0] Registration failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!onboardingToken) {
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
                  value={email}
                  disabled
                  className="bg-muted"
                />
              </div>

              {/* Gender */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ar.registration.fields.gender}
                </label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  disabled={isLoading}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{ar.common.loading}</option>
                  <option value="male">{ar.registration.fields.maleLabel}</option>
                  <option value="female">{ar.registration.fields.femaleLabel}</option>
                </select>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {ar.registration.fields.category}
                </label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  disabled={isLoading}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{ar.common.loading}</option>
                  <option value="child">{ar.registration.fields.categoryChild}</option>
                  <option value="youth">{ar.registration.fields.categoryYouth}</option>
                  <option value="woman">{ar.registration.fields.categoryWoman}</option>
                </select>
              </div>

              {/* Parent Fields (shown only for minors) */}
              {showParentFields && (
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

              {/* Adult Fields */}
              {!showParentFields && formData.category && (
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
