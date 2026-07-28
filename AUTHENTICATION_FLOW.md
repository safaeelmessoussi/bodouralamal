# Bodour Al-Amal: Authentication & Registration Flow

## Overview
The authentication system implements Google OAuth 2.0 with a separate registration flow as specified in SRS §4.1b.

---

## Authentication Flow Diagram

### New User Flow (First-Time Login)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Landing Page                               │
│  (مرحبا بكم في بذور الأمل - Welcome to Bodour Al-Amal)          │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │  User clicks "سجل الآن"     │
         │  (Register Now)             │
         └──────────┬──────────────────┘
                    │
                    ▼
         ┌──────────────────────────┐
         │  Navigate to /login      │
         └──────────┬───────────────┘
                    │
                    ▼
    ┌────────────────────────────────────┐
    │      Login Page (/login)           │
    │  - App Logo                        │
    │  - "تسجيل الدخول عبر جوجل"       │
    │  - Single Google Sign-In Button    │
    └────────────┬─────────────────────┘
                 │
                 │ User clicks Google button
                 ▼
    ┌────────────────────────────────────────────┐
    │  GET /api/v1/auth/google                  │
    │  - Generate PKCE code challenge            │
    │  - Create flow state (secure random)       │
    │  - Issue flow state cookie (10 min TTL)    │
    │  - Redirect to Google OAuth                │
    └────────────┬───────────────────────────────┘
                 │
                 ▼
    ┌────────────────────────────────────────────┐
    │   Google OAuth Consent Screen              │
    │   (User signs in with Google account)      │
    └────────────┬───────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
    [Approved]        [Denied]
        │                 │
        ▼                 ▼
    Google calls      Redirect to
    callback with     /login?error=
    code & state      user_denied
        │                 │
        │                 └──────────┐
        │                            │
        ▼                            │
    ┌─────────────────────────────────┐
    │GET /api/v1/auth/google/callback │
    │ - Verify PKCE challenge         │
    │ - Exchange code for tokens      │
    │ - Extract email & provider ID   │
    └────────────┬────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
         ▼                ▼
    [Bound]          [Onboarding]
    Identity exists  (New user)
         │                │
         └────────┬───────┘
                  ▼
         ┌──────────────────────────┐
         │ Backend Decision:         │
         │ - Route based on status   │
         │ - Active → Dashboard      │
         │ - Pending → Approval      │
         │ - New → Registration      │
         └──────────┬───────────────┘
                    │
      ┌─────────────┼─────────────┐
      │             │             │
      ▼             ▼             ▼
 [Active]     [Pending]       [Onboarding]
      │             │             │
      │             │             ▼
      │             │      ┌──────────────────────┐
      │             │      │/register#onboarding_ │
      │             │      │token=<TOKEN>         │
      │             │      └──────────┬───────────┘
      │             │                 │
      │             │                 ▼
      │             │      ┌──────────────────────────────────┐
      │             │      │  Registration Page               │
      │             │      │  (/register)                     │
      │             │      │                                  │
      │             │      │  • Extract token from fragment   │
      │             │      │  • Decode to get email           │
      │             │      │                                  │
      │             │      │  Form Fields:                    │
      │             │      │  ✓ الاسم الشخصي (First Name)   │
      │             │      │  ✓ الاسم العائلي (Last Name)   │
      │             │      │  ✓ البريد (Email - Read Only)  │
      │             │      │  ✓ الجنس (Gender)              │
      │             │      │  ✓ الفئة (Category)            │
      │             │      │                                  │
      │             │      │  Conditional Fields:             │
      │             │      │  ? Parent info (if minor)        │
      │             │      │  ? Phone (if adult)              │
      │             │      │  ? Occupation (if adult)         │
      │             │      └──────────┬───────────────────────┘
      │             │                 │
      │             │                 │ User fills form
      │             │                 ▼
      │             │      ┌──────────────────────────────┐
      │             │      │ User clicks "إرسال الطلب"   │
      │             │      │ (Submit Request)             │
      │             │      └──────────┬──────────────────┘
      │             │                 │
      │             │                 ▼
      │             │      ┌──────────────────────────────┐
      │             │      │ POST /api/v1/auth/register   │
      │             │      │ (BACKEND - NOT YET IMPL)     │
      │             │      │                              │
      │             │      │ Payload:                     │
      │             │      │ {                            │
      │             │      │   onboarding_token: string,  │
      │             │      │   first_name: string,        │
      │             │      │   last_name: string,         │
      │             │      │   gender: "male"|"female",   │
      │             │      │   category: "child"|...,     │
      │             │      │   phone?: string,            │
      │             │      │   parent_name?: string,      │
      │             │      │   parent_phone?: string,     │
      │             │      │   parent_email?: string      │
      │             │      │ }                            │
      │             │      └──────────┬──────────────────┘
      │             │                 │
      │             │                 ▼
      │             │      ┌──────────────────────────────┐
      │             │      │ Backend Validation:          │
      │             │      │ - Token valid?               │
      │             │      │ - Token not expired?         │
      │             │      │ - Create User record         │
      │             │      │ - Mark as "pending"          │
      │             │      │ - Consume token              │
      │             │      └──────────┬──────────────────┘
      │             │                 │
      │             │                 ▼
      │             │      ┌──────────────────────────────┐
      │             │      │ /pending-approval            │
      │             │      │ (Approval Status Screen)     │
      │             │      │                              │
      │             │      │ Shows:                       │
      │             │      │ • Waiting icon               │
      │             │      │ • "طلبك قيد المراجعة"      │
      │             │      │ • Next steps                 │
      │             │      │ • Contact info               │
      │             │      │ • Logout button              │
      │             │      └──────────┬──────────────────┘
      │             │                 │
      │             │      ┌──────────┘
      │             │      │
      ▼             ▼      ▼
    /dashboard   /pending-approval  [Waiting for approval]
  (Dashboard)   (Status screen)           │
      │                                    │
      │                  ┌─────────────────┘
      │                  │
      │        [Admin approves user]
      │        [User accountStatus]
      │        [changed to "active"]
      │                  │
      └──────────────────┘
             │
             ▼
    ┌──────────────────────┐
    │ User logs in again   │
    │ (OAuth flow)         │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────────┐
    │ GET /api/v1/auth/google  │
    │ (Same as before)         │
    └──────────┬───────────────┘
               │
               ▼
    ┌──────────────────────────┐
    │ GET /api/v1/auth/        │
    │ google/callback          │
    └──────────┬───────────────┘
               │
               ▼
    ┌──────────────────────────┐
    │ Identity already bound   │
    │ & user is active         │
    │ → Issue session tokens   │
    │ → Redirect to /dashboard │
    └──────────┬───────────────┘
               │
               ▼
    ┌──────────────────────────┐
    │   Dashboard/App          │
    │   (Full access)          │
    └──────────────────────────┘
```

---

## Returning User Flow (Approved Account)

```
Landing → Login → Google OAuth → Callback → Dashboard
                                 (Identity bound + active)
```

---

## Returning User Flow (Account Pending)

```
Landing → Login → Google OAuth → Callback → Pending Approval Screen
                                 (Identity bound + pending status)
```

---

## Error Scenarios

### Scenario 1: User Denies Consent
```
Google OAuth → User denies → Google redirects with error param
                            → /login?error=user_denied
                            → Toast: "لقد رفضت تسجيل الدخول"
```

### Scenario 2: CSRF/State Mismatch
```
Flow state cookie → Google callback → State mismatch detected
                                    → Logged as security event
                                    → /login?error=state_mismatch
```

### Scenario 3: Account Deactivated
```
OAuth flow → Identity found → Account status = "rejected"|"suspended"|deleted
                            → /login?error=account_deactivated
```

### Scenario 4: Registration Token Expired
```
User completes form → 10 minutes pass → Submit registration
                    → Token validation fails (exp check)
                    → Toast: "انتهت صلاحية رمز التفعيل"
```

---

## Token Handling (TD-12 Compliance)

### Onboarding Token
- **Issued**: During OAuth callback for new users
- **Format**: JWT (base64url encoded)
- **Content**: 
  ```json
  {
    "email": "user@example.com",
    "provider_subject_id": "google-subject-id",
    "jti": "unique-token-id",
    "iat": 1234567890,
    "exp": 1234568490
  }
  ```
- **TTL**: 10 minutes
- **Delivery**: URL fragment (`#onboarding_token=...`)
- **Storage**: Memory only (never localStorage per TD-12)
- **Usage**: Submitted with registration form
- **Lifetime**: Single-use (consumed on registration)

### Access Token
- **Issued**: After OAuth callback for approved users
- **Format**: JWT
- **Delivery**: URL fragment (`#access_token=...`)
- **Storage**: Memory only (never localStorage per TD-12)
- **Usage**: Authorization header for API requests
- **Refresh**: Via refresh token (HttpOnly cookie)

### Refresh Token
- **Issued**: After OAuth callback
- **Format**: Opaque token
- **Storage**: HttpOnly cookie (server-side managed)
- **Scope**: Path `/api/v1/auth/refresh` only
- **Usage**: Token rotation (kept encrypted, single-use)

---

## API Endpoint Summary

### Authentication Endpoints
| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/auth/google` | GET | Start OAuth flow | ✅ Implemented |
| `/auth/google/callback` | GET | OAuth callback handler | ✅ Implemented |
| `/auth/register` | POST | Submit registration | ⏳ Needs implementation |
| `/auth/logout` | POST | Revoke session | ✅ Implemented |
| `/auth/refresh` | POST | Rotate tokens | ✅ Implemented |
| `/me` | GET | Get current user | ✅ Implemented |

---

## Security Considerations

### CSRF Protection
- Flow state cookie signed with JWT_SIGNING_KEY
- State parameter validated against cookie
- 10-minute TTL prevents replay attacks
- Single-use flag enforced per request

### Identity Verification
- Onboarding token carries verified Google identity
- Server reads email & provider_subject_id from token (not body)
- Prevents client-side identity substitution (§20 rule 9)

### Rate Limiting
- Applied to OAuth endpoints (prevent brute-force)
- Applied to registration endpoint (prevent spam)

### Session Management
- Refresh token rotation on every use (TD-15)
- Token binding to user prevents sharing
- Concurrent logins supported (per-session tracking)
- Logout revokes only current session (other devices unaffected)

---

## Frontend Implementation Details

### Registration Form Logic
```typescript
// Dynamic field visibility (controlled by backend response)
if (user.isMinor) {
  // Show parent info fields
  // backend determines minor status from submitted category + Google age data
} else {
  // Show adult-specific fields (phone, occupation)
}
```

### Important: No hardcoded logic
- Category names (الطفل/اليافعات/المرأة) are **presentation only**
- Frontend never infers permissions from category
- All business logic delegated to backend
- Easy to add future categories without code changes

---

## Error Messages (Arabic)

| Code | Message | Resolution |
|------|---------|-----------|
| `user_denied` | "لقد رفضت تسجيل الدخول عبر جوجل" | User must retry and approve |
| `state_mismatch` | "حدث خطأ في المصادقة" | Clear cookies, retry from login |
| `account_deactivated` | "حسابك معطل حالياً" | Contact admin |
| `token_expired` | "انتهت صلاحية رمز التفعيل" | Restart registration flow |
| `invalid_token` | "رمز التفعيل غير صحيح" | Restart from login |

---

## Testing the Flow

### Local Development
```bash
# Start dev server
cd frontend && npm run dev

# Test new user registration
1. Go to http://localhost:5173
2. Click "سجل الآن" → goes to /login
3. Click Google Sign-In button
4. Complete Google OAuth
5. Fill registration form
6. Submit → shows pending approval
7. Verify pending approval page displays correctly
```

### OAuth Configuration
- Ensure backend has Google OAuth credentials configured
- Redirect URI: `http://localhost:5173/api/v1/auth/google/callback`
- `PUBLIC_BASE_URL` must be set to frontend base URL

---

## Future Enhancements (Post-MVP)

- [ ] Magic link authentication (alternative to OAuth)
- [ ] Social login (Facebook, Apple)
- [ ] Account recovery flow
- [ ] Permission-based access control (beyond roles)
- [ ] Session management UI (view/revoke active sessions)
- [ ] Two-factor authentication (2FA)
