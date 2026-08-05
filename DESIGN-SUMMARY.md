# Bodour Al Amal Landing Page Redesign — Executive Summary

## What's Changing

### Information Architecture
**From**: Platform-first (feature list, how to use the app)
**To**: Mission-first (who we are, why to trust, how to join)

**New Section Order**:
1. Navigation (redesigned visually)
2. Hero (completely redesigned, mission-focused)
3. Since 2011 (NEW credibility section)
4. Why Families Trust Us (NEW trust-building section)
5. Our Community (NEW human connection section)
6. How We Educate (Reframed as educational philosophy)
7. Our Centers (Branches redesigned as community institutions)
8. Upcoming Activities (Calendar redesigned as community invitations)
9. Learning Resources (Redesigned as curated materials)
10. Ready to Join Us (Closing CTA with multiple pathways)
11. Footer (Completely redesigned, institutional aesthetic)

### Visitor Journey
**5-Second Test**: Within the first 30 seconds, visitor understands:
- ✅ **What**: Bodour Al Amal is an educational community in Marrakech
- ✅ **Who**: Women (adults, teens) and children
- ✅ **Why**: Operating since 2011, professional, documented results, community partnerships
- ✅ **Action**: Join Our Community (clear CTA)

## What's NOT Changing

### Absolute Constraints
- ✅ Backend code, API contracts, data models
- ✅ Authentication (Google OAuth)
- ✅ Routing (all pages, all destinations)
- ✅ Menu entries and footer links (navigation destinations)
- ✅ Data-fetching behavior (branches, calendar, resources APIs)
- ✅ All business logic and user interactions

### Backend-Driven Sections (Same Data, New Presentation)
- **Branches**: Same API (`GET /api/branches`), same data, new institutional context ("Our Network Across Marrakech")
- **Calendar**: Same API events, same registration behavior, new invitational presentation ("Join Us: Upcoming Programs")
- **Resources**: Same API resources, same file links, new curated presentation ("Educational Materials for Your Journey")
- **Statistics**: Same metrics, same data sources, new narrative context

## Design Direction

### Aesthetic
- **NOT**: SaaS landing page (gradients, startup vibes, product-focused)
- **YES**: Premium educational institution (university, cultural center, foundation aesthetic)
- **Feeling**: Calm, warm, professional, rooted in Moroccan community

### Tone of Voice
- **NOT**: "Sign up for our platform"
- **YES**: "Join our community"
- **NOT**: Generic features
- **YES**: Specific, outcome-focused, warm language

### Visual Language
- **Components**: Reuse existing UI components (Card, Container, Button, etc.)
- **New Components**: Create only if they significantly improve storytelling
- **Colors**: Institutional palette (warm earth tones, Moroccan identity)
- **Typography**: Clean hierarchy, readable on all devices
- **Spacing**: Generous padding, breathing room between sections (calm, not cramped)
- **Imagery**: Warm, human, community-focused (not tech-focused)

## Key Content Principles

### From Source Material (Grounded in PDF + Video)
- **Longevity**: "Since 2011, 13 years of service" (not a startup)
- **Scale**: "400 women, 340 children" (documented, specific)
- **Integrated Model**: Education + meals + housing + healthcare + community (not just classes)
- **Approach**: Individual progress tracking, outcomes-focused (not attendance numbers)
- **Partnerships**: University, municipal government (institutional credibility)

### Content Transformation (Not Copied From Source)
- **Source**: "Quranic studies and literacy"
- **Web Copy**: Specific language about learning outcomes and community benefit

- **Source**: "We support 400 women"
- **Web Copy**: "400 women who now read, write, and participate in their communities"

- **Source**: "Holistic approach"
- **Web Copy**: "Education alone isn't enough. We provide meals, healthcare, housing support, and community."

## What Stays Exactly the Same

### Navigation & Routing
- Menu entries: About, Programs, Centers, Resources
- Menu destinations: All routes unchanged
- Auth buttons: Login, Register (same endpoints)
- Scroll behavior: Same as current

### Backend Integrations
- Branches API: Same endpoint, same parameters, same response structure
- Calendar API: Same endpoint, same events, same registration flow
- Resources API: Same endpoint, same files, same access behavior
- User Auth: Same Google OAuth flow, same session management

### Footer Links
- All footer links: Same destinations
- All footer forms: Same backend behavior
- All external links: Same URLs

## Implementation Steps (No Code Changes Yet)

1. **Rewrite i18n keys** (`ar.ts`): New copy for sections, same keys for backend-driven content
2. **Restructure landing.tsx**: Reorder sections, add new sections, same component patterns
3. **Create new presentational components** (if needed): HeroSection, TrustSignals, etc. (no data-fetching)
4. **Refine styling**: Spacing, typography, card design (new colors, but same design tokens)
5. **QA & Testing**: Verify 5-second test, accessibility, responsiveness, backend integrations

---

## Files Created (Wireframe Phase Only)

- ✅ `wireframes/desktop-full-1440px.png` — Desktop wireframe (11 sections, complete layout)
- ✅ `wireframes/tablet-full-768px.png` — Tablet wireframe (responsive adaptation)
- ✅ `wireframes/mobile-full-375px.png` — Mobile wireframe (single-column layout)
- ✅ `WIREFRAME-SPECIFICATION.md` — Complete detailed specification (all sections, backend specs, CTAs, components)
- ✅ `DESIGN-SUMMARY.md` — This document (executive overview)

---

## Questions for Your Approval

1. ✅ **Section order** — Does the narrative flow feel right?
2. ✅ **New sections** — Should we add/modify "Since 2011", "Why Families Trust Us", "Our Community"?
3. ✅ **Backend redesigns** — Do the recontextualizations make sense? (Centers → Community Centers, Calendar → Community Invitations, etc.)
4. ✅ **Visual aesthetic** — Is the institutional, warm direction aligned with your vision?
5. ✅ **CTA placement** — Are the entry points clear? Multiple pathways for joining?
6. ✅ **Mobile-first** — Does the responsive adaptation work for your users?

---

## Next: Implementation (After Your Approval)

Once you approve these wireframes, I will proceed directly to:

**Phase 1 - Content Rewrite**
- Extract mission, vision, values, tone from PDF + video
- Rewrite ~20-25 new i18n keys for new sections
- Rewrite ~15-20 existing keys for mission focus and warmth
- All copy grounded in source material, warm tone, specific outcomes

**Phase 2 - Structure Restructuring**
- Reorganize `landing.tsx` sections to match wireframe order
- Reuse existing components (Card, Button, Container, etc.)
- Create new presentational components only where needed
- Preserve all backend-driven rendering (branches, calendar, resources fetch logic)

**Phase 3 - Styling & Polish**
- Typography hierarchy and spacing refinement
- Institutional color palette and visual design
- Responsive behavior verification
- Accessibility and RTL support

**Phase 4 - QA & Testing**
- Verify 5-second test
- Test all CTAs and navigation
- Verify backend integrations (branches, calendar, resources)
- Mobile, tablet, desktop testing

**No backend code modifications. No API contract changes. Only presentation, copy, and visual design.**

---

**Ready to proceed with implementation?**

Please review:
1. The three wireframe images (`wireframes/desktop-full-1440px.png`, etc.)
2. The detailed specification (`WIREFRAME-SPECIFICATION.md`)
3. This summary (`DESIGN-SUMMARY.md`)

Confirm:
- Section order is approved
- Visual direction is aligned
- Backend redesign approach makes sense
- Implementation can proceed
