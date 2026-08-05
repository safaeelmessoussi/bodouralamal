# Bodour Al Amal Landing Page — Low-Fidelity Wireframes

## Overview

This document shows the proposed page structure for desktop and mobile before implementation.
All backend-driven sections are clearly marked.
All CTAs are indicated with placement and copy.

---

## DESKTOP WIREFRAME

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER/NAV (unchanged - preserved as-is, visual redesign) │
│  Logo | Menu | Auth Button                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                         HERO SECTION                        │
│                                                             │
│    Title: Simple, mission-focused                          │
│    "Bodour Al Amal: Education for Women & Children"        │
│                                                             │
│    Subtitle: One-line description                          │
│    "Transforming lives through education, care & community"│
│                                                             │
│    [PRIMARY CTA: "Join Us" or "Start Learning"]           │
│                                                             │
│    Background: Warm, institutional image                   │
│    (No video, no parallax - performance-first)            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         SECTION 2: "Since 2011" (Story Opening)            │
│                                                             │
│    [ Institution Credentials Box ]                         │
│    - Founded: 2011                                         │
│    - Beneficiaries: 400 women, 143 teens, 340 children   │
│    - Approach: Education + Community Support              │
│    - Partnerships: [List key partners]                    │
│                                                             │
│    Copy: 2-3 sentences about the organization's origin    │
│    and why it exists (grounded in source material)        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│    SECTION 3: "Why Families Trust Us"                      │
│    (Trust & Credibility)                                   │
│                                                             │
│    [ Card 1: Years of Experience ]                        │
│    13+ years serving Marrakech                            │
│                                                             │
│    [ Card 2: Educational Methodology ]                    │
│    Integrated approach: Quranic + Literacy + Culture     │
│                                                             │
│    [ Card 3: Community-Centered ]                         │
│    Support beyond education: meals, medical, housing      │
│                                                             │
│    [ Card 4: Partnerships ]                               │
│    Collaborated with [Partners]: University, Government   │
│                                                             │
│    [ Card 5: Individual Progress ]                        │
│    We track each person's journey, not just attendance   │
│                                                             │
│    [ Card 6: Safeguarding ]                               │
│    Child safety, dignity, and wellbeing prioritized       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         SECTION 4: "Our Community" (Evidence)              │
│                                                             │
│    Headline: Stories from the community                    │
│                                                             │
│    [ Impact Vignette 1 ]                                  │
│    "Women Learning to Read"                               │
│    Description (evidence-based, source-grounded)          │
│                                                             │
│    [ Impact Vignette 2 ]                                  │
│    "Children in School"                                   │
│    Description (evidence-based)                           │
│                                                             │
│    [ Impact Vignette 3 ]                                  │
│    "Community Support in Crisis"                          │
│    (e.g., earthquake relief, humanitarian work)           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         SECTION 5: "Our Approach"                          │
│         (Educational Philosophy)                           │
│                                                             │
│    Headline: How we teach and why                          │
│                                                             │
│    [ Step/Stage 1 ]                                       │
│    Foundation & Literacy (age/level appropriate)         │
│                                                             │
│    [ Step/Stage 2 ]                                       │
│    Quranic Studies & Cultural Education                   │
│                                                             │
│    [ Step/Stage 3 ]                                       │
│    Community Engagement & Life Skills                     │
│                                                             │
│    Each stage includes: Description, outcomes, benefits   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│    SECTION 6: "Our Centers" (BACKEND: Branches)           │
│    ⚠️  DATA SOURCE: Branches API endpoint                  │
│                                                             │
│    Headline: Our learning centers across Marrakech         │
│                                                             │
│    [ Center 1 ]  [ Center 2 ]  [ Center 3 ]  ...          │
│    Location, Hours, Contact Info, "Learn More" Link       │
│                                                             │
│    Same backend data fetching, completely redesigned       │
│    presentation (not a feature list, feels like            │
│    community gathering places)                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SECTION 7: "Upcoming Activities" (BACKEND: Calendar)     │
│  ⚠️  DATA SOURCE: Calendar API endpoint                    │
│                                                             │
│  Headline: Join us for upcoming programs                   │
│                                                             │
│  [ Event Card 1 ]  [ Event Card 2 ]  [ Event Card 3 ]    │
│  Date, Time, Program Title, "Register" Link               │
│                                                             │
│  Same backend data fetching, reframed as invitations      │
│  (not "calendar widget", feels like community invites)     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SECTION 8: "Learning Resources" (BACKEND: Resources)     │
│  ⚠️  DATA SOURCE: Resources API endpoint                   │
│                                                             │
│  Headline: Educational material produced by our           │
│  association                                               │
│                                                             │
│  [ Resource 1 ]  [ Resource 2 ]  [ Resource 3 ]  ...     │
│  Title, Description, "Access" Link                         │
│                                                             │
│  Same backend data fetching, presented as curated         │
│  educational materials (not document repository)           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│        SECTION 9: "Join Our Community" (CTA Section)       │
│                                                             │
│    Headline: Ready to become part of our community?        │
│                                                             │
│    [ CTA Button: "Enroll Now" ]  (Primary)                │
│    → Links to registration flow                           │
│                                                             │
│    [ CTA Button: "Register Your Child" ]  (Secondary)    │
│    → Links to child enrollment                            │
│                                                             │
│    [ CTA Button: "Support Our Work" ]  (Tertiary)        │
│    → Links to donation/partnership page                   │
│                                                             │
│    Copy: Inviting, warm closing message                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  FOOTER (REDESIGNED - links/destinations preserved)       │
│                                                             │
│  Logo | About | Contact | Socials | Legal                 │
│  (Visual redesign only - all links work identically)       │
│                                                             │
│  [STATISTICS SECTION - OPTIONAL]                          │
│  Integrated before or after footer with impact metrics    │
│  (BACKEND: Statistics API)                                 │
│  ⚠️  DATA SOURCE: Statistics API endpoint                  │
└─────────────────────────────────────────────────────────────┘
```

---

## MOBILE WIREFRAME (Single Column)

```
┌──────────────────────────────┐
│  HEADER/NAV                  │
│  (Hamburger menu, preserved) │
└──────────────────────────────┘

┌──────────────────────────────┐
│      HERO SECTION            │
│                              │
│  Title (Shorter on mobile)   │
│  Bodour Al Amal              │
│                              │
│  Subtitle                    │
│  Education for women &       │
│  children in Marrakech       │
│                              │
│  [PRIMARY CTA]               │
│  "Join Us"                   │
│                              │
│  (Background image scaled)   │
└──────────────────────────────┘

┌──────────────────────────────┐
│  "Since 2011" Section        │
│                              │
│  Credentials box (stacked)   │
│  - 13+ years                 │
│  - 400 women                 │
│  - 143 teens                 │
│  - 340 children              │
│                              │
│  Description text            │
└──────────────────────────────┘

┌──────────────────────────────┐
│  "Why Families Trust Us"     │
│                              │
│  [ Card ]                    │
│  [ Card ] (stacked)          │
│  [ Card ]                    │
│  [ Card ]                    │
│  [ Card ]                    │
│  [ Card ]                    │
│                              │
│  (Cards in single column)    │
└──────────────────────────────┘

┌──────────────────────────────┐
│  "Our Community"             │
│  Impact vignettes (stacked)  │
│                              │
│  [ Vignette 1 ]              │
│  [ Vignette 2 ]              │
│  [ Vignette 3 ]              │
└──────────────────────────────┘

┌──────────────────────────────┐
│  "Our Approach"              │
│  Stages (stacked)            │
│                              │
│  [ Stage 1 ]                 │
│  [ Stage 2 ]                 │
│  [ Stage 3 ]                 │
└──────────────────────────────┘

┌──────────────────────────────┐
│  "Our Centers"               │
│  (BACKEND: Branches)         │
│                              │
│  [ Center 1 ]                │
│  [ Center 2 ]                │
│  [ Center 3 ]                │
│  (Single column, stacked)    │
│                              │
│  "View All Centers" link     │
└──────────────────────────────┘

┌──────────────────────────────┐
│  "Upcoming Activities"        │
│  (BACKEND: Calendar)         │
│                              │
│  [ Event 1 ]                 │
│  [ Event 2 ]                 │
│  [ Event 3 ]                 │
│  (Stacked, scrollable if >3) │
│                              │
│  "View All Events" link      │
└──────────────────────────────┘

┌──────────────────────────────┐
│  "Learning Resources"        │
│  (BACKEND: Resources)        │
│                              │
│  [ Resource 1 ]              │
│  [ Resource 2 ]              │
│  [ Resource 3 ]              │
│  (Stacked)                   │
│                              │
│  "View All Resources" link   │
└──────────────────────────────┘

┌──────────────────────────────┐
│  "Join Our Community" CTA    │
│                              │
│  [ "Enroll Now" ]            │
│  [ "Register Your Child" ]   │
│  [ "Support Our Work" ]      │
│                              │
│  (Stacked buttons)           │
│  Full width on mobile        │
└──────────────────────────────┘

┌──────────────────────────────┐
│  FOOTER                      │
│  (Links preserved, visual   │
│   redesign for mobile)       │
│                              │
│  Logo                        │
│  About | Contact | Socials   │
│  Legal links                 │
└──────────────────────────────┘

┌──────────────────────────────┐
│  STATISTICS                  │
│  (Optional: before footer    │
│   or integrated elsewhere)   │
│                              │
│  [ Stat 1 ] [ Stat 2 ]      │
│  [ Stat 3 ] [ Stat 4 ]      │
│                              │
│  2-column grid on mobile     │
└──────────────────────────────┘
```

---

## Key Design Decisions in These Wireframes

### Section Order Rationale
1. **Hero** → Quick 5-second answer (what/who/why/CTA)
2. **Since 2011** → Establish institutional credibility immediately
3. **Why Families Trust Us** → Build trust before asking for commitment
4. **Our Community** → Show real outcomes (evidence-based)
5. **Our Approach** → Explain educational methodology
6. **Our Centers** → Where to find us (backend-driven, recontextualized)
7. **Upcoming Activities** → Invitation to participate (backend-driven, recontextualized)
8. **Learning Resources** → Materials available (backend-driven, recontextualized)
9. **Join Our Community** → Primary CTA with multiple pathways
10. **Footer** → Institutional links

### Backend-Driven Sections
- ⚠️ **Branches** → "Our Centers" (same API, new narrative context)
- ⚠️ **Calendar** → "Upcoming Activities" (same API, invitational framing)
- ⚠️ **Resources** → "Learning Resources" (same API, curated feel)
- ⚠️ **Statistics** → Optional section showing impact metrics

### CTA Placement
- **Hero CTA**: "Join Us" or "Start Learning" (primary, clear)
- **Mid-page CTAs**: None (let story flow)
- **Closing Section**: Multiple CTAs:
  - "Enroll Now" (Join as learner)
  - "Register Your Child" (Parent pathway)
  - "Support Our Work" (Donation/partnership)
- **Footer**: Standard navigation + hidden social links

### Performance Considerations
- ✅ No video backgrounds
- ✅ No heavy parallax scrolling
- ✅ No excessive animations
- ✅ Optimize images (compress, lazy-load backend sections)
- ✅ Reuse existing component library
- ✅ Minimal new CSS; reuse design tokens

### Responsive Behavior
- **Desktop**: Multi-column grid layouts where appropriate
- **Mobile**: Single-column stack, full-width buttons, touch-friendly spacing
- **Tablet**: Intermediate layouts (2-column where beneficial)

---

## Component Reuse Strategy

| Section | Component Strategy |
|---------|-------------------|
| Hero | New presentational component (HeroSection.tsx) if needed; else reuse existing Hero |
| Since 2011 | Reuse Card component with credentials layout |
| Trust Cards | Reuse Card component (6 cards, responsive grid) |
| Impact Vignettes | Reuse Card component or create lightweight ImpactCard.tsx |
| Stages/Approach | Reuse existing Steps/Stage component, update copy |
| Centers | Reuse existing BranchesSection, add new storytelling wrapper |
| Activities | Reuse existing Calendar component, add contextual wrapper |
| Resources | Reuse existing Resources component, add contextual wrapper |
| CTAs | Reuse existing Button component, create CTA section wrapper |
| Footer | Reuse existing Footer, update visual styling |

---

## Next Steps (Pending Approval)

1. ✅ **User approves/modifies wireframes**
2. ✅ **Detailed content written** (all i18n keys)
3. ✅ **Implementation begins** (Phase 1: Content → Phase 2: Structure → Phase 3+: Styling)

