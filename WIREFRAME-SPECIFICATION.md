# Bodour Al Amal Landing Page — Detailed Wireframe Specification

## Visual Wireframes
Grayscale low-fidelity wireframes created for three breakpoints:
- **Desktop** (1440px): `wireframes/desktop-full-1440px.png`
- **Tablet** (768px): `wireframes/tablet-full-768px.png`
- **Mobile** (375px): `wireframes/mobile-full-375px.png`

---

## Complete Section Breakdown

### 1. NAVIGATION BAR
**Visitor Journey Why**: Enables navigation and establishes Bodour Al Amal as the primary brand.

**Desktop Layout**:
- Light gray header bar (persistent across all pages)
- Logo/brand on left (icon + text "Bodour Al Amal")
- Menu items centered: About, Programs, Centers, Resources
- Authentication buttons on right: Login, Register
- Light divider below

**Tablet Layout**:
- Logo left-aligned or centered
- Primary menu items visible
- Secondary navigation in hamburger menu
- Auth buttons accessible

**Mobile Layout**:
- Logo centered or left-aligned
- Hamburger menu icon (right side)
- Auth buttons in menu or sticky header
- Minimal header height

**Component Strategy**: Reuse existing `ApplicationHeader` component (preserve routing, destinations, auth logic).

**CTA Map**: 
- Login → `/login` (existing route)
- Register → `/register` (existing route)
- Menu links → respective pages (routing unchanged)

**Interaction**: 
- Desktop: horizontal nav
- Mobile: hamburger menu dropdown
- Scroll behavior: header remains sticky or transforms on scroll
- Active section indication: underline or highlight current page

---

### 2. HERO SECTION
**Visitor Journey Why**: First 5-second impression. Must communicate what Bodour Al Amal is, who it serves, and why to trust it.

**Layout**:

**Desktop (1440px)**:
- Full viewport width, generous vertical padding (60-80px top/bottom)
- Two-column layout: Text on left (60%), illustration on right (40%)
- Heading: "Bodour Al Amal" (large, primary hierarchy)
- Subheading: "Educational Community Since 2011" (secondary)
- Body paragraph: Brief mission statement (3-4 sentences, warm tone, specific)
- Two CTAs: "Join Our Community" (primary button) + "Explore Programs" (secondary link)
- Illustration placeholder: Women, children, books, warmth (inviting, not tech-focused)

**Tablet (768px)**:
- Heading and subheading full-width
- Illustration scales down, positioned below or beside text
- CTAs side-by-side or stacked (mobile-friendly)

**Mobile (375px)**:
- Single column, text centered
- Heading, subheading, paragraph (readable on small screen)
- Illustration full-width below text (portrait orientation)
- CTAs stacked vertically, full-width buttons

**Component Strategy**: Create new presentational component `HeroSection` (replaces existing if needed). Reuse `Button` component for CTAs.

**Content Strategy** (Mission-Focused):
- Heading: Establishes name and institutional presence
- Subheading: "Since 2011" = credibility signal, "Educational Community" = inclusive, not corporate
- Body: Warm, specific language about serving women and children in Marrakech
- Illustration: Warm earth tones (Moroccan palette), human figures (women, children, diverse), books/learning (not technology)

**5-Second Test**:
- ✅ What: "Bodour Al Amal" + "Educational Community Since 2011" = Clear
- ✅ Who: "Women and children in Marrakech" (implied in copy + illustration)
- ✅ Why trust: "Since 2011" + professional tone + warm, human imagery
- ✅ Action: "Join Our Community" (clear CTA)

---

### 3. SINCE 2011 — INSTITUTIONAL INTRODUCTION
**Visitor Journey Why**: Establishes credibility, longevity, and scale. Shows this is a real, established organization, not a startup.

**Layout**:

**Desktop (1440px)**:
- White background section, generous padding (40-60px vertical)
- Heading: "Since 2011, Serving Our Community" (centered, secondary hierarchy)
- Three-column grid below heading:
  - Column 1: Icon placeholder + "13 Years" (stat) + 1-line description
  - Column 2: Icon placeholder + "400 Women" (stat) + 1-line description
  - Column 3: Icon placeholder + "340 Children" (stat) + 1-line description
- Optional: Brief mission narrative paragraph below stats (2-3 sentences, warm tone)

**Tablet (768px)**:
- Three columns may become 2-1 layout
- Stats remain clear and readable
- Text reflows

**Mobile (375px)**:
- Single column, stats stacked
- Each stat: icon + number + label
- Description paragraph single column
- Proper spacing between rows

**Component Strategy**: Reuse `Container` and `Card` components for stat cards. Clean, minimal design (no gradients, no decorative effects).

**Content Strategy** (Specific, Outcome-Focused):
- Heading: Emphasizes service and community
- Stats: Real numbers (13 years, 400 women, 340 children) = evidence-based, not vague claims
- Icon descriptions: "Years of Dedicated Service", "Women's Lives Transformed", "Children in School"
- Mission paragraph: Brief narrative about integrated education + support model

**Accessibility**: Icons have alt text. Numbers are also described in text.

---

### 4. WHY FAMILIES TRUST US
**Visitor Journey Why**: Build trust through institutional signals. Show this is professionally managed, outcomes-focused, and community-rooted.

**Layout**:

**Desktop (1440px)**:
- Light gray background section
- Heading: "Why Families Trust Us" (centered)
- Four-column card grid:
  - Card 1: "Established & Professional" + icon + 2-3 line description
  - Card 2: "Integrated Approach" + icon + 2-3 line description
  - Card 3: "Documented Results" + icon + 2-3 line description
  - Card 4: "Community Partnerships" + icon + 2-3 line description
- Each card: light white background, subtle border, icon placeholder, title, description
- Clean spacing between cards

**Tablet (768px)**:
- Four cards become 2x2 grid
- Cards scale, padding adjusts

**Mobile (375px)**:
- Cards stack vertically, one per row
- Full-width cards, readable text

**Component Strategy**: Reuse `Card` component. Create new `TrustSignal` presentational component if needed for icon + title + description pattern.

**Content Strategy** (Warm, Professional, Specific):
- Established & Professional: "Founded in 2011, recognized by municipal and university partnerships"
- Integrated Approach: "Education alone isn't enough. We provide meals, healthcare, housing support, and community."
- Documented Results: "Individual progress tracking. We know each person's story and celebrate their growth."
- Community Partnerships: "Trusted by [Municipality], [University], [Healthcare Partners]"

**Visual Direction**: Calm, institutional. No startup aesthetic. No gradients or flashy effects.

---

### 5. OUR COMMUNITY
**Visitor Journey Why**: Shift from abstract mission to human reality. Show real people, real stories. Build emotional connection.

**Layout**:

**Desktop (1440px)**:
- White background section
- Heading: "Our Community" (centered)
- Split layout: Left side (40%), Right side (60%)
- Left: Three community cards stacked vertically:
  - Card 1: Small illustration placeholder (woman) + name + role + 1-2 line story
  - Card 2: Small illustration placeholder (teen girl) + name + role + 1-2 line story
  - Card 3: Small illustration placeholder (child) + name + role + 1-2 line story
- Right: Narrative column with impact highlights:
  - Brief introductory paragraph
  - 3-4 impact highlights (e.g., "400 women now read and write", "340 children in school")
  - Each highlight: icon + stat + description
  - Optional: Quote or testimonial

**Tablet (768px)**:
- Layout may become single column with cards above text
- Cards shown in 2-3 column grid
- Text below

**Mobile (375px)**:
- Single column, cards stacked
- Narrative text below cards
- Proper reading hierarchy

**Component Strategy**: Reuse `Card` component for community cards. New `ImpactHighlight` component for stat + icon + description pattern (if it produces better narrative flow).

**Content Strategy** (Specific, Human-Centered, Source-Grounded):
- Community cards: Real names (or representative) + stories grounded in PDF (women learning to read, teens developing leadership, children gaining education)
- Narrative: Warm, specific language about transformation. "These are not statistics—these are neighbors, sisters, daughters, and sons."
- Impact highlights: Real numbers from source material. Each paired with a human context (e.g., "400 women now read and write" + "They support their families, participate in community decisions, pursue their dreams").

**Accessibility**: All illustrations have descriptions. Stories are written clearly.

---

### 6. EDUCATIONAL APPROACH
**Visitor Journey Why**: Explain educational philosophy. Show this is serious about learning, not just providing services. Differentiate from other NGOs.

**Layout**:

**Desktop (1440px)**:
- Light gray background section
- Heading: "How We Educate" (centered)
- Three-column layout:
  - Column 1: "Women's Literacy Program"
    - Icon placeholder
    - Title
    - 4-5 line description of program (what, why, outcomes)
    - "Learn More" link (goes to calendar/resources)
  - Column 2: "Youth Development"
    - Icon placeholder
    - Title
    - 4-5 line description of program
    - "Learn More" link
  - Column 3: "Children's Education"
    - Icon placeholder
    - Title
    - 4-5 line description of program
    - "Learn More" link
- Clean spacing, no decorative elements

**Tablet (768px)**:
- Three columns become 2-1 or single column
- Text remains readable
- Links accessible

**Mobile (375px)**:
- Three columns stack vertically
- Full-width cards, readable text

**Component Strategy**: Reuse `Card` component or create new `EducationalPathway` component if it improves visual hierarchy.

**Content Strategy** (Educational, Not Marketing):
- Women's Literacy: Grounded in source material. Not "empower women" (cliché), but specific outcomes: "Women learn to read, write, and develop life skills that benefit their families and communities."
- Youth Development: Specific about what teens learn (leadership, cultural education, academic support).
- Children's Education: Specific about age-appropriate learning, foundational skills.
- Each description: 4-5 sentences. Warm, professional tone. Evidence-based claims only.

**Visual Direction**: Institutional. Each pathway feels like a serious educational offering, not a feature.

---

### 7. OUR CENTERS (BRANCHES) — BACKEND-DRIVEN SECTION
**Visitor Journey Why**: Show community network. Make visitor feel welcome and supported. Invite them to visit or participate.

**Backend Specification**:
- **API Endpoint**: Existing `GET /api/branches` endpoint
- **Data Returned**: Branch name, address, location, contact info, operating hours
- **Behavior**: Same fetch logic, pagination, error handling (unchanged)
- **No API Modifications**: Zero changes to endpoint signature or data structure
- **Link Behavior**: Clicking a branch navigates to branch detail page (existing routing unchanged)

**Layout**:

**Desktop (1440px)**:
- White background section
- Heading: "Our Network Across Marrakech" (centered)
- Grid layout (2-3 columns) showing branch cards:
  - Each card: Location icon + branch name + address + brief description + "Visit" button
  - Cards styled as community centers (warm, institutional), not app locations
  - Light spacing between cards
  - Optional: Small map placeholder showing branch locations

**Tablet (768px)**:
- Grid becomes 2-column
- Cards remain clear, proper spacing

**Mobile (375px)**:
- Single-column stacked list
- Full-width cards
- Readable addresses and "Visit" buttons

**Recontextualization (Key Principle)**:
- Current: Likely styled as a feature or list (app aesthetic)
- Redesigned: Styled as "Meet Our Community Centers" — warm, inviting, human
- Each center presented as a gathering place, not a location marker
- Optional: Add 1-line description of what happens at each center (e.g., "Women's literacy classes, youth programs, community gatherings")

**Component Strategy**: Reuse `Card` component. Keep existing data-fetching logic (do not modify). Redesign card visual presentation (spacing, typography, icon treatment) to feel institutional and inviting.

**CTA Mapping**: 
- "Visit" button → Existing branch detail page (routing unchanged)
- Link destinations identical to current implementation

**5-Second Visitor Understanding**: After seeing hero and first 5 sections, visitor understands Bodour Al Amal is in Marrakech with multiple community centers. This section reinforces: "They have real physical presence in my community."

---

### 8. UPCOMING ACTIVITIES (CALENDAR) — BACKEND-DRIVEN SECTION
**Visitor Journey Why**: Invite participation. Show this is an active, vibrant community with regular programs. Remove barrier to engagement (show when/where to join).

**Backend Specification**:
- **API Endpoint**: Existing `GET /api/calendar` or `/api/events` endpoint
- **Data Returned**: Event name, date, time, location, description, capacity, registration status
- **Behavior**: Same fetch logic, filtering (current/upcoming events), pagination (unchanged)
- **No API Modifications**: Zero changes to query parameters or data structure
- **Link Behavior**: "Register" button navigates to event registration or calendar page (existing routing unchanged)

**Layout**:

**Desktop (1440px)**:
- Light gray background section
- Heading: "Join Us: Upcoming Programs" (centered, invitational tone)
- List or grid layout showing upcoming events (4-6 most recent/relevant):
  - Each event card: Program name + date + location + 2-3 line description + "Register" button
  - Cards styled as community invitations (warm, welcoming), not dashboard widgets
  - Light, readable spacing

**Tablet (768px)**:
- Events shown in 2-column grid or single-column list
- Cards properly sized, readable

**Mobile (375px)**:
- Single column, stacked events
- Full-width cards, readable date/location/description
- "Register" buttons properly sized for touch

**Recontextualization (Key Principle)**:
- Current: Likely styled as a calendar widget or event list (app aesthetic)
- Redesigned: Styled as "Join Us: Upcoming Programs" — warm invitation to participate
- Each event presented as an opportunity to join the community, not a dashboard entry
- Focus on human benefit: "Join women learning to read", "Meet our youth community", "Bring your child to educational activities"

**Component Strategy**: Reuse existing Calendar component if it exists. Keep data-fetching logic unchanged. Redesign visual presentation (spacing, typography, card styling) for warmth and invitation.

**CTA Mapping**:
- "Register" button → Existing event registration page or calendar registration flow (routing unchanged)

**5-Second Visitor Understanding**: After seeing hero + trust + community sections, visitor understands Bodour Al Amal is active and welcoming. This section says: "I can join right now. Here's what's happening."

---

### 9. LEARNING RESOURCES — BACKEND-DRIVEN SECTION
**Visitor Journey Why**: Provide tangible value. Show resources are available and curated. Remove friction for learners.

**Backend Specification**:
- **API Endpoint**: Existing `GET /api/resources` endpoint
- **Data Returned**: Resource name, category, description, type (PDF, link, etc.), access level
- **Behavior**: Same fetch logic, filtering by category, pagination (unchanged)
- **No API Modifications**: Zero changes to endpoint signature or data structure
- **Link Behavior**: Resource links navigate to files/pages (existing routing unchanged)

**Layout**:

**Desktop (1440px)**:
- White background section
- Heading: "Educational Materials for Your Journey" (centered, warm, curated tone)
- Grid layout (3-4 columns) showing resource cards:
  - Each card: Category icon + resource name + 1-2 line description + "Access" link
  - Cards styled as community treasures (curated, valuable), not digital library catalog
  - Light spacing, readable on all sizes

**Tablet (768px)**:
- Grid becomes 2-3 columns
- Cards properly sized

**Mobile (375px)**:
- Single column, stacked resources
- Full-width cards, readable descriptions
- "Access" links properly sized for touch

**Recontextualization (Key Principle)**:
- Current: Likely styled as a library or resource list (app aesthetic, "Browse resources")
- Redesigned: Styled as "Educational Materials for Your Journey" — curated community treasure
- Each resource presented as support for learning, not a feature
- Focus on human benefit: "Literacy guides", "Arabic learning materials", "Parenting guides for educators"
- Optional: Add brief intro explaining resources are free and community-created

**Component Strategy**: Reuse `Card` component. Keep data-fetching logic unchanged. Redesign visual presentation (card styling, icon treatment, typography) for warmth and curation.

**CTA Mapping**:
- "Access" link → Existing resource file or page (routing unchanged)

**5-Second Visitor Understanding**: Resources should feel like "We've prepared materials to help you. Here's what's available."

---

### 10. CALL TO ACTION — CLOSING
**Visitor Journey Why**: Clear next steps. Multiple pathways depending on visitor role (adult, parent, supporter).

**Layout**:

**Desktop (1440px)**:
- Light gray background section, centered, generous padding (60px vertical)
- Heading: "Ready to Join Us?" (large, primary hierarchy, centered)
- Optional subheading: "Multiple ways to participate" (supporting text)
- Three CTAs presented clearly:
  - Primary CTA: "Enroll as an Adult" (button, prominent styling) → `/register` with role=adult
  - Secondary CTA: "Register a Child" (button) → `/register` with role=parent
  - Tertiary CTA: "Support Our Mission" (link or outline button) → `/support` or donation page (if exists)
- Proper spacing and visual hierarchy between CTAs

**Tablet (768px)**:
- CTAs may be 2-1 layout or stacked
- Buttons properly sized, readable

**Mobile (375px)**:
- CTAs stacked vertically
- Full-width buttons for easy touch

**Component Strategy**: Reuse `Button` component for primary/secondary CTAs. Link or outline button for tertiary.

**CTA Mapping**:
- "Enroll as an Adult" → `/register` (existing route, possibly with role parameter if API supports it)
- "Register a Child" → `/register` (existing route, possibly with different role parameter)
- "Support Our Mission" → Support/donation page (existing or new route, preserve all link behavior)

**Content Strategy** (Clear, Warm, Invitational):
- Heading: Warm invitation, not salesy language
- CTAs: Specific to visitor role. "Enroll as an Adult" not "Sign Up". "Register a Child" not "Create Account".

**5-Second Visitor Understanding**: Multiple pathways make it clear anyone can participate in some way.

---

### 11. FOOTER
**Visitor Journey Why**: Build trust through transparency. Show institutional details, partnerships, accessibility. Provide pathways to contact/support.

**Backend Specification**:
- **Links**: All existing footer links must work identically
- **Destinations**: Menu items, contact info, social links unchanged
- **Functionality**: All forms, subscriptions, contact methods unchanged
- **No API Modifications**: Zero changes to backend integrations (contact forms, newsletter, etc.)

**Layout**:

**Desktop (1440px)**:
- Dark gray or deep institutional color background
- Three-column footer:
  - Column 1: Logo/brand + Brief mission statement (1-2 sentences, warm tone) + Social icons (Facebook, etc.)
  - Column 2: "Quick Links" section
    - About Us
    - Our Programs
    - Centers & Hours
    - Resources
    - Contact Us
  - Column 3: "Contact & Support" section
    - Phone number
    - Email
    - Address in Marrakech
    - Newsletter signup (if exists)
- Light divider lines between columns
- Footer bottom: Copyright, privacy policy, terms of service

**Tablet (768px)**:
- Three columns may become 2 columns
- All links remain accessible, proper spacing

**Mobile (375px)**:
- Single column, stacked sections
- Links properly spaced for touch
- Logo/brand, links, contact info in order
- Social icons accessible

**Recontextualization (Key Principle)**:
- Current: Likely generic or incomplete
- Redesigned: Styled as institutional footer (educational organization, foundation aesthetic)
- Include mission statement to reinforce purpose
- Include institutional details (address, phone, email) to build trust
- Optional: Include partnerships or accreditations (if any)

**Component Strategy**: Create new `InstitutionalFooter` component if current footer needs significant restructuring. Preserve all existing links and routing.

**CTA Mapping**:
- All footer links → Identical destinations as current implementation
- All forms/subscriptions → Identical backend behavior as current implementation

**Accessibility**: All links descriptive. Social icons have alt text. Contact info clearly presented.

---

## Information Architecture & Visitor Journey

### Complete Story Arc
1. **Hero** → "What is this place?" (Name, mission, 5-second clarity)
2. **Since 2011** → "How long have you been here?" (Credibility signal)
3. **Why Families Trust Us** → "Why should I believe you?" (Trust markers)
4. **Our Community** → "Who has this helped?" (Human stories, emotional connection)
5. **How We Educate** → "How do you do it?" (Educational philosophy)
6. **Our Centers** → "Where can I go?" (Community network)
7. **Upcoming Activities** → "When can I join?" (Participation pathway)
8. **Learning Resources** → "What support is available?" (Tangible value)
9. **Call to Action** → "What do I do now?" (Clear next steps)
10. **Footer** → "How do I trust and contact you?" (Institutional details)

### 5-Second Test: Does First-Time Visitor Understand?

**After Hero Section (< 5 seconds)**:
- ✅ **What**: "Bodour Al Amal, Educational Community Since 2011"
- ✅ **Who**: Illustration shows women and children; subheading implies community
- ✅ **Why Trust**: "Since 2011" = longevity; professional tone; institutional imagery (not tech)
- ✅ **Action**: "Join Our Community" (clear button, inviting language)

**Visitor feels**: This is a real, established educational organization. I can join. Let me scroll to learn more.

**After Since 2011 Section (< 15 seconds)**:
- ✅ Visitor sees real numbers (13 years, 400 women, 340 children)
- ✅ Numbers with context, not just statistics
- ✅ Visitor feels: Scale and impact are documented.

**After Trust Section (< 30 seconds)**:
- ✅ Visitor sees four clear trust markers
- ✅ "Established & Professional", "Integrated Approach", "Documented Results", "Community Partnerships"
- ✅ Visitor feels: This organization knows what it's doing.

**After Community Section (< 60 seconds)**:
- ✅ Visitor sees real stories (women, teens, children)
- ✅ Human faces/names (or representative profiles) + outcomes
- ✅ Visitor feels: This has helped real people. I can trust this.

**Conclusion**: Within 5-30 seconds of landing, first-time visitor understands:
1. **What**: Bodour Al Amal is an educational organization in Marrakech
2. **Who**: Women (adults, teens) and children
3. **Why Trust**: Operating since 2011, professional management, documented results, community partnerships
4. **Action**: Join Our Community (clear CTA available immediately)

---

## Component Strategy Summary

| Section | Component to Reuse | New Component? | Rationale |
|---------|-------------------|---|-----------|
| Navigation | `ApplicationHeader` | No | Preserve routing, auth, menu behavior |
| Hero | Existing or new `HeroSection` | Maybe | Current hero may need complete redesign; create new if it produces stronger narrative |
| Stats/Credentials | `Card` + `Container` | No | Existing components work; clean design |
| Trust Building | `Card` + `Container` | Maybe | `TrustSignal` component if it improves icon + title + description readability |
| Community Stories | `Card` | Maybe | `CommunityCard` component if custom storytelling improves narrative (illustration + name + story) |
| Educational Pathways | `Card` | No | Existing components sufficient |
| Branches | `Card` + existing fetch logic | No | Reuse data-fetching; redesign card presentation only |
| Calendar | Existing Calendar component | No | Preserve data-fetching behavior; redesign visual presentation |
| Resources | `Card` | No | Reuse component; redesign visual presentation |
| CTA Closing | `Button` + `Container` | No | Existing components work; clean, centered layout |
| Footer | Existing or new `Footer` | Maybe | Create `InstitutionalFooter` if complete redesign needed; preserve all links |

**Rule**: Reuse existing components when they remain the best implementation. Create new presentational components (with zero data-fetching or business logic) only when they produce significantly better visitor experience (clearer storytelling, better hierarchy, more institutional aesthetic).

---

## Spacing & Rhythm

### Desktop (1440px)
- Hero: 80px padding top/bottom
- Sections: 60-80px padding top/bottom
- Section margins: 40px between sections
- Cards: 20-30px padding, 20px gap between cards
- Mobile-safe CTA buttons: 44px+ height, 16px+ padding

### Tablet (768px)
- Hero: 60px padding top/bottom
- Sections: 50-60px padding top/bottom
- Section margins: 30px between sections
- Cards: 15-20px padding, 15px gap between cards

### Mobile (375px)
- Hero: 40px padding top/bottom
- Sections: 40px padding top/bottom
- Section margins: 20px between sections
- Cards: 12-16px padding, 12px gap between cards
- Safe spacing around edges: 16px minimum

**Principle**: Generous spacing creates calm, institutional aesthetic. No cramped layouts. Breathing room between sections.

---

## Typography Hierarchy

| Element | Size | Weight | Usage |
|---------|------|--------|-------|
| Page Heading (Hero) | 48px+ (desktop), 32px (mobile) | Bold/700 | Hero title |
| Section Heading | 32px+ (desktop), 24px (mobile) | Bold/600 | Section titles |
| Card Title | 18px+ | Semibold/600 | Card headings |
| Body Text | 16px | Regular/400 | Paragraphs, descriptions |
| Small Text | 14px | Regular/400 | Card descriptions, labels |
| Stat Numbers | 24px+ | Bold/700 | "400 Women", "13 Years" |
| Stat Labels | 14px | Regular/400 | Labels below stats |

**Principle**: Clean hierarchy. No more than 2-3 font sizes in use. Professional, readable on all devices.

---

## Navigation & CTA Flow

### Primary CTAs (High Priority)
1. **Hero CTA**: "Join Our Community" → `/register`
2. **Branches Visit**: "Visit" → Branch detail (existing routing)
3. **Calendar Register**: "Register" → Event registration (existing routing)
4. **Closing CTA**: "Enroll as an Adult" or "Register a Child" → `/register`

### Secondary CTAs (Medium Priority)
- "Learn More" links → Calendar, Resources pages
- "Access" links → Resource files
- "Support Our Mission" → Support/donation page (if exists)

### Navigation CTAs (Always Visible)
- Header menu: About, Programs, Centers, Resources
- Header auth: Login, Register

### Footer CTAs (Low Priority but Important)
- All footer links → Existing destinations (unchanged)

---

## Backend Sections Preservation Matrix

| Section | Current API | Fetch Logic | Data Structure | Link Behavior | ✅ Unchanged? |
|---------|------------|------------|---|---|---|
| Branches | `GET /api/branches` | Existing filter/pagination | Branch{name, address, contact...} | Branch detail route | ✅ Yes |
| Calendar | `GET /api/calendar` or `/api/events` | Existing filter/sort/pagination | Event{name, date, location...} | Registration route | ✅ Yes |
| Resources | `GET /api/resources` | Existing filter/category | Resource{name, category, link...} | File/page route | ✅ Yes |
| Statistics | Embedded or API call | Existing fetch | Stats{totalWomen, children...} | N/A (display only) | ✅ Yes |
| User Auth | OAuth + session | Existing flow | User{role, email, profile...} | Login/Register routes | ✅ Yes |

**Principle**: Zero modifications to any backend contract, API signature, data structure, or business logic. Only presentation layer changes.

---

## Accessibility & Responsive Guidelines

- ✅ All images have alt text
- ✅ CTA buttons: 44px minimum height, 16px+ padding (touch-safe)
- ✅ Color contrast: WCAG AA compliance
- ✅ Typography: Readable on 360px+ screens
- ✅ Semantic HTML: Proper heading hierarchy (h1, h2, h3)
- ✅ RTL Support: Arabic text flows right-to-left; preserved from current implementation
- ✅ Focus states: Keyboard navigation accessible on all interactive elements
- ✅ Mobile-first: Design scales up from 375px → tablet → desktop

---

## Wireframe Validation

✅ **Desktop wireframe** shows complete page layout, spacing, hierarchy, backend sections marked
✅ **Tablet wireframe** shows responsive adaptation, grid changes, readability
✅ **Mobile wireframe** shows single-column layout, touch-safe spacing, readable on 375px screen
✅ **All sections** identified with visitor journey purpose
✅ **Backend sections** clearly marked with API endpoints, data sources, preservation notes
✅ **CTA map** shows destination for every button/link
✅ **Component strategy** specified for each section (reuse existing or create new)
✅ **5-second test** documented and achievable with Hero + Since 2011 + Trust sections

---

## Next Steps: Implementation (Awaiting Approval)

Once you approve these wireframes:

1. **Phase 1**: Rewrite i18n keys in `ar.ts` with new copy (mission-focused, warm, warm, specific)
2. **Phase 2**: Restructure `landing.tsx` to match wireframe section order
3. **Phase 3**: Create new presentational components if needed (HeroSection, TrustSignals, etc.)
4. **Phase 4**: Refine styling (spacing, typography, card design) for institutional aesthetic
5. **Phase 5**: QA — verify 5-second test, accessibility, responsive behavior, backend integrations

**No backend modifications. No API changes. Only presentation layer and copy.**

Ready for your approval on these wireframes?
