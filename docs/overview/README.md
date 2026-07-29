[Documentation](../README.md) › **Overview**

# Overview

The platform in business terms. No stack knowledge is assumed anywhere in this section —
it is written for the association's staff, for funders and auditors, and for an engineer
on their first morning who needs to know what the software is *for* before reading how it
works.

## Read in order

1. **[Purpose and context](purpose-and-context.md)** — the association, the problem, and
   the four constraints that shaped every technical decision downstream.
2. **[Users and roles](users-and-roles.md)** — the six classes of user, what each may do,
   and why a minor has no account of their own.
3. **[Business processes](business-processes.md)** — how registration, approval,
   scheduling, progress tracking, grading, and content publishing actually work.
4. **[User journeys](user-journeys.md)** — eight complete paths through the system,
   end to end.
5. **[Scope and roadmap](scope-and-roadmap.md)** — what launches, what was deliberately
   postponed, and what each postponement bought.
6. **[Glossary](glossary.md)** — Arabic and English vocabulary, plus the identifier
   scheme used across all documentation.

## If you only read one thing

The association teaches Quran memorization, Islamic studies, and adult literacy to women,
teens, and children in Marrakesh. It has been running on paper and spreadsheets. This
platform replaces the scheduling, the account approvals, and the grade tracking.

Two facts about the people involved shape the software more than any technology choice:

- **Many beneficiaries are enrolled in adult literacy programmes.** Low digital literacy is
  the norm, not an edge case. Interfaces are Arabic, right-to-left, mobile-first, and
  forgiving.
- **A large share of the records are about children.** Safeguarding is not a feature area;
  it is a property the whole system has to hold. Access to a minor's record is verified on
  every single request, consent is a versioned record rather than a checkbox, and a
  response never reveals whether a child exists.

Everything else follows from those two sentences.
