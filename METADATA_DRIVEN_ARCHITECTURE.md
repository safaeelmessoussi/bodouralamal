# Metadata-Driven Architecture

## Problem Solved

The initial frontend implementation had **hardcoded business logic** that violated the separation of concerns:

```typescript
// ❌ BEFORE: Hardcoded business logic in frontend
if (category === "child") {
  // Show parent fields
  setShowParentFields(true)
}
```

This violated core principles:
- Category names are **presentation data only**, not business logic
- **Only the backend** knows what eligibility rules mean
- Future changes to requirements (new categories, eligibility rules) required frontend code changes
- Frontend was tightly coupled to specific category names

## Solution: Backend-Supplied Metadata

The refactored approach uses **metadata from the backend** to drive all form behavior:

```typescript
// ✅ AFTER: Backend-supplied metadata drives behavior
const metadata = getRegistrationMetadata()
// Returns:
{
  registrationProfile: "adult" | "minor",
  requiresParentInformation: boolean,
  availableGenders: [{ value: "male", label: "ذكر" }, ...],
  availableCategories: [{ value: "child", label: "الطفل" }, ...],
}

// Frontend renders what backend tells it to show
{metadata.requiresParentInformation && <ParentFields />}
```

## Key Principles

### 1. Frontend Has No Business Logic

The frontend **never** decides:
- Who is a "minor" or "adult"
- Whether parent information is needed
- What categories exist or what they mean
- What eligibility rules apply

**All these decisions come from backend metadata.**

### 2. Metadata is Complete

Every decision the form needs to make comes from the metadata object:
- `registrationProfile` - is this an adult or minor registration?
- `requiresParentInformation` - should parent fields be shown?
- `availableGenders` - what gender options exist?
- `availableCategories` - what categories can this person select?
- `availableLevels` - optional education/group levels

### 3. Components are Purely Presentational

React components only know how to:
1. Load metadata
2. Render fields from metadata arrays
3. Show/hide sections based on metadata flags
4. Submit form data

They contain **zero** eligibility logic or business rules.

## Architecture Pattern

```
┌─────────────────────────────────────────────┐
│         React Component (RegisterPage)      │
│  - Purely presentational                    │
│  - Renders what metadata says               │
│  - No business logic                        │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│   Registration Adapter (Backend Interface)  │
│  - getRegistrationMetadata()                │
│  - extractOnboardingSession()               │
│  - submitRegistration()                     │
│  - getPendingRegistrationStatus()           │
└────────────────┬────────────────────────────┘
                 │
                 ▼
         ┌───────────────────┐
         │  Backend API      │
         │  (to implement)   │
         │  Returns metadata │
         │  that drives UI   │
         └───────────────────┘
```

## RegistrationMetadata Interface

```typescript
interface RegistrationMetadata {
  // Determines which conditional fields to show
  registrationProfile: "adult" | "minor"

  // Determines if parent information section is required
  requiresParentInformation: boolean

  // Available gender options (backend decides what's valid)
  availableGenders: Array<{
    value: string      // "male", "female", etc.
    label: string      // "ذكر", "أنثى", etc. (Arabic)
  }>

  // Available category options (backend decides what exists)
  availableCategories: Array<{
    value: string      // "child", "youth", "woman", etc.
    label: string      // "الطفل", "اليافعات", "المرأة", etc.
  }>

  // Optional: Educational levels or groups
  availableLevels?: Array<{
    value: string
    label: string
  }>
}
```

## Form Rendering Examples

### Gender Dropdown
```typescript
// Metadata-driven - no hardcoded "male"/"female"
{metadata?.availableGenders.map((gender) => (
  <option key={gender.value} value={gender.value}>
    {gender.label}
  </option>
))}
```

### Category Dropdown
```typescript
// Metadata-driven - no hardcoded categories
{metadata?.availableCategories.map((category) => (
  <option key={category.value} value={category.value}>
    {category.label}
  </option>
))}
```

### Conditional Fields
```typescript
// Based on metadata flag, NOT category name
{metadata?.requiresParentInformation && (
  <ParentInformationFields />
)}

{!metadata?.requiresParentInformation && (
  <AdultInformationFields />
)}
```

## Validation

Form validation also uses metadata instead of hardcoded rules:

```typescript
// ✅ Right: Metadata-driven
if (metadata?.requiresParentInformation) {
  if (!formData.parentName?.trim()) {
    toast.error("اسم ولي الأمر مطلوب")
    return false
  }
}

// ❌ Wrong: Hardcoded logic
if (formData.category === "child") {  // Never do this
  // ...
}
```

## Backend Contract: getRegistrationMetadata()

The adapter calls this function to get metadata:

```typescript
const metadata = getRegistrationMetadata()
```

**Until backend is ready**: Returns mock metadata
```typescript
export function getRegistrationMetadata(): RegistrationMetadata {
  // TODO: Replace with real API call
  return {
    registrationProfile: "adult",
    requiresParentInformation: false,
    availableGenders: [
      { value: "male", label: "ذكر" },
      { value: "female", label: "أنثى" },
    ],
    availableCategories: [
      { value: "child", label: "الطفل" },
      { value: "youth", label: "اليافعات" },
      { value: "woman", label: "المرأة" },
    ],
  }
}
```

**When backend is ready**: Call real API
```typescript
export function getRegistrationMetadata(): RegistrationMetadata {
  const response = await apiClient.get("/registration/metadata")
  return response.data
}
```

## Benefits

1. **Zero Coupling**: Frontend doesn't know about business rules
2. **Easy Changes**: New categories only require backend changes
3. **Future-Proof**: New roles/profiles need no frontend code changes
4. **Scalability**: Works with any number of categories/genders/levels
5. **Testability**: Mock metadata makes testing different scenarios trivial
6. **Clarity**: Business rules live where they belong (backend)

## Example: Adding a New Category

### ❌ Old Way (Frontend Changes Required)
1. Backend adds new category "teenagers"
2. Frontend developer adds to hardcoded list
3. Frontend code change required
4. Deploy frontend

### ✅ New Way (Backend Only)
1. Backend adds new category "teenagers" to metadata endpoint
2. Frontend automatically shows it
3. No frontend changes needed
4. Deploy only backend

## Testing with Different Metadata

Because metadata drives everything, testing different scenarios is as simple as changing mock metadata:

```typescript
// Test adult flow
const adultMetadata = {
  registrationProfile: "adult",
  requiresParentInformation: false,
  // ...
}

// Test minor flow
const minorMetadata = {
  registrationProfile: "minor",
  requiresParentInformation: true,
  // ...
}

// Test with different categories
const customMetadata = {
  availableCategories: [
    { value: "group1", label: "المجموعة الأولى" },
    { value: "group2", label: "المجموعة الثانية" },
  ],
  // ...
}
```

## Next Steps for Backend Team

Define the backend contract for `getRegistrationMetadata()`:

1. **Endpoint**: What is the URL? When should it be called?
   - Example: `GET /api/v1/registration/metadata`
   - Called: After Google authentication, before showing registration form

2. **Response Schema**: What does metadata endpoint return?
   ```json
   {
     "registration_profile": "adult|minor",
     "requires_parent_information": boolean,
     "available_genders": [...],
     "available_categories": [...],
     "available_levels": [...]
   }
   ```

3. **How to Determine Metadata**: Backend business logic
   - How to determine if someone is adult vs minor?
   - Should parent info be required for everyone in a category, or only for some?
   - What rules apply to gender selection?

4. **Caching/Invalidation**: Can metadata be cached?
   - Change frequency?
   - Must be fresh for every registration?

Once defined, integration is a one-function update to the adapter.

## Architecture Advantages Over Previous Approach

| Aspect | Before (Hardcoded) | After (Metadata) |
|--------|-------------------|-----------------|
| Business Logic | In React components | In backend metadata |
| Add New Category | Modify React code | Backend change only |
| Change Eligibility | Modify React code | Backend change only |
| Test Scenarios | Mock at component level | Mock metadata object |
| Code Coupling | High (category names) | Zero (generic arrays) |
| Future Maintenance | Difficult | Easy |
