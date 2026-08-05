# Bodour Al Amal Landing Page Redesign: Design Proposal

## Overview
This proposal transforms the landing page from a feature-focused application introduction to an institutional story about a trusted Moroccan educational organization. The redesign communicates institutional credibility, warmth, and community impact while preserving all backend functionality.

---

## Phase 0.5: Key Insights Extracted from Source Material

### Mission & Purpose
**From PDF**: "A non-profit, cultural and social association established in 2011 to improve the lives of community members and develop their minds, with special focus on women and children. The association works through three main educational stages combining Quranic studies, literacy, and cultural activities."

**Web Narrative**: Bodour Al Amal is a rooted, established educational organization (since 2011) serving women and children across Marrakech through integrated education—Quranic studies, literacy, and cultural development—not just online learning, but community-based transformation.

### Community Scale & Impact
- **400 women** (many learning to read for the first time)
- **143 teenage girls** (balancing Quranic memorization with secondary education)
- **340 children** (ages 4-7, foundational learning)
- **2 active branches** in Marrakech (Amrshish and Tarika), preparing for a 3rd
- **Educational partnerships**: Municipal council, Regional Academy for Education, Qadi Ayad University, researchers inside and outside Morocco
- **Humanitarian work**: Medical convoys, earthquake relief housing (50 wooden homes built post-2023), nutrition support (2000 students served during Ramadan), winter clothing distribution, well-digging projects

### Tone & Values
From the PDF's institutional language:
- **Professional & humble**: Matter-of-fact description of concrete work, no overselling
- **Outcomes-focused**: Documentation of individual progress, not just attendance
- **Community-rooted**: Deep partnerships with municipal government, university, academics
- **Holistic**: Education + spiritual growth + social support (meals, housing, healthcare)
- **Women-first**: Adult women literacy is the foundation; other programs build from there
- **Culturally grounded**: Moroccan, Islamic, community-based

### Key Differentiators
1. **Established history** (since 2011): 13+ years of work, not a startup
2. **Individual progress tracking**: Each learner's journey is documented, not just enrollment counts
3. **Integrated impact model**: Education + social support + spiritual growth (not siloed)
4. **Women as educators and leaders**: The organization is led by and staffed with women educators
5. **Academic partnerships**: Collaboration with university researchers and educators (signals credibility)
6. **Humanitarian crisis response**: Active relief work (earthquake, flooding, winter support) shows deep community commitment

---

## Section Order & Narrative Arc

### Current Page Structure
1. Hero (title + CTA)
2. Mission section
3. Stages section (3 cards: Adults, Teens, Children)
4. How to Join (3 steps: Google login, fill form, staff review)
5. Branches section (dynamic, fetched from backend)

### Proposed New Structure
> **Philosophy**: Tell the story of the organization before asking visitors to join. Establish institutional credibility, show community impact, then explain how to participate.

1. **Hero Section** (Completely redesigned)
   - Mission-focused positioning: "Who we are and what we stand for"
   - Institutional imagery: Community gathering, not product mockup
   - Two CTAs: "Enroll" (primary) + "Learn More" (secondary, scrolls to content)

2. **Story Opening** (NEW)
   - "Since 2011, Bodour Al Amal has been..."
   - Establishes institutional credibility, history, and rooted-ness
   - Brief narrative of the organization's journey

3. **Our Community** (Repositioned from current "Stages")
   - "Meet the people we serve"
   - Show the human reality: 400 women, 143 teenagers, 340 children
   - Present stages as community descriptions (not product features)
   - Emotional focus: real people, real transformations, specific outcomes

4. **Our Approach** (NEW)
   - Explain the integrated model: Education + social support + spiritual growth
   - Highlight individual progress tracking
   - Build trust through transparency about how the organization works
   - Provide evidence: partnerships (university, municipal government, academics)

5. **Our Impact** (NEW - transforms current "Statistics" if available)
   - Concrete outcomes contextualized with narrative
   - "400 women learning to read for the first time in their 40s"
   - "143 teenagers balancing secondary school with Quranic learning"
   - "340 children with early literacy foundations"
   - Humanitarian work: earthquake relief, nutrition support, medical care
   - This is institutional storytelling, not a metrics dashboard

6. **Our Network** (Branches section, visually redesigned)
   - "Where you can find us across Marrakech"
   - Branches presented as community gathering places
   - Same backend data, institutional framing
   - Contextual information: "Visit our Amrshish center for adult literacy programs"

7. **How to Participate** (Redesigned "How to Join")
   - Invitational tone: "Join our community"
   - Three steps remain identical in logic, reframed emotionally
   - Focus on joining a community, not submitting an application

8. **Calendar / Upcoming Programs** (NEW INTEGRATION)
   - Backend calendar data repositioned
   - "What's happening this month: upcoming programs and workshops"
   - Presented as community invitations, not an embedded calendar widget

9. **Resources** (Backend section, if included)
   - "Learning materials for your journey"
   - Educational content framed as curated community resources

10. **Call to Action** (Strengthened)
    - Primary: "Start Learning Today" → Google enrollment flow
    - Secondary: "Learn More About Us" (link to about page if exists, or email)
    - Tertiary: "Support Our Work" (if donation option exists)

11. **Footer** (Completely redesigned)
    - Institutional aesthetic: partnerships, mission, contact info
    - Same links (destinations unchanged), new visual treatment
    - Footer should feel like part of the organization, not a website appendix

---

## Visual Direction & Institutional Feel

### Design Inspiration
- **Premium educational institutions**: University websites (Al-Akhawayn University Ifrane, Moroccan university sites), cultural foundations
- **Not**: SaaS landing pages, startup sites, product marketing pages
- **Aesthetic**: Calm, welcoming, elegant, timeless
- **Moroccan identity**: Subtle zellij patterns, Arabic typography nuance, warm earth tones (already in design tokens)

### Key Visual Decisions

#### Color Palette (Reusing Existing Tokens)
- **Primary green**: Institutional authority, trust, education
- **Warm neutrals**: Cream, soft beige, light gray (comfort, accessibility)
- **Brass/copper accent**: (Already in system) For CTAs, emphasis
- **Dark text**: High contrast for accessibility, reads premium
- **Avoid**: Startup gradients, neon colors, overly saturated hues

#### Typography
- Maintain existing font stack (serif/sans hierarchy already in system)
- Increase line-height and letter-spacing for premium feel
- Use hierarchy to guide: Mission statements prominent, enrollment steps secondary
- Institutional tone: Clear, direct, never marketing-speak

#### Spacing & Rhythm
- **Generous breathing room**: More whitespace between sections creates calm, premium feel
- **Vertical rhythm**: Consistent spacing reinforces institutional structure
- **Section breaks**: Clear visual separation (tinted backgrounds, spacing) not jarring transitions
- **Hero to mission flow**: Smooth transition, inviting scroll

#### Imagery & Icons
- **Hero**: Community image (people learning together) or place (Marrakech urban/architectural context), not abstract shapes
- **Icons**: Institutional (book, community, growth, light bulb), not startup-style
- **Avoid**: Decorative blobs, gradients, flashy animations
- **Moroccan touches**: Subtle geometric patterns, calligraphic hints in typography

### Component Reuse Strategy
- **Container & Section**: Reuse existing (no changes needed)
- **Card**: Reuse for community descriptions (same component, different context)
- **Button**: Reuse existing (keep affordances)
- **Steps/Numbered list**: Reuse for "How to Participate"
- **New components** (if they improve narrative):
  - `StoryOpening` — Institutional introduction with timeline
  - `CommunityMember` — Human-focused description of stages
  - `ImpactHighlight` — Contextualized statistics with narrative
  - `PartnershipBadge` — Institutional partners/supporters
  - These would be purely presentational (no data fetching)

---

## Content Strategy & Copy Samples

### Hero Section (Completely Redesigned)

**Current**:
> "نزرع بذرة العلم، ونرعاها حتى تُثمر" (We plant the seed of knowledge and nurture it until it bears fruit)
> "منصة تعليمية تجمع البرامج والدروس والمتابعة التربوية..." (A platform that brings programs, lessons, and monitoring together...)

**Proposed**:
**Title**: "التعليم حق، والمتابعة واجب" (Education is a right, follow-up is a duty)
*OR*
"تعليمٌ جذوره عميقة، ولا يتوقّف" (Education with deep roots, that doesn't stop)

**Lede** (rewritten, mission-focused):
"منذ 2011، بذور الأمل تجمع النساء والأطفال في مراكش حول تعليم متكامل: قرآن وحروف وروح. نتابع كل متعلّمة متابعةً فردية، ونؤمن أن لا أحد يُترك وراء الباب."

*(Since 2011, Bodour Al Amal brings women and children together in Marrakech around integrated education: Quranic, literacy, spiritual. We follow each learner individually, and believe no one is left behind.)*

### Story Opening (NEW) - Institutional Credibility

"**منذ 2011: جمعيةٌ مؤسَّسة**" *(Since 2011: An Established Association)*

"بدأت بذور الأمل من حاجة حقيقية في مراكش: نساء تودّ أن تقرأ، وأطفال في مناطق نائية بلا تعليم منتظم. منذ أكثر من عشرة أعوام، كرسنا جهودنا لتغيير هذا الواقع من خلال برامج متكاملة تجمع بين التعليم والدعم الاجتماعي والنمو الروحي. اليوم، نخدم 400 امرأة و340 طفل و143 فتاة عبر فرعَيْنا في مراكش."

*(Bodour Al Amal began from a real need in Marrakech: women who wanted to read, and children in remote areas without formal schooling. For over a decade, we've dedicated our efforts to changing this reality through integrated programs that combine education with social support and spiritual growth. Today, we serve 400 women, 340 children, and 143 teenage girls across our two Marrakech centers.)*

### Community Section (Redesigned "Stages")

Instead of presenting stages as product features, present them as communities:

**Adults**: 
"النساء اللاتي لم تتحِ لهنّ فرصة التعلّم" *(Women who didn't have the chance to learn)*
"تعلّم القراءة والكتابة بجانب حفظ القرآن والعلوم الشرعية. متابعةٌ فردية موثّقة لكل متعلّمة."
*(Learning reading and writing alongside Quranic memorization and Islamic studies. Documented individual progress for every learner.)*

**Teens**:
"المراهقات بين الدراسة والقرآن" *(Teenagers balancing school and Quranic learning)*
"برامج مرنة تعترف بضغط الدراسة النظامية، وتوازن بين الحفظ والفهم والحياة المراهقة."
*(Flexible programs that acknowledge the demands of school, balancing memorization, comprehension, and adolescence.)*

**Children**:
"الأطفال الصغار: أسسٌ قويّة" *(Young children: Strong foundations)*
"تأسيس مبكّر في القراءة والحفظ بأسلوب محبَّب، مع متابعة أولياء الأمور عبر حساباتهم."
*(Early foundations in reading and memorization through beloved methods, with parent access to track progress.)*

### Our Approach (NEW)

"**كيف نعمل**" *(How We Work)*

"التعليم وحده ليس كافياً. الطالبة التي تجوع لا تستطيع أن تركّز. والطفل الذي لا يشعور بالأمان لا يقدر على التعلّم. لذلك نقدّم:
- التعليم المتكامل: قرآن وقراءة وعلوم شرعية بجانب دروس في الإعلاميات والإنجليزية
- الدعم الاجتماعي: وجبات يومية في رمضان، دعم الإسكان، توزيع ملابس دافئة، قوافل طبية
- المتابعة الفردية: كل متعلّمة لها ملف توثّق فيه خطواتها، لا مجرّد حضورٍ في سجل
- الشراكات المؤسسية: نعمل مع جامعة القاضي عياض والأكاديمية الجهوية والمجلس البلدي"

*(Education alone is not enough. The hungry student cannot focus. The child who doesn't feel safe cannot learn. So we provide: integrated education, social support, individual progress tracking, institutional partnerships.)*

### Our Impact (NEW) - Contextualized Statistics

"**400 امرأة لم تكن تستطيع أن تقرأ**" *(400 women who couldn't read before)*
"الآن تقرأ. تقرأ لأطفالهنّ، في شهاداتهنّ، في حياتهنّ اليومية. 400 امرأة غيَّرنّ حياتهنّ."

"**143 فتاة مراهقة**" *(143 teenage girls)*
"توازن بين الدراسة النظامية وحفظ القرآن. تطوّرن مهاراتهنّ، وقوّين ثقتهنّ بأنفسهنّ."

"**340 طفل في أساسهم التعليمي**" *(340 children building their educational foundation)*
"يتعلّمون القراءة والحروف والقرآن الكريم في أجواء آمنة ومحبّة."

"**وأكثر**: في 2023، بدأنا بناء 50 بيتاً خشبياً للعائلات المتضررة من الزلزال. نظّمنا قوافل طبية. أطعمنا 2000 طالب في رمضان. التعليم لا ينفصل عن الحياة."

*(And more: In 2023, we built 50 wooden homes for families affected by the earthquake. Organized medical convoys. Fed 2000 students during Ramadan. Education is inseparable from life.)*

### How to Participate (Redesigned "How to Join")

**Step 1**: "ادخلي بحسابك Google" → "ابدأي رحلتك معنا" *(Start your journey)*
*(Instead of a technical description, make it invitational)*

**Step 2**: "أكملي بياناتك" → "اخبرينا عن نفسك" *(Tell us about yourself)*
*(Focus on getting to know the learner, not a form submission)*

**Step 3**: "مراجعة وتفعيل" → "نضعك مع أفضل مؤطّرة لك" *(We match you with the best educator)*
*(Focus on care and personalization, not admin review)*

---

## 5-Second Test Mapping

Within 5 seconds of landing, visitors should understand:

1. **What Bodour Al Amal is**: 
   - Hero title + institutional image communicates this immediately
   - "Since 2011" + location (Marrakech) in hero or first section

2. **Who it serves**:
   - Hero lede mentions "women and children"
   - Community section (redesigned stages) visible in first scroll, shows "400 women, 143 teens, 340 children"

3. **Why they should trust it**:
   - Established date (2011) in hero
   - Institutional partnerships visible early (university, municipal)
   - Professional, calm tone (not marketing hype)
   - Humanitarian work mention (earthquake relief, food security)

4. **How to join**:
   - Primary CTA in hero ("Enroll" or "Start Learning")
   - Secondary CTA ("Learn More" anchors to community section)
   - Clear enrollment pathway visible after first scroll

**Visual markers**:
- Hero: Mission-focused title, institutional image, warm color, clear CTA
- First scroll: Instant credibility (year, location, scale)
- Second scroll: Community overview, partnership badges, human stories
- Third scroll: How to participate, pathway to enrollment

---

## Backend Section Redesign Strategy

### Branches Section
**Currently**: "أين تجدنا" (Where to find us) → Lists branches as application locations

**Proposed**: "شبكتنا في مراكش" (Our network in Marrakech) or "المراكز المجتمعية" (Community centers)

**Visual treatment**: 
- Present each branch as a community center with mission context
- Include branch-specific programs (which educational stages meet where)
- Each branch card tells a story, not just displays an address
- Map visualization if backend data allows, showing community reach

**Data source**: Same API calls, identical data structure, new narrative framing

### Calendar Section
**Currently**: Embedded calendar widget (if visible on landing)

**Proposed**: "انضمي إلينا: البرامج الشهرية" (Join us: This month's programs)

**Visual treatment**:
- Highlight 3-4 upcoming events/sessions narratively
- "This week: women's literacy circle", "Saturday: children's Quran class"
- Inviting, community-focused copy instead of "View calendar"
- Link to full calendar for details

**Data source**: Same calendar API, new presentation

### Resources Section
**Currently**: "المحتوى التعليمي" (Educational materials)

**Proposed**: "مواردك للتعلّم" (Your learning resources) or "مركز المعرفة" (Knowledge center)

**Visual treatment**:
- Categorize resources by community (women, teens, children)
- Add context: "Quranic recitation guides", "Literacy worksheets", etc.
- Feel like a curated library, not a file list

**Data source**: Same resources API, new presentation

---

## Timeless vs. Trendy Assessment

### What Makes This Design Timeless
- **Institutional aesthetic**: University/foundation websites never go out of style
- **Calm, high-contrast typography**: Always readable, always professional
- **Generous whitespace**: Elegant, never feels dated
- **Warm earth tones**: Moroccan/cultural identity grounds the design
- **No trendy animations**: Accessibility-first, subtle motion only for clarity
- **Focus on mission over novelty**: Institution transcends design trends

### Avoiding Trendy Patterns
- ❌ Startup gradients (muted colors instead)
- ❌ Flashy hover effects (subtle, purposeful interaction)
- ❌ Decorative blobs/shapes (geometric, cultural patterns instead)
- ❌ Auto-playing videos (none)
- ❌ Infinite scrolling (clear page structure)
- ❌ Abundant emoji (Arabic typography featured)
- ✅ Clear hierarchy
- ✅ Readable typography
- ✅ Purposeful color
- ✅ Timeless photography (community, place)

---

## Implementation Summary

| Phase | Focus | Files |
|-------|-------|-------|
| **1** | Content rewrite (i18n/ar.ts) | Add ~20-25 new keys, rewrite ~15-20 existing |
| **2** | Landing page structure | landing.tsx: reorganize sections, add new sections |
| **3** | Components & styling | Create presentational components if needed, update CSS |
| **4** | Menu & footer redesign | Menu visual hierarchy, footer complete redesign |
| **5** | Backend sections | Redesign Branches, Calendar, Resources visual presentation |
| **6** | QA & testing | Verify 5-second test, accessibility, RTL, responsiveness |

---

## Next Steps

**Awaiting your approval on**:
1. ✅ Section order and narrative flow (accept/modify/suggest)
2. ✅ Visual direction (institutional aesthetic - confirm we're aligned)
3. ✅ Content tone and messaging samples (approve/revise)
4. ✅ Backend section transformation strategy (branches/calendar/resources)
5. ✅ Any section removals/additions you'd recommend

Once approved, we proceed to Phase 1 implementation.
