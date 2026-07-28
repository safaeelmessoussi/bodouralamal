# Registration Adapter Pattern - Integration Guide

## Overview

The frontend uses an **adapter pattern** to isolate all backend dependencies into a single service layer (`src/services/registration-adapter.ts`). This allows the UI to remain fully functional and testable while backend contracts are being finalized.

## Key Principle

**No backend contracts are assumed in React components.** All backend calls go through adapter functions, each clearly marked with TODO comments explaining what backend information is pending.

## Critical Architectural Rule

**The frontend contains NO business logic. All decisions are driven by backend-supplied metadata.**

- Frontend never infers eligibility from category names
- Frontend never assumes what fields mean or who needs them
- Backend supplies complete metadata that tells frontend exactly what to render
- React components are purely presentational

Example: "Showing parent fields" is NOT decided by `category === "child"` in the frontend. Instead, the backend metadata field `requiresParentInformation: true` drives this decision.

## Adapter Functions

### 0. `getRegistrationMetadata()` - NEW

**Purpose**: Get metadata that controls form behavior (backend business logic)

**Current Implementation**: Mock metadata in adapter
```typescript
const metadata = getRegistrationMetadata()
// Returns:
{
  registrationProfile: "adult" | "minor",
  requiresParentInformation: boolean,
  availableGenders: [{ value: string, label: string }, ...],
  availableCategories: [{ value: string, label: string }, ...],
  availableLevels?: [...]
}
```

**What the Backend Team Needs to Define**:
- [ ] API endpoint that returns this metadata (called after authentication)
- [ ] How to determine `registrationProfile` (adult vs minor)?
  - Option A: Based on age from Google profile?
  - Option B: Based on previous registration preferences?
  - Option C: Explicit user selection during flow?
- [ ] How to determine `requiresParentInformation`?
  - Always true if minor, false if adult?
  - Any other factors?
- [ ] What are ALL possible gender options (not just male/female)?
- [ ] What are ALL possible categories and their labels?
- [ ] Are there levels/groups to display?

**File Reference**: `frontend/src/services/registration-adapter.ts:124-170`

**After Backend is Ready**:
```typescript
export function getRegistrationMetadata(): RegistrationMetadata {
  // Replace with real API call:
  const response = await apiClient.get("/registration/metadata")
  return response.data
}
```

**Impact**: Once this endpoint works, the form automatically adapts to any changes in:
- Gender options
- Category options
- Adult/minor eligibility rules
- Parent information requirements
- Future fields or levels

---

### 1. `extractOnboardingSession()`

**Purpose**: Extract and validate onboarding session from URL fragment

**Current Implementation**: Mock data with fallback query parameters
```typescript
// URL Fragment Format: #onboarding_token=<TOKEN>&email=user@example.com&given_name=John&family_name=Doe
```

**What the Backend Team Needs to Define**:
- [ ] Onboarding token format (JWT, opaque string, ULID, etc.)
- [ ] Token payload structure (what fields must be included?)
- [ ] How to pass givenName and familyName to frontend
- [ ] Token TTL and validation rules

**File Reference**: `frontend/src/services/registration-adapter.ts:46-70`

**After Backend is Ready**:
```typescript
// Replace mock implementation with real token parsing:
// 1. If JWT: Decode and validate signature
// 2. If opaque: Trust what backend returned in fragment
// 3. Validate required fields (email, givenName, familyName)
```

---

### 2. `submitRegistration()`

**Purpose**: Submit completed registration form to backend

**Current Implementation**: Stores data in `sessionStorage` (mock)
```typescript
await submitRegistration(onboardingToken, formData)
// Returns: { success: true, message: "...", registrationId: "REG-..." }
```

**What the Backend Team Needs to Define**:
- [ ] Exact API endpoint URL (e.g., `POST /api/v1/register`)
- [ ] Request payload schema:
  ```json
  {
    "onboarding_token": "...",
    "first_name": "...",
    "last_name": "...",
    "gender": "male" | "female",
    "category": "child" | "youth" | "woman",
    "phone": "...",
    "parent_name": "...",
    "parent_phone": "...",
    "parent_email": "..."
  }
  ```
- [ ] Response payload schema (success and error cases)
- [ ] Error codes and messages (validation failures, token expired, etc.)
- [ ] Whether to create `accountStatus: "pending"` or need approval step

**File Reference**: `frontend/src/services/registration-adapter.ts:99-123`

**After Backend is Ready**:
```typescript
// Replace mock with real API call:
export async function submitRegistration(
  onboardingToken: string,
  formData: RegistrationFormData
): Promise<RegistrationResponse> {
  return apiClient.request("POST", "/api/v1/register", {
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
}
```

---

### 3. `isMinor()`

**Purpose**: Determine if applicant requires parent/guardian information

**Current Implementation**: Assumes `category === "child"` means minor
```typescript
setShowParentFields(isMinor(formData.category))
// If true: show parent fields
// If false: show adult fields (phone, occupation, etc.)
```

**What the Backend Team Needs to Define**:
- [ ] How is "minor" status determined?
  - By age (calculate from DOB)?
  - By category selection?
  - By explicit backend metadata?
  - Combination of the above?
- [ ] Should this logic live on frontend or backend?
  - Option A: Backend returns metadata with registration data
  - Option B: Frontend hardcodes rule (less flexible)
  - **Recommended**: Option A - backend metadata endpoint

**File Reference**: `frontend/src/services/registration-adapter.ts:133-139`

**After Backend is Ready (Recommended Approach)**:
```typescript
// Create a metadata endpoint that returns:
// GET /api/v1/register/metadata?category=child&gender=female
// Response: { is_minor: true, required_fields: ["parent_name", "parent_phone", ...] }

export async function getRegistrationMetadata(category: string): Promise<{
  is_minor: boolean
  required_fields: string[]
}> {
  return apiClient.request("GET", `/api/v1/register/metadata?category=${category}`)
}

// Then in component:
useEffect(() => {
  const metadata = await getRegistrationMetadata(formData.category)
  setShowParentFields(metadata.is_minor)
}, [formData.category])
```

---

### 4. `getPendingRegistrationStatus()`

**Purpose**: Check registration approval status

**Current Implementation**: Returns mock pending status
```typescript
const status = await getPendingRegistrationStatus()
// Returns: { status: "pending" | "approved" | "rejected", message: "..." }
```

**What the Backend Team Needs to Define**:
- [ ] How to check if registration was approved?
  - Poll endpoint? WebSocket? Server-sent events?
  - Update OAuth callback to redirect directly when approved?
- [ ] Status values (pending, approved, rejected, more details?)
- [ ] Response format and error handling

**File Reference**: `frontend/src/services/registration-adapter.ts:141-159`

**After Backend is Ready (Option 1 - Polling)**:
```typescript
export async function getPendingRegistrationStatus(): Promise<{
  status: "pending" | "approved" | "rejected"
  message: string
}> {
  return apiClient.request("GET", "/api/v1/register/status")
}

// Then poll in component:
useEffect(() => {
  const interval = setInterval(async () => {
    const status = await getPendingRegistrationStatus()
    if (status.status === "approved") {
      navigate("/login")
    }
  }, 5000) // Check every 5 seconds
  return () => clearInterval(interval)
}, [])
```

**After Backend is Ready (Option 2 - OAuth Callback)**:
```typescript
// Backend OAuth callback automatically routes:
// - New users → /register#onboarding_token=...
// - Pending users → /pending-approval
// - Approved users → /dashboard
// No frontend polling needed
```

---

## How the Form Uses Metadata

The registration form (`src/pages/register.tsx`) is purely presentational:

```typescript
// 1. Load metadata
const metadata = getRegistrationMetadata()

// 2. Render gender options from metadata (not hardcoded)
metadata.availableGenders.map(gender => (
  <option value={gender.value}>{gender.label}</option>
))

// 3. Render category options from metadata (not hardcoded)
metadata.availableCategories.map(category => (
  <option value={category.value}>{category.label}</option>
))

// 4. Show/hide parent fields based on metadata flag (not category name)
{metadata.requiresParentInformation && (
  // Parent fields JSX
)}

// 5. Show/hide adult fields based on metadata (not business logic)
{!metadata.requiresParentInformation && (
  // Adult fields JSX
)}
```

**Key Result**: Zero frontend business logic. Backend changes (new categories, changing eligibility rules) require only backend changes. Frontend adapts automatically.

---

## Integration Checklist

When backend contracts are ready:

### Step 1: Define Contracts
- [ ] Registration metadata endpoint - what it returns and when
- [ ] Onboarding token format and payload
- [ ] Registration submission endpoint (URL, request, response)
- [ ] Approval status mechanism (polling endpoint vs OAuth callback)

### Step 2: Update Adapter Functions (in `registration-adapter.ts`)
- [ ] Replace `getRegistrationMetadata()` mock with real API call
- [ ] Replace `extractOnboardingSession()` mock
- [ ] Replace `submitRegistration()` mock
- [ ] Replace `getPendingRegistrationStatus()` mock

### Step 3: Test Registration Flow
- [ ] Onboarding session extracts correctly
- [ ] Form pre-fills with Google data
- [ ] Dynamic fields show/hide properly
- [ ] Submission creates pending registration
- [ ] Status page updates when approved

### Step 4: Merge to Develop
- [ ] All adapter functions call real API
- [ ] No TODO comments remain
- [ ] All tests pass
- [ ] Ready for production

---

## Current Status

**Architecture**: ✅ No business logic in frontend
- Metadata-driven form rendering
- All eligibility decisions in adapter
- All category/gender/level data from backend metadata

**Adapter Functions**: ✅ All implemented with mock metadata and TODO comments
- `getRegistrationMetadata()` - NEW: Returns all form structure metadata
- `extractOnboardingSession()` - Extracts Google user data
- `submitRegistration()` - Submits form data
- `getPendingRegistrationStatus()` - Checks approval status

**React Components**: ✅ Purely presentational
- Register form renders from metadata arrays
- Parent/adult fields visibility from metadata flag
- Validation uses metadata requirements
- Zero hardcoded business rules

**Testing**: ✅ Fully functional with mock data
- Form adapts to different metadata values
- Change metadata → form changes automatically
- Ready for backend integration

**Files to Modify When Backend is Ready**:
- `frontend/src/services/registration-adapter.ts` (only file that needs changes)

**Files That Need NO Changes**:
- `frontend/src/pages/register.tsx`
- `frontend/src/pages/pending-approval.tsx`
- `frontend/src/pages/login.tsx`
- All components use adapters transparently

---

## Backend Team: Questions to Answer

When designing the registration endpoints, answer these questions:

1. **Token Format**: How is the onboarding token formatted and validated?
2. **Request Payload**: What fields does `POST /register` accept?
3. **Response Payload**: What does success/error response look like?
4. **Minor Logic**: How is "minor" status determined and communicated to frontend?
5. **Approval Flow**: Poll, webhook, OAuth redirect, or other?
6. **Error Handling**: What are the possible error codes?
7. **Validation**: What validations happen on backend vs. frontend?

Once these are answered, update `registration-adapter.ts` and all tests pass automatically.
