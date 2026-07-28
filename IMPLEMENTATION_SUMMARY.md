# Bodour Al-Amal Frontend MVP - Implementation Summary

## Overview
Updated the frontend to match evolved requirements: Full Arabic localization, Google-only authentication, and separate registration flow with pending approval screen.

## Key Changes Implemented

### 1. **Localization (Arabic)**
- Created `/frontend/src/i18n/ar.ts` with 253 lines of Modern Standard Arabic strings
- All user-facing text now in العربية الفصحى
- Coverage includes: landing page, login, registration, admin pages, roles, status labels
- All validation messages and placeholders in Arabic

### 2. **Authentication Flow (Google Sign-In Only)**

#### Removed:
- Email/password login form
- Email/password registration form  
- Password fields entirely from the application
- Old registration page (email-based)

#### Implemented:
- **Login Page** (`/frontend/src/pages/login.tsx`):
  - Single Google Sign-In button
  - Association branding
  - Arabic explanation of the flow
  - Error handling for OAuth failures (user_denied, state_mismatch, account_deactivated)
  - Access token handled in URL fragment (TD-12 compliance - never in storage)

- **Registration Flow** (triggered after first Google sign-in):
  1. Backend redirects to `/register#onboarding_token=<token>` with verified identity
  2. Frontend extracts onboarding token from URL fragment
  3. User completes registration form
  4. Submission creates pending approval
  5. User sees pending approval screen
  6. After approval, future Google sign-ins enter the app directly

### 3. **Registration Adapter Pattern** (`/frontend/src/services/registration-adapter.ts`)

**Why this approach:**
- Backend contracts are still being designed (Claude's responsibility)
- Frontend must remain testable without backend
- Need clear isolation point for future API implementation

**Adapter Functions:**
- `extractOnboardingSession()` - Extracts and validates onboarding session from URL
  - TODO: Backend to define token format and payload structure
  - Currently uses mock data with fallback query params
  
- `submitRegistration()` - Submits registration data
  - TODO: Backend to define POST endpoint, request/response schemas
  - Currently stores locally in sessionStorage
  - Single replacement point once backend contract is ready
  
- `isMinor()` - Determines if applicant is a minor
  - TODO: Backend to define business logic (age? category? explicit flag?)
  - Currently: assumes "child" category means minor
  - Used to show/hide parent fields dynamically
  
- `getPendingRegistrationStatus()` - Polls registration status
  - TODO: Backend to define status endpoint and response format

### 4. **Registration Form** (`/frontend/src/pages/register.tsx`)

**Uses adapter pattern exclusively:**
- Calls `extractOnboardingSession()` to get user data
- Displays Google data (givenName, familyName, email)
- Calls `isMinor()` to determine field visibility
- Calls `submitRegistration()` on form submit

**Form Fields:**
- الاسم الشخصي (First Name) - auto-filled from Google
- الاسم العائلي (Last Name) - auto-filled from Google
- البريد الإلكتروني (Email) - read-only from Google
- الجنس (Gender) - required dropdown
- الفئة (Category) - required dropdown

**Dynamic Fields:**
- **For minors**: Parent/guardian name, phone, email
- **For adults**: Phone number
- Visibility determined by adapter function, ready for backend logic

**Key**: No backend assumptions - all calls go through adapter with clear TODO comments

### 5. **Pending Approval Page** (`/frontend/src/pages/pending-approval.tsx`)
- Informational messaging about the approval process
- Step-by-step guidance for applicants
- Contact information displayed
- Logout button available
- Clock icon to indicate waiting state

### 6. **UI Components & Layout**
- **New Component**: `Spinner` (`/frontend/src/components/ui/spinner.tsx`)
  - Loading indicator used in forms and buttons
  - Supports multiple sizes

- **RTL Implementation**:
  - All pages now have `dir="rtl"`
  - Layout adjusted for right-to-left text flow
  - Navigation, buttons, and spacing RTL-compliant

- **Landing Page Updates** (`/frontend/src/pages/landing.tsx`):
  - Arabic hero section
  - Feature cards in Arabic (Quran, Islamic Studies, Literacy, Progress Tracking)
  - Moroccan education institute tone (not SaaS language)
  - Hero CTA leads to login (Google Sign-In)

### 7. **Routes & Navigation**
- Updated `App.tsx` with new routes:
  - `/register` - Registration form (displayed after Google OAuth callback)
  - `/pending-approval` - Pending approval status screen
  - Maintained existing admin/teacher/parent/student routes

### 8. **Architecture & Security Compliance**

#### TD-12 (Security) Compliance:
- Onboarding token lives in URL fragment (`#onboarding_token=...`)
- Fragment never sent to server (no logs, no Referer header)
- Frontend stores token in memory only, not localStorage
- Access token extracted from fragment after OAuth callback
- Refresh tokens handled as HttpOnly cookies (backend)

#### Token Flow:
1. OAuth callback → `#access_token=<token>&#onboarding_token=<token>`
2. Fragment token stored in memory
3. Used for authenticated requests
4. Never persisted to localStorage (TD-12)

#### Form Submission:
- Onboarding token sent with registration data
- Backend validates token before creating user (prevents identity substitution)
- Single-use token consumed on successful registration
- No persisted state if form abandoned

### 8. **Error Handling**
- Toast notifications for all user interactions (Arabic)
- OAuth error states handled:
  - `user_denied` - User refused Google consent
  - `state_mismatch` - CSRF attempt or session issue
  - `account_deactivated` - Account disabled
- Form validation with specific Arabic error messages
- Network error handling with graceful fallbacks

### 9. **Testing Notes**
- Backend OAuth endpoints must be available:
  - `GET /api/v1/auth/google` - Initiates OAuth flow
  - `GET /api/v1/auth/google/callback` - Handles OAuth callback (redirects to `/register#onboarding_token=...` for new users)
- Registration form submission endpoint not yet implemented (backend stub ready)
- Pending approval status checks not yet implemented (placeholder screen)

## File Structure
```
frontend/src/
├── i18n/
│   └── ar.ts                    # Arabic strings (253 lines)
├── pages/
│   ├── landing.tsx              # Updated with Arabic content
│   ├── login.tsx                # Rewritten: Google-only flow
│   ├── register.tsx             # New: Onboarding form
│   └── pending-approval.tsx      # New: Status screen after registration
├── components/
│   └── ui/
│       └── spinner.tsx          # New: Loading spinner
└── App.tsx                       # Updated: Added new routes
```

## Backend Integration Points

### Required Endpoints (for full flow):
1. `GET /api/v1/auth/google` ✅ Exists
2. `GET /api/v1/auth/google/callback` ✅ Exists
3. `POST /api/v1/auth/register` ⏳ Needs implementation
4. `GET /api/v1/me` (or similar) - For fetching registration metadata
5. `POST /api/v1/auth/logout` ✅ Exists
6. `POST /api/v1/auth/refresh` ✅ Exists

### Optional (for enhanced UX):
- Registration/profile metadata endpoint to determine minor/adult status
- Approval status endpoint for pending approval page

## Design System
- **Language**: Modern Standard Arabic (العربية الفصحى)
- **Typography**: Geist font family for body and headings
- **Color Scheme**: Maintained existing brand green (#6BBF1A) with dark mode support
- **Layout**: Mobile-first, fully responsive
- **Direction**: Full RTL support throughout

## Breaking Changes
- ✅ Email/password authentication completely removed
- ✅ Password fields removed entirely
- ✅ Self-registration form removed
- ✅ All English text replaced with Arabic

## Next Steps for Backend Team

### Backend Contracts to Define (Once these are ready, frontend integration is straightforward):

1. **Onboarding Token Format** (`extractOnboardingSession()` adapter)
   - Token format: JWT, opaque string, or other?
   - Payload structure: what fields are included?
   - How is email/givenName/familyName passed to frontend?
   - See: `frontend/src/services/registration-adapter.ts:18-32`

2. **Registration Submission Endpoint** (`submitRegistration()` adapter)
   - URL: `POST /api/v1/...` (exact path)
   - Request payload schema (form fields to send)
   - Response payload schema (success/error handling)
   - Error codes and messages
   - See: `frontend/src/services/registration-adapter.ts:74-100`

3. **Minor Determination Logic** (`isMinor()` adapter)
   - How to determine if applicant is a minor?
   - Should it come from age calculation, category selection, backend metadata?
   - Currently: hardcoded to "child" category
   - See: `frontend/src/services/registration-adapter.ts:102-108`

4. **Registration Status Polling** (`getPendingRegistrationStatus()` adapter)
   - How to check approval status?
   - Poll endpoint vs. webhooks/websockets?
   - Status values (pending, approved, rejected, etc.)
   - See: `frontend/src/services/registration-adapter.ts:110-130`

### How to Integrate Backend APIs:
1. Replace adapter function implementations with real API calls
2. All adapter functions have TODO comments showing integration points
3. No changes needed to React components - they only use adapters
4. Test registration flow end-to-end after backend is ready

## Build Status
✅ **Build Successful** (with adapter pattern refactor)
- JavaScript: 644.43 KB (gzip: 192.73 KB)
- CSS: 97.84 KB (gzip: 16.16 KB)
- Total: ~209 KB gzipped

## Git History
- Commit: `bc93893` - "refactor: isolate backend dependencies behind registration adapter"
- Commit: `ed61092` - "feat: implement Arabic MVP with Google-only authentication"
- Branch: `bouthour-al-amal`
- All changes isolated behind adapter layer for easy backend integration
- Ready to merge to `develop` after backend contracts are finalized

## Testing Checklist
- [ ] Landing page displays in Arabic with RTL layout
- [ ] Login page shows only Google Sign-In button
- [ ] OAuth flow initiates correctly
- [ ] Google callback extracts onboarding token
- [ ] Registration form displays with all fields
- [ ] Dynamic fields appear/disappear based on category selection
- [ ] Form validation messages display in Arabic
- [ ] Registration submission creates pending approval
- [ ] Pending approval page shows informational content
- [ ] Logout functionality works correctly
- [ ] Dark mode toggle works
- [ ] Mobile responsive layout maintained
- [ ] All text is Arabic (no English placeholders)
